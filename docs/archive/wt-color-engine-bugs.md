# Windows Terminal Color Engine Bugs — Structured Findings

## Config Under Investigation
- colorScheme: Dracula (dark) / Catppuccin Latte (light)
- antialiasingMode: "grayscale"
- opacity: 80, useAcrylic: true
- font: CaskaydiaCove Nerd Font size 13
- colorScheme switching: `{ "dark": "Dracula", "light": "Catppuccin Latte" }`
- adjustIndistinguishableColors: "indexed"
- intenseTextStyle: "bold"

---

## 1. Truecolor (24-bit) Rendering Bugs

### #17082 — ANSI 24-bit RGB foreground color codes don't display correctly when close to background color
- **Severity:** MEDIUM — Color accuracy defect
- **Status:** Open (reported Apr 2024)
- **Summary:** When a 24-bit foreground color is close to the background color value, Windows Terminal renders it incorrectly (either invisible or wrong shade). The `adjustIndistinguishableColors` setting interacts with truecolor codes, causing colors near the background to be forcibly shifted.
- **Repro:**
  ```
  echo -e "\033[38;2;40;42;54mText near Dracula bg\033[0m"
  ```
  Dracula bg is `#282A36` (40,42,54). Foreground colors in that neighborhood get mangled.
- **Relevance to your config:** HIGH — Dracula's dark bg makes near-bg accent colors common. With `adjustIndistinguishableColors: "indexed"`, this bug is triggered when 24-bit colors land close to the 16-color palette entries.

### #6087 — 24-bit color may not be enabled by default
- **Severity:** LOW — Legacy, likely fixed
- **Status:** Closed/Resolved
- **Summary:** Early reports of truecolor not working in WT. Resolved in modern WT versions, but COLORTERM env var (`#11057`) is still not set to "truecolor" by default, which can cause some CLI tools to fall back to 256-color mode.

### #11075 — Cannot setup 24-bit colors in WSL
- **Severity:** LOW — Configuration issue
- **Status:** Closed
- **Summary:** Users unable to get 24-bit color working in WSL2. Usually a TERM/terminfo misconfiguration rather than a WT bug.

---

## 2. Color Scheme Switching Issues (Dark/Light Toggle)

### #15293 — Color schemes can get "stuck" when Theme is Light
- **Severity:** HIGH — Breaks light/dark toggle workflow
- **Status:** Open (reported May 2023)
- **Summary:** When the WT theme is set to "Light", color scheme dropdown gets stuck — selecting a new scheme doesn't apply until the tab is reopened or WT is restarted. The settings UI shows the correct value but the rendering doesn't update.
- **Repro:**
  1. Set Theme to Light
  2. Go to Color schemes in settings
  3. Select a different scheme
  4. Back button doesn't apply new scheme to open tabs
- **Relevance to your config:** HIGH — Your dark/light switching config (`"dark": "Dracula", "light": "Catppuccin Latte"`) relies on the scheme switch working correctly. This bug means switching OS theme may leave the wrong scheme active.

### #9840 — Auto switch color scheme according to Windows theme
- **Severity:** FEATURE REQUEST (long-standing)
- **Status:** Open since 2021
- **Summary:** The core feature of per-profile dark/light color scheme switching was requested years ago. It was partially implemented via the `{ "dark": "...", "light": "..." }` syntax but remains incomplete.

### #4066, #10407, #12681, #13226, #15834, #16237 — Theme-controlled color scheme switch (family of related issues)
- **Severity:** MEDIUM — Feature gap / integration issues
- **Status:** Various open/closed states
- **Summary:** Multiple requests for WT to automatically switch profile color scheme when the OS dark/light mode changes. The feature exists but has edge cases:
  - New tabs may not pick up the changed scheme until restarted
  - The `{ "dark": "...", "light": "..." }` per-profile colorScheme only works when the WT app theme is set to "system" — if hardcoded to "dark" or "light", it's ignored
  - Settings UI doesn't surface the dual-scheme syntax; you must edit JSON directly

### #19993 — Switch profile color scheme based on System Theme
- **Severity:** MEDIUM — UX gap
- **Status:** Open (Mar 2026)
- **Summary:** Recent issue noting that WinUI3 app theme switching works but terminal emulator color schemes are hardcoded per shell profile. Suggests each profile should support two color scheme slots.

---

## 3. adjustIndistinguishableColors Behavior and Bugs

