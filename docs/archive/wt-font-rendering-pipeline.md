# Windows Terminal Font Rendering Pipeline — Structured Findings

## 1. DirectWrite Text Rendering in Windows Terminal — How It Handles Color

### Pipeline Overview
Windows Terminal uses the **Atlas Engine** (introduced in v1.13, now the default). The pipeline:

1. **Text Shaping** (`_flushBufferLine` → `_mapCharacters` → `_mapComplex`): DirectWrite's `IDWriteFontFallback` maps character ranges to fonts, then `IDWriteTextAnalyzer` produces glyph indices and placements.
2. **Glyph Rasterization**: DirectWrite rasterizes glyphs into a **glyph atlas texture** (GPU-resident for BackendD3D). Each glyph is stored with coverage (alpha) information.
3. **Color Application**: The **pixel shader** (`shader_ps.hlsl`) applies foreground color at draw time. For standard text, the glyph's alpha channel modulates the foreground color over the background. Color is NOT baked into the glyph atlas for normal text — it's applied per-frame via the shader.
4. **Instanced Drawing**: `QuadInstance` structs encode position, texture coords, and color. Thousands of glyphs render in single GPU draw calls.

### Color-Specific Rendering
- **Standard text**: Grayscale or ClearType antialiased alpha is stored in the atlas. The shader multiplies this alpha by the cell's foreground color.
- **Colored glyphs (emoji, Nerd Font icons)**: These use `DWRITE_TEXTURE_CLEARTYPE_3x1` or `DWRITE_TEXTURE_ALIASED_1x1` depending on the glyph type. Color emoji use the `COLR`/`CBDT`/`sbix` tables and are rasterized as color bitmaps stored in the atlas with their own RGBA data.
- **Builtin glyphs** (box-drawing U+2500–U+259F, Powerline U+E0B0–U+E0BF): Procedurally generated via `BuiltinGlyphs::GetGeometry` using D2D geometries, NOT from font files. The pixel shader uses `SHADING_TYPE_TEXT_BUILTIN_GLYPH` with checkerboard/fill patterns.

### Key Source Files
- `src/renderer/atlas/AtlasEngine.cpp` — text shaping orchestration
- `src/renderer/atlas/BackendD3D.cpp` — GPU atlas rendering
- `src/renderer/atlas/shader_ps.hlsl` — pixel shader with color blending
- `src/renderer/atlas/BuiltinGlyphs.cpp` — procedural box-drawing/Powerline generation

### Relevant Issues
- **#11623** — Introduce AtlasEngine (PR, 2021): New glyph-atlas-based renderer
- **#10461** — Add DxRenderer based on glyph atlas (feature request, 2021)

---

## 2. Glyph Atlas Rendering — How Colored Glyphs Are Rasterized

### Architecture
The glyph atlas is a single large texture (or texture array) on the GPU. Each glyph is rasterized by DirectWrite and placed into this atlas at a computed position.

### Rasterization Modes
| Glyph Type | Texture Format | Shading Type | Notes |
|---|---|---|---|
| Standard ASCII | Grayscale alpha (A8 or BGRA8) | `SHADING_TYPE_TEXT` | Foreground color applied by shader |
| ClearType text | RGB subpixel (BGRX8) | `SHADING_TYPE_TEXT` | Requires `antialiasingMode: "cleartype"` |
| Color emoji | RGBA bitmap | `SHADING_TYPE_TEXT_COLOR` | From COLR/CBDT/sbix font tables |
| Nerd Font icons | Depends on glyph | `SHADING_TYPE_TEXT` or color | Monochrome icons use alpha; some are colored |
| Box-drawing | Procedural D2D geometry | `SHADING_TYPE_TEXT_BUILTIN_GLYPH` | NOT from font atlas |
| Powerline (U+E0Bx) | Procedural D2D geometry | `SHADING_TYPE_TEXT_BUILTIN_GLYPH` | NOT from font atlas |

### Known Issue: Atlas Cache Invalidation
When the atlas runs out of space, glyphs are evicted and re-rasterized. This can cause brief rendering glitches with large numbers of unique glyphs (common with Nerd Fonts that have thousands of icons).

### Relevant Issues
- **#5897** — Investigate alternative ways to handle box drawing/block elements (2020)
- **#16729** — Add support for custom box drawing and powerline glyphs (PR, 2024)

