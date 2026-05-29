# Windows Terminal Renderer — Missing Display Elements

## Context & Config Sensitivity

User's configuration:
- **Font**: CaskaydiaCove Nerd Font, size 13, weight normal
- **Font features**: `liga=1, ss01=1, calt=1` (ligatures, stylistic set 01, contextual alternates)
- **Antialiasing**: `"grayscale"`
- **Opacity**: 100, useAcrylic: false, useMica: true
- **Cursor**: bar, height 25
- **Padding**: "8"
- **Themes**: Dracula (dark), Catppuccin Latte (light)

---

## 1. Atlas Engine — Stylistic Sets / Font Features NOT Rendered

**Critical for this config** — `ss01=1` and other OpenType features.

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#15896](https://github.com/microsoft/terminal/issues/15896) | Atlas engine does not render stylistic sets | **Open** | `ss01`, `ss02`, etc. are silently ignored by Atlas Engine |
| [#9999](https://github.com/microsoft/terminal/issues/9999) | AtlasEngine megathread: bugs and missing features | Tracking | Lists many font feature gaps |

**Details**: The Atlas Engine (default renderer since WT 1.16+) does **not** pass OpenType stylistic set features (`ss01`–`ss20`) to DirectWrite's shaping engine. This means `ss01=1` in the user config has **no effect** on glyph selection. The legacy DxEngine did support these.

**Specific impact on CaskaydiaCove Nerd Font**: Cascadia Code's `ss01` changes the `i` to a barred-i variant, among other glyph changes. These will not activate.

---

## 2. Nerd Font Glyphs — Wrong Widths / Broken Rendering

**Critical for this config** — CaskaydiaCove Nerd Font is explicitly used.

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#11769](https://github.com/microsoft/terminal/issues/11769) | Some glyphs in Nerd Fonts are rendered with wrong widths | Closed (dup of #6864) | Material Design icons (U+F0000+) render at wrong cell width |
| [#6864](https://github.com/microsoft/terminal/issues/6864) | Glyphs outside BMP rendered with wrong width | **Open** | Nerd Font glyphs in Supp. Private Use Area rendered double-wide |
| [#17228](https://github.com/microsoft/terminal/issues/17228) | Double wide nerd font glyphs rendered incorrectly in 1.21 | **Open** | UbuntuMono NF double-wide chars break layout |
| [#16413](https://github.com/microsoft/terminal/issues/16413) | Weird glyph rendering with CaskaydiaCove NerdFont | Open | Wavy rendering when typing consecutive chars |
| [#16925](https://github.com/microsoft/terminal/issues/16925) | Weird rendering on CaskaydiaCove Nerd Font Mono | Open | Broken display with oh-my-posh |

**Specific characters that fail**:
- `nf-mdi-play` (U+F0909), `nf-mdi-stop` (U+F09DA) — rendered with wrong advance width
- Material Design Icons range (U+F0001–U+F1AF0) — most affected
- Glyphs in Supplementary Private Use Area (U+F0000+) — width calculation wrong

**Root cause**: NF Patcher does not insert correct glyph advances for codepoints outside the BMP. WT batches text by runs rather than cells, so deficient font data causes misalignment. Other terminals (Alacritty, Kitty) are cell-based and compensate.

---

## 3. Box Drawing / Block Elements — Rendering Gaps

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#5897](https://github.com/microsoft/terminal/issues/5897) | Investigate alternative ways to handle box drawing/block elements | **Closed (v1.21)** | Fixed via `compatibility.allowBuiltinBlockDrawing` |
| [#12512](https://github.com/microsoft/terminal/issues/12512) | AtlasEngine breaks draw-box rendering | Closed | Box drawing was broken under Atlas in 1.13 |
| [#455](https://github.com/microsoft/terminal/issues/455) | Block and line drawing chars fill cells properly | Closed | Cells must be filled at all zoom levels |
| [#12678](https://github.com/microsoft/terminal/issues/12678) | Box-drawing not rendered in Consolas | Open | Font-specific: Consolas lacks some box drawing glyphs |
| [#1991](https://github.com/microsoft/terminal/issues/1991) | Unicode box drawing rendering issues | Closed | Various box drawing failures |

**Resolution (v1.21+)**: WT now has `compatibility.allowBuiltinBlockDrawing` (default: true) which renders pixel-perfect box drawing/block element glyphs directly, replacing font glyphs. This covers:
- Box Drawing (U+2500–U+257F)
- Block Elements (U+2580–U+259F)
- Powerline glyphs (U+E0B0–U+E0B3, U+E0B4–U+E0BF)

**Remaining issue**: Shading characters (░ U+2591, ▒ U+2592, ▓ U+2593) still render poorly at certain font sizes. The pattern distorts or disappears at non-ideal DPI/font-size combos. Font size 13 in the user config may or may not hit this.

---

## 4. Braille Characters — Missing in Default Fonts

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#12314](https://github.com/microsoft/terminal/issues/12314) | ⠋ character not rendering | Open | Braille spinners (U+2800–U+28FF) not in Consolas |
| [#385](https://github.com/microsoft/terminal/issues/385) | Include Braille characters in Consolas | Open | Default font lacks braille glyphs |

**Impact**: Braille-pattern spinners used by CLI tools (nanospinner, ora, etc.) show as missing glyph boxes with Consolas. With CaskaydiaCove Nerd Font, braille glyphs are included and should render correctly.

---

## 5. Emoji Rendering — Partial Support with Gaps

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#11822](https://github.com/microsoft/terminal/issues/11822) | Broken rendering/editing/caret with emoji sequences | Open | ZWJ sequences break cursor/caret |
| [#19100](https://github.com/microsoft/terminal/issues/19100) | Color emoji with Variation Selector-16 (U+FE0F) cannot render | Open | Poker suits ♥+VS16 fail |
| [#16852](https://github.com/microsoft/terminal/issues/16852) | Font/Emoji rendering spacing issue | Open | Emoji spacing is wrong |
| [#16679](https://github.com/microsoft/terminal/issues/16679) | Emojis not displayed properly | Open | Various emoji display failures |
| [#190](https://github.com/microsoft/terminal/issues/190) | Add emoji support to Windows Console | Tracking | Master emoji tracking issue |

**Specific failures**:
- **ZWJ sequences**: 👩‍👩‍👧‍👦 (family), 🧑‍💻 (technologist), 🐱‍💻 (Ninja Cat) — width calculation and editing broken
- **Skin tone modifiers**: 👋🏽 — width and display issues
- **Flag sequences**: 🇩🇪 — may render as two separate letter glyphs
- **Variation Selector-16 (U+FE0F)**: Text presentation symbols + VS16 fail to trigger color emoji (e.g., ♥️ U+2764+FE0F, ♠️ U+2660+FE0F)
- **Keycap sequences**: 1️⃣ — spacing issues

**Note**: With `antialiasingMode: "grayscale"`, color emoji still render as color (emoji rendering is separate from text antialiasing). No direct conflict.

---

## 6. Ligature Rendering Gaps

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#40](https://github.com/microsoft/cascadia-code/issues/40) | Some ligatures not working in Windows Terminal | Closed | Cascadia ligatures partially broken |
| [#595](https://github.com/microsoft/cascadia-code/issues/595) | Braces & ligature variants not rendering properly | Open | Brace ligatures affected |
| [#796](https://github.com/microsoft/cascadia-code/issues/796) | Issue with ligature `<<=` | Open | Specific ligature broken |
| [#394](https://github.com/microsoft/cascadia-code/issues/394) | Lua inequality `~=` rendered counter-intuitive | Open | Language-specific ligature conflict |

**Impact on config**: With `liga=1` and `calt=1` enabled, most ligatures work. However:
- Atlas Engine renders ligatures correctly (improved over legacy)
- Some Cascadia-specific ligatures have known rendering quirks
- **Grayscale antialiasing** can make ligatures look slightly less crisp than ClearType, especially at small sizes

---

## 7. CJK / Wide Character Rendering

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#370](https://github.com/microsoft/terminal/issues/370) | Ambiguous width character in CJK environment | Open | East Asian ambiguous-width chars misaligned |
| [#17016](https://github.com/microsoft/terminal/issues/17016) | Incorrect full-width char rendering | Open | Fullwidth chars don't fill cells |

**Low impact for this config** unless using CJK text. Nerd Font CJK coverage is limited.

---

## 8. Cursor Rendering Failures

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#15033](https://github.com/microsoft/terminal/issues/15033) | Cursor shape: Filled box does not work as expected | Open | Width mismatch on some chars |
| [#9940](https://github.com/microsoft/terminal/issues/9940) | Wrong cursor position | Open | Japanese chars cause cursor offset |
| [#14982](https://github.com/microsoft/terminal/issues/14982) | Bash command line editing gets wrong cursor position | Open | Oh My Posh + cursor desync |
| [#13420](https://github.com/microsoft/terminal/issues/13420) | Cursor can't restore shape after leaving Vim/WSL | Open | Cursor shape stuck after app exit |
| [#18174](https://github.com/microsoft/terminal/issues/18174) | How to avoid changing cursorShape when focusing terminal | Open | Focus changes cursor shape |

**Impact on config**: Bar cursor with height 25 is straightforward and generally works. However:
- After exiting Vim/Neovim, cursor shape may get stuck
- With Nerd Font glyphs of wrong width, cursor position desyncs from visual position
- Oh My Posh can cause cursor positioning errors (related to #14982)

---

## 9. Selection Rendering Failures

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#3580](https://github.com/microsoft/terminal/issues/3580) | Add a setting to control selection foreground color | Closed (implemented) | Selection fg now configurable |
| [#8716](https://github.com/microsoft/terminal/issues/8716) | Bad default selection background color with light schemes | Closed | Light theme selection was invisible |
| [#19240](https://github.com/microsoft/terminal/issues/19240) | Text Rendering Bug: Incorrect background color on user input | Open | **Light themes** get wrong background |

**Impact on config**: 
- **Catppuccin Latte** (light theme, bg #EFF1F5): Selection colors may have low contrast. Previously fixed (#8716) but #19240 reports regression with light schemes.
- **Dracula** (dark theme): Selection is generally fine.

---

## 10. Scrollbar Rendering Failures

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| [#15036](https://github.com/microsoft/terminal/issues/15036) | Terminal's scroll bar disappeared | Open | Scrollbar vanishes with certain profiles |
| [#6044](https://github.com/microsoft/terminal/issues/6044) | Add setting to make ScrollBar more visible | Closed | Scrollbar visibility improved |
| [#14589](https://github.com/microsoft/terminal/issues/14589) | Always show scroll bar | Open | Scrollbar only shows on hover |

**Impact**: Scrollbar is auto-hide by default. Mica transparency (`useMica: true`) can make the scrollbar harder to see against the blurred background. The scrollbar itself renders but can be nearly invisible on some backgrounds.

---

## 11. Special Rendering Issues with User's Config

### Grayscale Antialiasing + Atlas Engine
- Atlas Engine uses Direct3D (default) or Direct2D for text rendering
- `antialiasingMode: "grayscale"` disables ClearType subpixel rendering
- Grayscale AA can make fine details in Nerd Font glyphs look less crisp
- Some glyphs at font size 13 may appear slightly blurry vs ClearType

### Mica + Opacity 100
- `useMica: true` with `opacity: 100` means Mica material is applied but the window is fully opaque
- Mica samples the desktop wallpaper; if the wallpaper is busy, text contrast can suffer
- With Dracula (bg #1A1B26), Mica effect is minimal against a dark wallpaper
- With Catppuccin Latte (bg #EFF1F5), Mica may show through slightly, potentially reducing contrast

### CaskaydiaCove Nerd Font + Atlas Engine Glyph Width Bugs
The most significant issue for this specific config combination:
1. Nerd Font glyphs in U+F0000+ range render with wrong cell widths (#6864)
2. This causes text after those glyphs to be offset
3. Cursor position becomes desynced from visual rendering
4. Powerline glyphs (U+E0B0–U+E0B3) now have built-in rendering in v1.21+ (#5897), but custom NF powerline may conflict

---

## Summary: Highest-Impact Missing Elements

| Priority | Issue | Config Element Affected |
|----------|-------|------------------------|
| **P0** | #15896 — Stylistic sets not rendered | `ss01=1` silently ignored |
| **P0** | #6864 — Nerd Font glyph width wrong | CaskaydiaCove Nerd Font glyphs misaligned |
| **P1** | #11822 — Emoji ZWJ sequences broken | Any emoji usage |
| **P1** | #15033 — Cursor position drift | Bar cursor at height 25 |
| **P1** | #19240 — Light theme background color bug | Catppuccin Latte theme |
| **P2** | #12314 — Braille spinners missing | CLI tool spinners |
| **P2** | #19100 — VS16 color emoji failures | Emoji with variation selectors |
| **P2** | #15036 — Scrollbar disappears | Scrollbar visibility |
| **P3** | #5897 — Shading blocks at font size 13 | ░▒▓ rendering quality |

### Top 10 Specific Characters/Elements That Fail
1. **Stylistic Set 01 glyphs** — `ss01` changes ignored by Atlas Engine (no visual effect)
2. **Nerd Font Material Design Icons** (U+F0001–U+F1AF0) — wrong cell width, text offset
3. **Nerd Font Powerline** (U+E0B0–U+E0B3) — may conflict with built-in renderer
4. **ZWJ emoji** (e.g. 🧑‍💻, 👩‍👩‍👧‍👦) — width calculation broken, editing desyncs
5. **Skin tone emoji** (e.g. 👋🏽) — display/width issues
6. **Flag emoji** (e.g. 🇩🇪) — may show as separate letter glyphs
7. **Variation Selector-16 emoji** (e.g. ♥️, ♠️) — fail to render as color emoji
8. **Braille patterns** (U+2800–U+28FF) — missing in Consolas (OK in CaskaydiaCove NF)
9. **Shading blocks** (U+2591–U+2593) — pattern distortion at certain font sizes
10. **Cursor restoration** — cursor shape can get stuck after Vim/Neovim exits
