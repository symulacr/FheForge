# Windows Terminal Atlas Engine Rendering — Color Display Findings

## Summary

Windows Terminal's Atlas Engine (the default renderer since v1.18) has multiple known issues and architectural characteristics that affect color display fidelity. This document catalogues findings from GitHub issues, Microsoft documentation, and source code analysis, organized by the user's specific configuration profile.

---

## User Configuration Profile

```json
{
  "antialiasingMode": "grayscale",
  "useAcrylic": true,
  "opacity": 80,
  "unfocusedAppearance": { "opacity": 60, "useAcrylic": true },
  "font": { "face": "CaskaydiaCove Nerd Font" },
  "useMica": true,
  "useAcrylicInTabRow": true,
  "enableUnfocusedAcrylic": true
}
```

---

## 1. Atlas Engine Architecture: BackendD3D vs BackendD2D

### Architecture Overview
Atlas Engine has two backends selected during `_recreateBackend` (in `AtlasEngine.r.cpp:168-185`):

| Backend | Selection Criteria | Color Pipeline |
|---------|-------------------|----------------|
| **BackendD3D** | Primary; requires D3D 11.0+ with compute shader support | GPU-instanced rendering via glyph atlas texture; HLSL pixel shader (`shader_ps.hlsl`) handles text blending |
| **BackendD2D** | Fallback for older hardware or WARP (software) adapters | Uses Direct2D's native text rendering pipeline; `BeginDraw()` → `_drawBackground()` → `_drawText()` → `_drawCursor()` → `EndDraw()` |

### Color Rendering Differences Between Backends

**BackendD3D** renders glyphs from a GPU-resident glyph atlas texture. Each `QuadInstance` carries position, texture coordinates, and color. The pixel shader (`shader_ps.hlsl`) applies different shading modes:
- `SHADING_TYPE_TEXT` — standard grayscale/ClearType blending
- `SHADING_TYPE_TEXT_BUILTIN_GLYPH` — checkerboard/fill patterns for box-drawing characters (U+2500–U+259F, U+E0B0–U+E0BF)
- `SHADING_TYPE_LINE` — underline/strikethrough rendering

**BackendD2D** uses standard Direct2D text rendering, which may produce subtly different color blending behavior for the same input, particularly with antialiasing and subpixel rendering.

### Relevance to User Config
The user's GPU determines which backend is used. If the GPU lacks D3D 11.0+ compute shader support, the D2D fallback will be used, which may render colors differently.

**Severity**: Medium — affects all users on fallback hardware.

---

## 2. Atlas Engine vs Legacy Renderer Color Accuracy

### Key Issues