---

## 3. CaskaydiaCove Nerd Font Specific Rendering Bugs

### Critical Issues

#### #11769 — Some glyphs in Nerd Fonts are rendered with wrong widths
- **Severity**: HIGH
- **Status**: Open (2021-11-16)
- **Font**: CaskaydiaCove Nerd Font
- **Problem**: Nerd Font glyphs are assigned incorrect advance widths by the Atlas Engine. Some icons render at 1 cell width but visually span 2 cells, or vice versa. Causes overlapping text, misaligned columns, broken TUI layouts.
- **Root cause**: The Nerd Fonts patching process sets some glyphs to double-width (`advanceWidth = 2 * em`) but Windows Terminal's text analyzer may not correctly detect this, especially with the font fallback system.

#### #16413 — Weird glyph rendering issue with CaskaydiaCove NerdFont
- **Severity**: MEDIUM
- **Status**: Open (2023-12-02)
- **Problem**: Glyphs do a "wavy thing" when typing three lowercase 'w' letters in a row. Rendering artifacts appear with specific character sequences.
- **Likely cause**: Kerning/ligature interaction with Nerd Font patching. CaskaydiaCove is based on Cascadia Code which has ligatures; the Nerd Font patching may corrupt some OpenType tables.

#### #16925 — Weird rendering on CaskaydiaCove Nerd Font Mono
- **Severity**: MEDIUM
- **Status**: Open (2024-03-24)
- **Problem**: Rendering artifacts when using oh-my-posh with CaskaydiaCove NF Mono.

#### #16852 — Font/Emoji rendering spacing issue
- **Severity**: MEDIUM
- **Status**: Open (2024-03-09)
- **Problem**: Emoji and font spacing issues with Nerd Fonts in v1.19.

#### #12587 / #14173 — Unable to find the selected font CaskaydiaCove NF
- **Severity**: LOW-MEDIUM
- **Problem**: Font not recognized after installation. CaskaydiaCove Nerd Font uses the family name "CaskaydiaCove NF" but some terminal versions look for "CaskaydiaCove Nerd Font" or other variants.

### ryanoasis/nerd-fonts Issues

#### nerd-fonts#623 — CascadiaCode glyphs slightly above centerline
- **Severity**: LOW
- **Problem**: All CaskaydiaCove Regular Nerd Font glyphs render slightly above the vertical center of the cell. More noticeable in Windows Terminal than other emulators.

#### microsoft/cascadia-code#741 — Nerd Font glyphs are super small
- **Severity**: MEDIUM (2024-05-09)
- **Problem**: With Cascadia Code 2024 release, Nerd Font glyphs render much smaller than expected.

---

## 4. antialiasingMode: "grayscale" vs "cleartype"

### Technical Differences

| Aspect | Grayscale | ClearType |
|---|---|---|
| **Rendering** | Alpha-only antialiasing; shades of gray | Subpixel rendering; uses R, G, B subpixels independently |
| **Horizontal resolution** | 1x effective resolution | ~3x effective horizontal resolution |
| **Color fringing** | None | Visible color fringes on high-contrast edges (especially light-on-dark) |
| **DPI awareness** | Works well at all DPIs | Optimized for 96-144 DPI; can look worse at very high DPI |
| **Background dependency** | None — works identically on any background | **Requires known background color** for correct blending |
| **Transparency support** | Full — alpha compositing works naturally | **Broken with transparent backgrounds** — needs solid bg |

### Known Issues

#### #15957 — Atlas Engine ignores Cleartype and defaults to GrayScale
- **Severity**: HIGH
- **Status**: Open (2023-09-11)
- **Problem**: When using background transparency, the Atlas Engine falls back to grayscale even when `cleartype` is configured. ClearType requires a known background color for correct subpixel blending.
- **Impact on user's config**: User has `antialiasingMode: "grayscale"` which is actually the **default and recommended** setting for the Atlas Engine. This is the correct choice.