### #17346 — Automatically enable adjustIndistinguishableColors if High Contrast mode is enabled
- **Severity:** LOW — Enhancement
- **Status:** Merged
- **Summary:** PR adds an "Automatic" value for `adjustIndistinguishableColors` that enables it when High Contrast mode is active in the OS. Previously it was a manual on/off/always toggle.

### #15452 — Something is, well, probably fine with One half light
- **Severity:** MEDIUM — Color misadjustment
- **Status:** Open (May 2023)
- **Summary:** With "One Half Light" scheme + `adjustIndistinguishableColors: "always"`, some text colors get forcibly adjusted when they shouldn't be. The "indexed" mode (which you use) is less aggressive than "always" but still has edge cases.
- **Relevance to your config:** MEDIUM — Your `"indexed"` setting means WT only adjusts colors within the 16-color palette space. If a CLI tool sends a 256-color or truecolor code that's close to a palette entry, it won't be adjusted. But if the app sends palette-indexed colors (e.g., color 0-15) that are close to the background, they will be forcibly shifted.

### General behavior note:
- `adjustIndistinguishableColors: "indexed"` only operates on the 16-color palette entries
- `adjustIndistinguishableColors: "always"` operates on all colors (256-color, truecolor)
- The "indexed" mode is recommended for your config since Dracula/Catppuccin already have well-considered contrast ratios
- Risk: Some CLI tools that expect exact palette colors may render differently than intended

---

## 4. Color Accuracy Issues with Acrylic/Transparent Backgrounds

### #14332 — useAcrylic messes bg color
- **Severity:** HIGH — Direct color accuracy bug
- **Status:** Open (Nov 2022)
- **Summary:** When acrylic is enabled, the background color becomes significantly brighter/washed out compared to the intended scheme color. The acrylic blending algorithm doesn't preserve the intended dark bg.
- **Repro:**
  1. Set useAcrylic: true, opacity < 1
  2. Compare bg color with acrylic on vs off
  3. The acrylic version is noticeably lighter/washed out
- **Relevance to your config:** CRITICAL — Your opacity: 80 (0.8) + useAcrylic: true directly triggers this. Dracula's `#282A36` bg will appear lighter than intended.

### #7808 — Acrylic not working when terminal window is inactive/unfocused
- **Severity:** MEDIUM — Visual inconsistency
- **Status:** Open (Oct 2020)
- **Summary:** Acrylic transparency disappears (becomes opaque) when the terminal window loses focus. This is by design on some Windows versions but configurable via `--no-acrylic-inactive` or similar. The color shifts when switching focus.

### #16745 — Acrylic tab row glitch when terminal changes focus
- **Severity:** LOW — Visual glitch
- **Status:** Open (Feb 2024)
- **Summary:** When background opacity < 100 with acrylic, the tab row shows visual glitches during focus transitions.

### #18189 — Acrylic stopped working
- **Severity:** MEDIUM — Regression
- **Status:** Open (Nov 2024)
- **Summary:** On some Windows 10 22H2 builds, acrylic stopped working entirely after an update. Settings show it enabled but the effect doesn't render.

### #7047 — Acrylic opacity doesn't always work on Windows 10 19041
- **Severity:** MEDIUM — Intermittent
- **Status:** Open (Jul 2020)
- **Summary:** Acrylic intermittently fails to apply. Related to Windows compositor state.

### #1414, #5698, #6718, #9674 — Various acrylic opacity failures
- **Severity:** LOW-MEDIUM — Environment-dependent
- **Status:** Various
- **Summary:** Acrylic fails on specific Windows versions, especially when transparency effects are disabled in Windows Settings > Accessibility > Visual Effects. Users must ensure "Transparency effects" is ON in Windows Settings.