| Issue | # | Severity | Description |
|-------|---|----------|-------------|
| Atlas Engine ignores ClearType, defaults to Grayscale | [#15957](https://github.com/microsoft/terminal/issues/15957) | **High** | When background transparency is enabled, Atlas Engine forces grayscale antialiasing regardless of ClearType setting. The user has `antialiasingMode: "grayscale"` AND transparency (`opacity: 80`), so this issue *confirms* the user's explicit choice, but it means ClearType is *never* available when transparency is on. |
| Color output not working with Atlas Engine (MSYS2) | [msys2/msys2-runtime#151](https://github.com/msys2/msys2-runtime/issues/151) | Medium | ANSI color output fails under certain conditions with Atlas Engine enabled. |
| Colors all broken after Windows Update | [#12901](https://github.com/microsoft/terminal/issues/12901) | Medium | Windows updates can break the rendering pipeline, causing washed-out colors. |

### Impact on User Config
The user already uses `grayscale` antialiasing, so the ClearType override bug (#15957) doesn't change behavior — but it confirms that **grayscale will be forced regardless** because transparency is enabled.

**Severity**: Low (for this user specifically — their explicit grayscale choice matches the forced behavior).

---

## 3. GPU Shader Color Processing (HLSL Color Space Handling)

### Shader Pipeline Details

The `BackendD3D` pixel shader (`shader_ps.hlsl:30-182`) processes colors in this order:

1. **Vertex Shader** (`shader_vs.hlsl`): Transforms quad instances from cell coordinates to screen space
2. **Pixel Shader** (`shader_ps.hlsl`):
   - Samples the glyph atlas texture
   - Applies antialiasing blending (grayscale or ClearType)
   - For builtin glyphs, applies checkerboard patterns based on color channels
   - Outputs to the swap chain

### Color Space Issues

| Concern | Details | Severity |
|---------|---------|----------|
| **sRGB vs Linear color space** | The swap chain operates in sRGB. Color blending in sRGB space (instead of linear) produces mathematically incorrect results when alpha compositing. The `opacity: 80` setting triggers alpha blending that occurs in sRGB space, causing perceptual color shifts. | **High** |
| **Premultiplied alpha** | Windows uses premultiplied alpha for composition. The DXGI swap chain's `AlphaMode` affects how colors are composited with the desktop. Premultiplied alpha in sRGB space compounds the color accuracy issue. | Medium |
| **Custom shader support** | Atlas Engine supports user-provided HLSL pixel shaders for post-processing (`experimental.pixelShaderPath`). If a custom shader is active, it renders to an offscreen texture first, adding another color transformation step. | Low (unless custom shaders are used) |

### Relevance to User Config
The `opacity: 80` setting triggers alpha blending through the shader pipeline. With sRGB-encoded color values, the formula `output = foreground * alpha + background * (1 - alpha)` produces slightly desaturated results compared to proper linear-space blending. This is a fundamental Windows/DirectX limitation, not a Terminal bug.

**Severity**: High — affects all semi-transparent Terminal configurations.

---

## 4. Acrylic + Atlas Engine Interaction Bugs

### Key Issues

| Issue | # | Severity | Description |
|-------|---|----------|-------------|
| Acrylic transparency not working | [#1414](https://github.com/microsoft/terminal/issues/1414) | High | `useAcrylic: true` with opacity settings sometimes produces a solid color instead of blur effect. |
| Acrylic stopped working (Win10 22H2) | [#18189](https://github.com/microsoft/terminal/issues/18189) | High | On Windows 10 22H2, acrylic background may stop functioning entirely. |
| Acrylic opacity doesn't work on Win10 20.04 | [#7047](https://github.com/microsoft/terminal/issues/7047) | High | Acrylic opacity was intermittently broken on specific Windows builds. |
| Acrylic background does not work | [#5698](https://github.com/microsoft/terminal/issues/5698) | Medium | Acrylic effect fails to render on certain configurations. |
| Acrylic effect goes away when window loses focus | [#3497](https://github.com/microsoft/terminal/issues/3497) | Medium | Before `enableUnfocusedAcrylic` was implemented, acrylic disappeared on focus loss. |
| Background opacity and acrylic not working | [#17367](https://github.com/microsoft/terminal/issues/17367) | Medium | Opacity and acrylic both fail simultaneously on some builds. |

### Technical Color Impact of Acrylic

The Windows Acrylic material applies:
1. **Luminosity blend** — blends the backdrop using luminosity values
2. **Gaussian blur** — applies a blur to the backdrop content
3. **Tint layer** — applies a semi-transparent color tint (derived from the Terminal's background color + opacity)
4. **Noise texture** — adds a subtle noise overlay

**Color desaturation**: The luminosity blend step inherently reduces color saturation. At `opacity: 80`, the tint layer is relatively opaque (80%), which reduces the desaturation effect. However, the interaction between the Terminal's background color, the desktop wallpaper, and the acrylic material produces perceptual color shifts that can make terminal text appear less vibrant.

### Impact on User Config
- `useAcrylic: true` + `opacity: 80`: Active acrylic with relatively high opacity. The blur effect will be visible but the tint layer dominates. Colors should appear close to the configured scheme but with slight desaturation from the luminosity blend.
- `unfocusedAppearance: { opacity: 60, useAcrylic: true }`: At 60% opacity, the backdrop shows through more, increasing desaturation and blur artifacts when the window is unfocused.

**Severity**: High — the acrylic material fundamentally alters color perception.

---

## 5. Mica Material Affecting Background Color Perception

### Key Issues

| Issue | # | Severity | Description |
|-------|---|----------|-------------|
| Add support for Mica material | [#10509](https://github.com/microsoft/terminal/issues/10509) | Feature request (implemented) | Mica was added as a theme option. |
| Latest Windows Update broke Mica effect | [WinCustomize Forums](https://forums.wincustomize.com/541590/latest-windows-update-screwed-up-the-mica-effect) | Medium | Recent Windows updates have broken Mica rendering for some users, producing 2-toned solid colors instead of the expected effect. |
| Mica theme issues on dark mode | [DevUtils/WingetUI#1654](https://github.com/marticliment/WingetUI/issues/1654) | Medium | Mica produces unexpected results in dark mode. |

### How Mica Affects Color Perception

Mica is an **opaque, dynamic material** that:
- Samples the user's desktop wallpaper and applies a tint based on the app's requested background color
- Is static (doesn't update live when wallpaper changes — only on window creation)
- Creates a subtle color wash that varies based on the desktop wallpaper

**Critical interaction**: Per Microsoft docs, when Mica is enabled and `opacity < 100`, Mica appears *underneath* the Terminal contents. This means the user's `opacity: 80` setting creates a **layered composition**:
1. Desktop wallpaper (visible through Mica)
2. Mica tint layer (wallpaper-derived static color)
3. Terminal background color (at 80% opacity)
4. Terminal text/content

### Impact on User Config
- `useMica: true` + `opacity: 80`: The Mica material appears underneath the semi-transparent terminal, creating a complex multi-layer compositing effect. The perceived background color is a blend of the wallpaper-derived Mica tint and the terminal's configured background color at 80% alpha.
- This multi-layer composition means the **perceived background color changes based on the desktop wallpaper**, which can make text contrast ratios unpredictable.

**Severity**: Medium-High — wallpaper-dependent color behavior.

---

## 6. Opacity Rendering Pipeline — Alpha Blending and Final Colors

### Pipeline Architecture

```
Terminal Content (sRGB)
    ↓
Atlas Engine BackendD3D/D2D
    ↓
DXGI Swap Chain (sRGB, premultiplied alpha)
    ↓
DWM Composition
    ↓
  ┌─ Mica layer (if useMica: true, appears below content)
  ├─ Acrylic blur + tint (if useAcrylic: true)
  ├─ Terminal background (at configured opacity)
  └─ Terminal foreground text
    ↓
Final Display (sRGB)
```

### Color Accuracy Issues in the Pipeline

| Stage | Issue | Impact |
|-------|-------|--------|
| **sRGB blending** | Alpha blending in sRGB space instead of linear produces incorrect results. `lerp(srgb_a, srgb_b, t)` ≠ `srgb(lerp(linear_a, linear_b, t))`. At `t=0.2` (80% opacity), the error is small but measurable. | Slight color desaturation |
| **Premultiplied alpha compositing** | The swap chain uses premultiplied alpha for DWM composition. Colors must be correctly premultiplied to avoid dark fringes or washed-out edges. | Potential edge artifacts |
| **Double alpha application** | With both `useAcrylic: true` and `opacity: 80`, there are TWO alpha operations: the acrylic material's own transparency AND the Terminal's opacity setting. These compound multiplicatively. | Colors may appear more transparent than expected |
| **Gamma-correct blending** | The DWM performs gamma-correct blending when compositing with the desktop, but intermediate shader passes may not. | Inconsistent color at different stages |

### Impact on User Config
The user's configuration creates a **triple-layer transparency effect**:
1. Acrylic blur material (has its own transparency)
2. Terminal opacity at 80%
3. Mica material underneath

These three effects compound, potentially producing colors that differ significantly from what the color scheme defines.

**Severity**: High — this is the most impactful category for the user's specific configuration.

---

## 7. DirectWrite Color Font Rendering (Emoji, Nerd Font Glyphs)

### Key Issues

| Issue | # | Severity | Description |
|-------|---|----------|-------------|
| AtlasEngine rendering wide Nerd Font glyphs incorrectly | [#14022](https://github.com/microsoft/terminal/issues/14022) | **High** | Wide (double-width) Nerd Font glyphs are rendered incorrectly by Atlas Engine. Affects UbuntuMono Nerd Font. |
| Special glyphs slightly malformed / text slightly blurry with Atlas Engine | [#14057](https://github.com/microsoft/terminal/issues/14057) | **High** | Special glyphs (including Nerd Font icons) appear malformed or blurry. Partly affects MacType. |
| Double wide nerd font glyphs rendered incorrectly in v1.21 | [#17228](https://github.com/microsoft/terminal/issues/17228) | **High** | Regression in v1.21 where double-wide Nerd Font glyphs are broken. Affects status bars and prompt lines. |
| Atlas Engine does not render stylistic sets | [#15896](https://github.com/microsoft/terminal/issues/15896) | Medium | OpenType stylistic sets don't render properly in Atlas Engine. |

### DirectWrite Color Font Architecture

DirectWrite supports multiple color font formats:

| Format | Description | Relevance to CaskaydiaCove Nerd Font |
|--------|-------------|--------------------------------------|
| **COLR/CPAL** | Layered colored vectors | Nerd Font glyphs use this for some icons |
| **SVG** | SVG-embedded glyphs | Not typically used by Nerd Fonts |
| **CBDT/CBLC** | Color bitmaps | Not typically used by Nerd Fonts |
| **sbix** | Embedded bitmap images | Not typically used by Nerd Fonts |

### How Atlas Engine Handles Color Glyphs

Atlas Engine uses `IDWriteFontFallback` for character mapping and `IDWriteTextAnalyzer` for complex shaping. For color glyphs:
1. Text is shaped using DirectWrite (monochrome glyph IDs)
2. The glyph atlas texture stores rasterized bitmaps of each glyph
3. The pixel shader applies foreground color to monochrome glyphs
4. **Color glyphs (emoji, COLR-based icons) require special handling** via `TranslateColorGlyphRun` — if this is not correctly invoked, color glyphs may be rendered in monochrome.

### CaskaydiaCove Nerd Font Specific Issues

CaskaydiaCove Nerd Font is a patched version of Cascadia Code with Nerd Font glyphs added. These glyphs:
- Are typically in the Unicode Private Use Area (PUA): U+E000–U+F8FF, U+F0000–U+FFFFF
- Include Powerline symbols (U+E0B0–U+E0BF) — these are **procedurally generated** by Atlas Engine's `BuiltinGlyphs.h` system, not from the font file
- Include file/folder/devop icons that may be COLR-based or monochrome

**Atlas Engine's builtin glyph system** (`BuiltinGlyphs.cpp:17-136`) generates Powerline characters procedurally using D2D geometries and renders them with `SHADING_TYPE_TEXT_BUILTIN_GLYPH`. This means:
- Powerline glyphs will have **consistent rendering** regardless of the font file
- But they may look **different from what the font designer intended**
- The checkerboard pattern in the shader (`shader_ps.hlsl:71-151`) uses color channel analysis to determine fill behavior

**Severity**: High — directly affects the user's CaskaydiaCove Nerd Font experience.

---

## 8. ClearType vs Grayscale Antialiasing Color Fringing on Dark Backgrounds

### Key Issues

| Issue | # | Severity | Description |
|-------|---|----------|-------------|
| Atlas Engine ignores ClearType, defaults to Grayscale | [#15957](https://github.com/microsoft/terminal/issues/15957) | **High** | When any transparency is enabled, Atlas Engine forces grayscale antialiasing regardless of the user's ClearType setting. This is an intentional design decision because ClearType subpixel rendering is incompatible with transparent backgrounds (the RGB subpixel offsets would create colored fringes visible through the transparency). |

### Technical Explanation

**ClearType** renders text by using the individual R, G, B subpixels of LCD displays to increase effective horizontal resolution. This produces color fringing (colored pixels at glyph edges) that is normally invisible against opaque backgrounds.

**Grayscale antialiasing** uses only the alpha channel to smooth glyph edges, producing uniform gray pixels at boundaries.

**Why transparency forces grayscale**: When the background is semi-transparent, the underlying desktop wallpaper shows through. ClearType's colored subpixel fringes become visible against the changing backdrop, producing distracting color artifacts. Atlas Engine's decision to force grayscale with transparency is technically correct.

### Color Impact on Dark Backgrounds

On dark backgrounds (common with dark color schemes):
- **Grayscale antialiasing**: Text edges appear as subtle gray halos. On dark backgrounds, these halos are visible as slightly lighter pixels around characters, which can make text appear "fuzzy" or less crisp than ClearType.
- **Color perception**: The gray halos blend with the semi-transparent background, potentially reducing perceived contrast.
- **No color fringing**: Grayscale eliminates the rainbow-like edge artifacts that ClearType would produce on transparent backgrounds.

### Impact on User Config
- `antialiasingMode: "grayscale"` + `opacity: 80`: The user has explicitly chosen grayscale AND has transparency enabled. This is the correct/optimal configuration. However, text will appear slightly less crisp than it would with ClearType on an opaque background.
- The combination of grayscale AA + acrylic blur + Mica tint creates a "soft" visual appearance that some users perceive as "washed out."

**Severity**: Low (user's explicit choice is compatible with the forced behavior).

---

## 9. Compound Effects Specific to This Configuration

The user's configuration creates a **worst-case scenario for color fidelity** due to multiple compounding transparency and material effects:

### Layer Stack (bottom to top)
1. **Desktop wallpaper** (varies dynamically)
2. **Mica material** (wallpaper-derived static tint, opaque)
3. **Acrylic blur** (Gaussian blur of backdrop + luminosity blend + noise)
4. **Terminal background** (80% opacity when focused, 60% when unfocused)
5. **Terminal text** (fully opaque foreground)
6. **Tab row** (additional acrylic layer via `useAcrylicInTabRow: true`)

### Perceived Color Issues
1. **Desaturation**: Acrylic's luminosity blend reduces color saturation of everything behind it
2. **Contrast reduction**: Multiple alpha-blending layers reduce the effective contrast between foreground text and the composite background
3. **Wallpaper dependency**: Mica causes the perceived background color to shift based on the desktop wallpaper
4. **Focus state color shift**: The 20% opacity difference between focused (80%) and unfocused (60%) creates a noticeable color/brightness shift when switching windows
5. **Grayscale AA softness**: Text appears softer than ClearType, compounded by the acrylic blur effect underneath

### Recommendations (out of scope but noted)
- Increase `opacity` to 90-95 for better color fidelity while retaining some transparency
- Consider `useMica: false` to eliminate wallpaper-dependent color behavior
- Use `antialiasingMode: "cleartype"` with `opacity: 100` if maximum text crispness is desired (but this eliminates all transparency)

---

## 10. Complete Issue Reference Table

| # | Issue | URL | Severity | Category |
|---|-------|-----|----------|----------|
| #15957 | Atlas Engine ignores ClearType, defaults to Grayscale | [Link](https://github.com/microsoft/terminal/issues/15957) | High | Antialiasing |
| #16585 | Atlas Engine fails to colour a character at certain text sizes | [Link](https://github.com/microsoft/terminal/issues/16585) | Medium | Color rendering |
| #14022 | AtlasEngine rendering wide Nerd Font glyphs incorrectly | [Link](https://github.com/microsoft/terminal/issues/14022) | High | Nerd Font |
| #17228 | Double wide nerd font glyphs rendered incorrectly in v1.21 | [Link](https://github.com/microsoft/terminal/issues/17228) | High | Nerd Font |
| #14057 | Special glyphs slightly malformed / text slightly blurry | [Link](https://github.com/microsoft/terminal/issues/14057) | High | Nerd Font |
| #15896 | Atlas engine does not render stylistic sets | [Link](https://github.com/microsoft/terminal/issues/15896) | Medium | Font rendering |
| #12901 | Window colors are all broken (washed out) | [Link](https://github.com/microsoft/terminal/issues/12901) | Medium | Color |
| #1414 | Acrylic transparency not working | [Link](https://github.com/microsoft/terminal/issues/1414) | High | Acrylic |
| #18189 | Acrylic stopped working | [Link](https://github.com/microsoft/terminal/issues/18189) | High | Acrylic |
| #7047 | Acrylic opacity doesn't always work on Win10 20.04 | [Link](https://github.com/microsoft/terminal/issues/7047) | High | Acrylic |
| #17367 | Background opacity and acrylic not working | [Link](https://github.com/microsoft/terminal/issues/17367) | Medium | Acrylic |
| #3497 | Acrylic effect goes away when window loses focus | [Link](https://github.com/microsoft/terminal/issues/3497) | Medium | Acrylic |
| #11092 | Add Acrylic/Opacity support in Unfocused Appearance | [Link](https://github.com/microsoft/terminal/issues/11092) | Feature | Unfocused |
| #15913 | Adjust Opacity to 100% with Color Scheme in Unfocused | [Link](https://github.com/microsoft/terminal/issues/15913) | Medium | Unfocused |
| #17997 | unfocusedAppearance resets terminal background color | [Link](https://github.com/microsoft/terminal/issues/17997) | Medium | Unfocused |
| #20054 | Fix tab row acrylic in unfocused windows still an issue | [Link](https://github.com/microsoft/terminal/issues/20054) | Medium | Tab row |
| #10509 | Add support for Mica material | [Link](https://github.com/microsoft/terminal/issues/10509) | Feature | Mica |
| #15199 | Graphical glitches when using hardware rendering | [Link](https://github.com/microsoft/terminal/issues/15199) | Medium | Rendering |
| #13853 | Atlas engine should support user-customizable pixel shaders | [Link](https://github.com/microsoft/terminal/issues/13853) | Feature | Shaders |
| #10461 | Add a DxRenderer based on a glyph atlas (original Atlas Engine proposal) | [Link](https://github.com/microsoft/terminal/issues/10461) | Historical | Architecture |

---

## 11. Source Code References

| File | Path | Relevance |
|------|------|-----------|
| AtlasEngine.h | `src/renderer/atlas/AtlasEngine.h` | Core engine header, settings structures |
| AtlasEngine.cpp | `src/renderer/atlas/AtlasEngine.cpp` | Text shaping, buffer flushing |
| AtlasEngine.api.cpp | `src/renderer/atlas/AtlasEngine.api.cpp` | Invalidation tracking, scroll handling |
| AtlasEngine.r.cpp | `src/renderer/atlas/AtlasEngine.r.cpp` | Backend selection logic |
| BackendD3D.h | `src/renderer/atlas/BackendD3D.h` | QuadInstance, shader constant buffers |
| BackendD3D.cpp | `src/renderer/atlas/BackendD3D.cpp` | D3D rendering pipeline, custom shader support |
| BackendD2D.h/cpp | `src/renderer/atlas/BackendD2D.h/.cpp` | D2D fallback rendering |
| shader_ps.hlsl | `src/renderer/atlas/shader_ps.hlsl` | Pixel shader (text blending, builtin glyphs) |
| dwrite_helpers.hlsl | `src/renderer/atlas/dwrite_helpers.hlsl` | DirectWrite shader helpers |
| BuiltinGlyphs.cpp | `src/renderer/atlas/BuiltinGlyphs.cpp` | Procedural Powerline glyph generation |
| common.h | `src/renderer/atlas/common.h` | Generational settings, shared types |

---

*Generated: 2026-05-27*