#### #5098 — Using cleartype makes dark foreground invisible on dark background
- **Severity**: HIGH (2020-03-24)
- **Problem**: ClearType antialiasing on dark backgrounds can cause text to appear nearly invisible because the subpixel color fringes blend into the dark background. The colored subpixels become perceptually dominant over the text shape.
- **Impact on user**: The Dracula theme (fg #F8F8F2 on bg #1A1B26) would be **affected** if using ClearType. Grayscale avoids this entirely.

#### #1298 — Feature Request: Antialiasing mode options
- **Severity**: FEATURE (2019-06-17)
- **Problem**: Users requested grayscale antialiasing because ClearType caused eye strain. The option was added in response.

#### #7946 — Turn off antialiasing completely
- **Severity**: LOW (2020-10-16)
- **Problem**: Users wanted aliased rendering option; later added as `"aliased"` mode.

### Dark vs Light Background Impact
- **Grayscale on dark (Dracula)**: Clean, no fringing. Text appears slightly softer/thicker than ClearType. **Recommended.**
- **Grayscale on light (Catppuccin Latte)**: Clean, no fringing. Text may appear slightly thinner than ClearType at small sizes. **Good.**
- **ClearType on dark**: Color fringing visible as red/blue halos around white text. Can make text look "rainbow" at edges. Problematic.
- **ClearType on light**: Best case for ClearType — subpixels blend naturally with white background. Sharpest possible text.

### Recommendation
The user's `"grayscale"` setting is optimal for their dual-theme setup (Dracula dark + Catppuccin Latte light). It provides consistent rendering across both themes without the color fringing issues that ClearType would introduce on the dark theme.

---

## 5. Font Size 13 Rendering

### Analysis
- Font size 13 is an **integer** size, so there should be no fractional-pixel issues in the font metrics.
- Windows Terminal's `fontSize` is in **points** (not pixels). At 96 DPI, 13pt ≈ 17.33px; at 144 DPI (150% scaling), 13pt ≈ 26px.
- The fractional pixel count (17.33px at 96 DPI) means glyphs may not align perfectly to the pixel grid.

### Known Issues

#### #6884 — FontSize not working
- **Severity**: LOW (2020-07-12)
- **Problem**: Font size setting ignored in some configurations. Workaround: set in `defaults` section.

#### #10353 — Awful font rendering quality
- **Severity**: MEDIUM (2021-06-07)
- **Problem**: Poor rendering at small font sizes (8pt). Not directly applicable to 13pt but illustrates that rendering quality varies significantly by size.

#### #4367 — Font rendering issue; characters appear at wrong size, position
- **Severity**: MEDIUM (2020-01-27)
- **Problem**: Intermittent rendering glitches with JetBrains Mono. Some characters appear at wrong size/position. Possibly related to font cache or atlas eviction.

#### #11376 — Some characters not rendered at small font sizes
- **Severity**: LOW (2021-09-30)
- **Problem**: At font size 8, some characters don't render. Not applicable to 13pt.

### Impact Assessment
Font size 13 is a **commonly used, well-tested size**. No specific bugs target size 13. The main consideration is that at 96 DPI, 13pt produces fractional pixel heights, which can cause slight baseline misalignment. At 144 DPI (common on laptops), 13pt maps to cleaner pixel values.

---

## 6. altGrAliasing: true — What It Does and Side Effects

### What It Does
`altGrAliasing` controls whether `Ctrl+Alt` is treated as an alias for `AltGr` (the right-hand Alt key used for international characters on non-US keyboards).

- **`true` (default)**: `Ctrl+Alt` = `AltGr`. Required for international keyboard layouts to type characters like `@`, `{`, `}`, `~`, etc.
- **`false`**: `Ctrl+Alt` and `AltGr` are separate. Useful for keybinding that uses `Ctrl+Alt` combos.

### Rendering Side Effects
**None.** This setting is purely about **input handling**, not rendering. It has zero impact on font rendering, antialiasing, or glyph display.

### Known Issues

#### #7372 — Setting altGrAliasing to false disables AltGr
- **Severity**: MEDIUM (2020-07-12)
- **Problem**: Setting to `false` can break international keyboard input entirely.

#### #6211 — Allow Ctrl+Alt <> AltGr aliasing to be disabled
- **Severity**: FEATURE (2020-05-26)
- **Problem**: Feature request that led to this setting.

### Impact Assessment
The user's `altGrAliasing: true` is the **default and safe choice**. It has no rendering impact.

---

## 7. Nerd Font Powerline Symbols Rendering

### How Windows Terminal Renders Powerline
As of the current Atlas Engine, Powerline glyphs (U+E0B0–U+E0BF: , , , etc.) are rendered as **builtin glyphs** using procedural D2D geometry, NOT from the font file.

This means:
- The font's Powerline glyphs are **bypassed** by the renderer
- Windows Terminal draws its own Powerline shapes using the cell dimensions
- This ensures pixel-perfect alignment and consistent line thickness
- The glyphs inherit the **foreground color** from the cell

### Color Inheritance
- Powerline glyphs use the cell's foreground color (set by ANSI color codes)
- They do NOT use the background color for the "filled" portion
- The left/right halves use the adjacent cell's background for the non-arrow area
- oh-my-posh and similar tools set separate foreground colors for each Powerline segment

### Width Issues
- Builtin Powerline glyphs are always 1 cell wide
- If the font contains wider Powerline glyphs (some Nerd Font patches set them to double-width), the builtin renderer still uses 1 cell
- This can cause mismatches if an application reads the font metrics and expects different widths

### Relevant Issues
- **#13029** — Powerline glyph does not fill whole cell/box height (2022-05-03)
- **#16729** — PR: Add support for custom box drawing and powerline glyphs

---

## 8. Unicode Box-Drawing Characters Rendering

### Current Implementation
Since the Atlas Engine improvements, box-drawing characters (U+2500–U+259F) are rendered as **builtin glyphs** using procedural D2D geometry. This replaced the earlier approach of using font glyphs.

### Known Issues

#### #1991 — Unicode box drawing rendering issues
- **Severity**: MEDIUM (2019-07-16)
- **Problem**: Box-drawing characters had gaps, misaligned lines, and incorrect thickness. Partially resolved by builtin glyph rendering.

#### #455 — Block and line drawing characters should fill cells
- **Severity**: MEDIUM (2019-05-07)
- **Problem**: Characters don't fill cells properly at all zoom levels. Critical for ANSI art and TUI apps.

#### #12678 — Unicode box-drawing not rendered in Consolas
- **Severity**: MEDIUM (2022-03-12)
- **Problem**: Consolas font lacks box-drawing glyphs; builtin rendering now handles this.

#### #13662 — Font features break line drawing
- **Severity**: MEDIUM (2022)
- **Problem**: OpenType font features (like ligatures) can interfere with box-drawing characters when the font's own glyphs are used instead of builtin ones.

#### #14654 — Box drawing characters contain gaps
- **Severity**: MEDIUM (2023-01-10)
- **Problem**: Gaps between adjacent box-drawing characters. Related to subpixel alignment.

#### #5897 — Investigate alternative ways to handle box drawing
- **Severity**: FEATURE (2020-05-13)
- **Problem**: Led to the builtin glyph approach. Gnome-terminal uses 5x5 bitmaps stretched to cell size; Windows Terminal uses D2D geometry.

### Current State
The builtin glyph renderer handles box-drawing well for most cases. Remaining issues:
- **Line thickness**: Builtin glyphs use fixed stroke widths that may not match the font's weight. With `"fontWeight": "normal"`, lines should be consistent.
- **Gaps at cell boundaries**: Subpixel rendering can leave 1px gaps between adjacent box-drawing characters, especially at non-integer DPI scales.

---

## 9. Font Hinting Differences Between Dark and Light Backgrounds

### Technical Background
Font hinting (TrueType instructions) adjusts glyph outlines to align with the pixel grid. It's applied **before** antialiasing and is independent of background color.

### How Background Affects Perception
- **Dark background (light text)**: Hinting makes text appear **thicker/heavier** because the bright pixels stand out against the dark surround. The eye's lateral inhibition makes bright-on-dark appear to "bloom."
- **Light background (dark text)**: Hinting makes text appear **thinner/sharper** because dark pixels on bright surround appear to shrink.
- This is a **perceptual** difference, not a rendering difference. The same hinted glyph is drawn identically.

### Impact on User's Config
- **Dracula** (light on dark): Text will appear slightly bolder than on light backgrounds
- **Catppuccin Latte** (dark on light): Text will appear slightly lighter/sharper
- `"fontWeight": "normal"` is the right choice — using `"bold"` would make dark-theme text too heavy
- The `intenseTextStyle: "bold"` setting only affects ANSI bold sequences (SGR 1), not regular text

### No Known Issues
There are no Windows Terminal-specific bugs about hinting differences between dark and light backgrounds. This is an inherent perceptual property of all displays.

---

## 10. Subpixel Rendering on High-DPI vs Standard-DPI

### Technical Details
- **Standard DPI (96 DPI, 100% scaling)**: ClearType subpixel rendering provides ~3x effective horizontal resolution. Each pixel has R, G, B subpixels that can be independently shaded.
- **High DPI (192+ DPI, 200%+ scaling)**: Subpixels become invisible to the naked eye. ClearType's advantage diminishes significantly.
- **4K at 27" (~163 DPI)**: Subpixels are still somewhat visible; ClearType provides marginal benefit.

### Behavior in Windows Terminal
- At high DPI, Windows may automatically reduce or disable ClearType subpixel rendering
- The Atlas Engine renders at the native resolution without implicit scaling (fixed in #5320)
- Grayscale antialiasing becomes increasingly effective at higher DPIs because the pixel grid is dense enough that aliasing is less visible

### Relevant Issues

#### #5320 — Remove implicit scaling to improve performance and crispness
- **Severity**: MEDIUM (2020-04-10)
- **Problem**: At high DPI, the old renderer scaled the entire D2D render target, causing fractional pixel heights/baselines. The Atlas Engine renders at native resolution.

### Impact on User's Config
- If on a standard-DPI display (96-120 DPI): Grayscale AA may look slightly softer than ClearType. Consider testing `cleartype` if on a light theme only.
- If on a high-DPI display (144+ DPI): Grayscale AA is nearly indistinguishable from ClearType and avoids all subpixel issues. **Grayscale is optimal.**
- The user's `antialiasingMode: "grayscale"` works well at any DPI.

---

## 11. Font Rendering Differences Between BackendD3D and BackendD2D

### Backend Selection
- **BackendD3D** (default): Used when the GPU supports Direct3D 11.0+ with compute shaders. Uses GPU instancing, glyph atlas texture, and HLSL shaders.
- **BackendD2D** (fallback): Used on older GPUs (below feature level 10.1), WARP software adapters, or when explicitly selected. Uses Direct2D's native text rendering.

### Rendering Differences

| Aspect | BackendD3D | BackendD2D |
|---|---|---|
| **Text quality** | Identical (same DirectWrite rasterizer) | Identical |
| **Performance** | Much faster (GPU instancing) | Slower (CPU-bound D2D draw calls) |
| **Antialiasing** | Grayscale/ClearType via shader | Grayscale/ClearType via D2D |
| **Box-drawing** | Procedural geometry via builtin glyphs | D2D SpriteBatch or fallback |
| **Custom shaders** | Supported (retro effects) | Not supported |
| **Transparency** | Supported (with grayscale AA fallback) | Supported |

### Relevant Issues

#### #15359 — AtlasEngine: Text rendering differences between D2D and D3D
- **Severity**: MEDIUM (2023-05-15)
- **Problem**: Visible text rendering differences between the two backends. D3D uses the glyph atlas with instanced rendering; D2D uses standard D2D draw calls. The glyph rasterization is identical (same DirectWrite), but the composition step differs.
- **Key difference**: D3D may apply additional shader processing (e.g., gamma correction, contrast enhancement) that D2D does not. This can cause subtle differences in perceived text weight and sharpness.

### Impact on User's Config
The user will be using **BackendD3D** (the default on any modern GPU). No action needed. If experiencing rendering issues, switching to D2D via `"experimental.useAtlasEngine": false` (which uses the old DxRenderer) is a diagnostic step but not a long-term solution.

---

## 12. CaskaydiaCove vs Cascadia Code Differences in Windows Terminal

### Relationship
- **Cascadia Code**: Microsoft's official open-source monospaced font. Comes in two variants:
  - Cascadia Code — with ligatures
  - Cascadia Mono — without ligatures
  - Cascadia Code PL / Cascadia Mono PL — with Powerline glyphs (now deprecated; Powerline is builtin)
- **CaskaydiaCove Nerd Font**: Community-patched version of Cascadia Code by the Nerd Fonts project. Adds:
  - 10,000+ icon glyphs (FontAwesome, Material Design, Devicons, etc.)
  - Powerline glyphs (now redundant since WT renders them built-in)
  - Extra symbols from various icon sets

### Key Differences for Rendering

| Aspect | Cascadia Code | CaskaydiaCove NF |
|---|---|---|
| **Glyph count** | ~1,500 | ~11,500+ |
| **Atlas pressure** | Low | High (many more glyphs to cache) |
| **Ligatures** | Yes (Code), No (Mono) | Yes (based on Code variant) |
| **Powerline** | Built-in (PL variants) or WT builtin | Font-provided (but WT may bypass) |
| **Font family name** | "Cascadia Code" / "Cascadia Mono" | "CaskaydiaCove Nerd Font" / "CaskaydiaCove NF" |
| **OpenType tables** | Clean, Microsoft-maintained | Patched; may have corrupted tables |
| **Update cadence** | Regular Microsoft updates | Lagged behind Cascadia updates |
| **File size** | ~1 MB | ~4-8 MB |

### Known Issues Specific to CaskaydiaCove
1. **Ligature conflicts**: Nerd Font patching can break Cascadia Code's ligature tables, causing rendering glitches with character sequences (see #16413).
2. **Glyph width mismatches**: Some Nerd Font icons are set to incorrect advance widths in CaskaydiaCove (see #11769).
3. **Vertical alignment**: Icons render slightly above centerline (nerd-fonts#623).
4. **Font recognition**: Terminal may not find the font if the family name doesn't match exactly (see #12587, #14173).

### Microsoft's Official Nerd Font Variant (2024+)
Microsoft released **Cascadia Code NF** (Nerd Font) as an official variant starting with the 2024 release. This is a properly integrated Nerd Font that:
- Maintains clean OpenType tables
- Includes all Nerd Font icons
- Is maintained alongside regular Cascadia Code
- Should be preferred over CaskaydiaCove NF

### Recommendation
The user should consider migrating from **CaskaydiaCove Nerd Font** to **Cascadia Code NF** (Microsoft's official Nerd Font variant). Benefits:
- Fewer rendering bugs (clean OpenType tables)
- Regular updates with Cascadia Code
- Better Windows Terminal integration
- Built-in Powerline glyphs that work with WT's builtin renderer

---

## Summary: Impact Assessment for User's Config

### Config Review
```json
{
  "font": "CaskaydiaCove Nerd Font",
  "fontSize": 13,
  "fontWeight": "normal",
  "antialiasingMode": "grayscale",
  "intenseTextStyle": "bold",
  "altGrAliasing": true
}
```

### Issues by Severity

| # | Issue | Severity | Directly Affects User? |
|---|---|---|---|
| 11769 | Nerd Font glyph width mismatches | HIGH | YES — CaskaydiaCove NF specific |
| 15957 | Atlas Engine ignores ClearType | LOW | NO — user uses grayscale |
| 5098 | ClearType on dark backgrounds | LOW | NO — user uses grayscale |
| 16413 | Wavy rendering with CaskaydiaCove | MEDIUM | Possible with specific char sequences |
| 16925 | Weird rendering with oh-my-posh | MEDIUM | Possible if using oh-my-posh |
| 16852 | Font/emoji spacing issues | MEDIUM | Possible with Nerd Font icons |
| 13029 | Powerline glyph height | LOW | Partially — builtin renderer handles this now |
| 14654 | Box-drawing gaps | LOW | Possible with TUI apps |
| 15359 | D2D vs D3D rendering differences | LOW | User uses D3D (default) |
| 623 | Glyphs above centerline | LOW | Yes, cosmetic |
| 5320 | High DPI scaling issues | LOW | Fixed in Atlas Engine |

### Recommended Actions
1. **Consider switching to Cascadia Code NF** (Microsoft's official Nerd Font) to avoid CaskaydiaCove-specific rendering bugs
2. **Keep `antialiasingMode: "grayscale"`** — optimal for dual dark/light theme setup
3. **Keep `altGrAliasing: true`** — no rendering impact, required for international keyboards
4. **Font size 13 is fine** — no known issues at this size
5. **If TUI rendering has gaps**: Report with specific screenshots; the builtin glyph renderer has improved significantly but subpixel gaps can still occur at certain DPI scales