### General acrylic/color interaction:
- Acrylic blends the terminal bg with whatever is behind the window (desktop wallpaper, other windows)
- At opacity 0.8, 20% of the underlying content bleeds through, shifting the perceived color
- Dracula's dark bg (`#282A36`) over a light desktop wallpaper will appear significantly lighter
- Catppuccin Latte's light bg (`#EFF1F5`) over dark wallpaper will darken
- The color shift is non-deterministic (depends on what's behind the window)

---

## 5. ANSI Color Code Rendering Bugs (256-color and truecolor)

### #17082 (detailed above) — 24-bit colors near background get mangled
- **Relevance:** Any ANSI truecolor code close to the bg will be incorrectly adjusted

### #2837 — ANSI Color Sequences not having effect
- **Severity:** LOW — Edge case
- **Status:** Closed
- **Summary:** Some ANSI sequences not rendering in specific shells. Usually a TERM/terminfo issue.

### #3885 — ANSI/VT transparent and black background mismatch
- **Severity:** MEDIUM — Color rendering inconsistency
- **Status:** Open (Dec 2019)
- **Summary:** ANSI "default background" (SGR 49) vs "black background" (SGR 40) are not distinguished correctly when transparency is enabled. The transparent background and solid black render identically, which means apps can't signal "use the default bg" vs "use black."
- **Relevance to your config:** LOW-MEDIUM — Most CLI tools use the default bg, but some use explicit black, which may interact oddly with your acrylic setup.

### #18758 — Colors messed up with "One Half Light" color scheme
- **Severity:** MEDIUM — Color scheme rendering bug
- **Status:** Open (Apr 2025)
- **Summary:** With "One Half Light" scheme, printing text then clearing it with Backspace causes color corruption. The color state machine doesn't reset properly after backspace/clear operations.
- **Relevance to your config:** LOW — Specific to One Half Light, but indicates color state machine issues exist in WT's renderer.

---

## 6. Dracula and Catppuccin Scheme-Specific Issues

### dracula/windows-terminal#3 — Readme Problem: background property overwrites color scheme
- **Severity:** MEDIUM — Configuration trap
- **Status:** Open
- **Summary:** If you set `background` in the profiles section (not the color scheme), it overwrites the Dracula scheme's background color. Users who follow old Dracula installation guides may accidentally override scheme colors.
- **Repro:**
  ```json
  "profiles": [{
    "acrylicOpacity": 0.5,
    "background": "#282A36",  // This overrides the scheme!
    "colorScheme": "Dracula"
  }]
  ```
  The `background` in profiles takes precedence over the scheme's background.
- **Relevance to your config:** HIGH — If your profiles.json has any `background` or `foreground` keys in the profile object, they will silently override Dracula/Catppuccin scheme colors.

### dracula/windows-terminal#10 — Easy color scheme import process
- **Severity:** LOW — UX issue
- **Status:** Open
- **Summary:** Dracula scheme import relies on editing settings.json manually. No built-in scheme import mechanism in WT.

### catppuccin/tmux#530 — Wrong background color in catppuccin-frappe tmux theme
- **Severity:** LOW — tmux-specific
- **Status:** Open (May 2025)
- **Summary:** Tmux's Catppuccin theme renders wrong bg colors. This is a tmux issue, not WT, but indicates that Catppuccin color accuracy can be affected by intermediary tools.

---

## 7. intenseTextStyle "bold" Causing Color Shifts or Rendering Artifacts

### #19077 — Intense text style not taking effect — always shows text as dim
- **Severity:** HIGH — Active bug
- **Status:** Open (Jun 2025)
- **Summary:** On WT 1.23.x, setting `intenseTextStyle: "bold"` has no effect in some scenarios. Text that should render as bold (SGR 1) appears as normal weight. This was reported with NeoVim inside tmux.
- **Repro:**
  1. Set intenseTextStyle: "bold" in settings.json
  2. Open NeoVim inside tmux
  3. Bold text (SGR 1) renders as normal weight
- **Relevance to your config:** HIGH — Your `intenseTextStyle: "bold"` may not work in all shells/tools, especially inside tmux or screen.

### #13150 — Intense text does not use bold style font in font family even if intenseTextStyle is bold
- **Severity:** MEDIUM — Font rendering issue
- **Status:** Open (May 2022)
- **Summary:** When `intenseTextStyle: "bold"` is set, WT uses the regular font weight but with a slightly different rendering (pseudo-bold via wider strokes). With some fonts (including CaskaydiaCove Nerd Font), this creates visible color shifts because the subpixel antialiasing (your `antialiasingMode: "grayscale"`) renders the wider strokes differently.
- **Relevance to your config:** HIGH — CaskaydiaCove Nerd Font + grayscale antialiasing + bold intense text = potential color bleeding around bold characters.

### #10576 — Add a setting for disabling "intense is bold"
- **Severity:** LOW — Feature request
- **Status:** Open
- **Summary:** Users want to decouple "intense" (bright colors) from "bold" (font weight). Currently `intenseTextStyle` has options: "bright", "bold", "all" (both), "none". The "bright" option is the one that just uses bright colors without bold rendering.

### #109 — Enable Bold Text in Windows Terminal (original tracking issue)
- **Severity:** INFO — Historical context
- **Status:** Closed (implemented)
- **Summary:** Bold text support was added but the implementation has nuances. SGR 1 (bold/bright) was historically mapped only to bright colors in Windows consoles. WT now supports actual bold font rendering, but the interaction between bold font weight and color brightness is not always correct.

### Color shift with bold:
- When `intenseTextStyle: "bold"`, SGR 1 activates BOTH bold font AND bright colors
- The bold font weight causes wider character strokes
- With `antialiasingMode: "grayscale"`, the wider strokes blend differently with the background
- On acrylic backgrounds (opacity 80%), this blending includes the underlying content
- Net effect: Bold text appears to have a slightly different color than non-bold text of the same palette entry

---

## 8. Color Bleeding / Incorrect Blending with Opacity < 100

### #14332 (detailed above) — useAcrylic messes bg color
- **Severity:** HIGH
- **Direct impact on your config:** opacity 80 + acrylic = color bleeding

### #3885 (detailed above) — ANSI/VT transparent and black background mismatch
- **Severity:** MEDIUM
- **Impact:** Transparent bg and black bg render identically under acrylic

### #9952 — Proposed Functionality Regarding Transparency
- **Severity:** INFO — Design discussion
- **Summary:** Detailed discussion of how Windows Acrylic's blur radius, tint, and luminosity work. Key finding: Acrylic applies a Gaussian blur to the underlying content, then blends with a tint color derived from the terminal's bg. The tint color is NOT the exact scheme bg — it's a composited value that Windows derives.

### General color bleeding behavior with your config:
1. Dracula bg `#282A36` + acrylic at 0.8 opacity → underlying content contributes 20% to perceived color
2. If desktop wallpaper is light, the bg appears ~20% lighter than `#282A36`
3. If another dark window is behind, the bg stays close to intended
4. Foreground colors (especially dark/medium ones) can appear to have different contrast ratios depending on what's behind the window
5. The effect is non-deterministic and changes as you move the window

---

## Summary: Highest-Risk Issues for Your Config

| Priority | Issue | Category | Impact |
|----------|-------|----------|--------|
| **P0** | #14332 | Acrylic bg color | Acrylic washes out Dracula's dark bg |
| **P0** | #15293 | Scheme switching | Color scheme gets stuck when toggling light/dark |
| **P1** | #17082 | Truecolor near bg | Colors near Dracula bg are mangled by adjustIndistinguishable |
| **P1** | #19077 | Bold not rendering | intenseTextStyle: "bold" may not work in tmux/nvim |
| **P1** | #13150 | Bold color shift | Bold + grayscale AA + CaskaydiaCove = color bleeding |
| **P1** | dracula/windows-terminal#3 | Config trap | Profile-level bg/fg overrides scheme colors |
| **P2** | #7808 | Acrylic focus | Acrylic disappears when window unfocused |
| **P2** | #3885 | Transparent bg | Default bg vs black bg indistinguishable under acrylic |
| **P2** | #15452 | adjustIndistinguishable | Color adjustment can be overly aggressive |
| **P3** | #18189 | Acrylic regression | Acrylic may stop working after Windows updates |

## Recommended Mitigations

1. **For acrylic color bleeding (#14332):** Remove `background` key from your profile objects (use only scheme colors). Consider increasing opacity to 90+ if colors look washed out.
2. **For scheme switching (#15293):** Ensure WT app theme is set to "system" (not "dark" or "light") for the `{ "dark": "Dracula", "light": "Catppuccin Latte" }` to work. Use JSON config, not UI.
3. **For bold rendering (#19077, #13150):** Consider `intenseTextStyle: "all"` (bold + bright) or `"bright"` (bright only, no bold) to avoid bold color artifacts.
4. **For adjustIndistinguishable (#17082):** Your `"indexed"` setting is the safest choice. Only palette colors 0-15 are adjusted.
5. **For acrylic focus (#7808):** Check Windows Settings > Accessibility > Visual Effects > "Transparency effects" is ON.
6. **For config trap (dracula#3):** Verify no `background`/`foreground` keys exist in your profile objects — only in the scheme definition.
