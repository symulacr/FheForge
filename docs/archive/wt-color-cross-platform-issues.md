# Windows Terminal Color Cross-Platform Issues

## Research Summary

Structured findings on color display issues across PowerShell 7, WSL (Ubuntu-24.04), Git Bash, Windows PowerShell, and cmd.exe profiles in Windows Terminal.

---

## 1. Color Differences Between PowerShell 7, WSL, and Git Bash in the Same Terminal

### Key Issues

**PowerShell 7 vs Git Bash vs WSL — ANSI Color Rendering**
- PowerShell 7.2+ uses `$PSStyle` for ANSI rendering, which interacts differently with Windows Terminal's color scheme than Git Bash or WSL
- Git Bash (MSYS2/MinTTY heritage) has known color compatibility issues when running inside Windows Terminal instead of native MinTTY
- WSL uses Linux-native ANSI escape sequences which Windows Terminal handles via ConPTY translation

**Relevant GitHub Issues:**
- **microsoft/terminal#5073** — "Colors & glyphs broken with git-for-windows bash" — Colors and Unicode glyphs render incorrectly in Git Bash within Windows Terminal compared to native MinTTY
- **microsoft/terminal#6711** — "Terminal color output not displaying as expected" — Color output in Git Bash profile behaves differently from WSL profile
- **Azure/azure-cli#19391** — "ANSI escape color codes broken on Git Bash in Windows Terminal" — az CLI shows broken color output specifically in Git Bash within Windows Terminal (works fine in cmd, PowerShell, and WSL)
- **microsoft/terminal#88** — Background color rendering differs between profiles after running color-outputting commands

**Severity: MEDIUM** — Colors render but with visible discrepancies in hue, brightness, or ANSI code interpretation across profiles.

### Profile-Specific Color Behavior

| Profile | Color Engine | ANSI Support | True Color |
|---------|-------------|--------------|------------|
| PowerShell 7 | .NET `$PSStyle` + VT100 | Full ANSI via ConPTY | Yes (COLORTERM) |
| WSL (Ubuntu) | Linux VT subsystem | Full via ConPTY bridge | Yes (COLORTERM=truecolor) |
| Git Bash | MSYS2/Cygwin layer | Partial — MSYS2 translates ANSI to Win32 console API | Limited |
| Windows PowerShell 5.1 | Win32 Console API | Limited — needs ENABLE_VIRTUAL_TERMINAL_PROCESSING | No native true color |
| cmd.exe | Win32 Console API | Minimal — requires VT mode opt-in | No |

---

## 2. ConPTY Color Translation Bugs (Windows-side to WSL-side Color Rendering)

### Key Issues

**ConPTY (Console Pseudo Terminal) is the intermediary layer between Windows Terminal and all shell profiles.**

**Relevant GitHub Issues:**
- **microsoft/terminal#2661** — "render: defer conversion of TextColor into COLORREF until actual render time" — ConPTY converts TextColor to COLORREF too early, causing color table mismatches between the Windows rendering side and what the application expects
- **microsoft/terminal#6087** — "24-bit color may not be enabled by default" — 24-bit color rendering does not work in Windows Terminal like it does in MinTTY; ConPTY does not properly propagate true color capability to child processes
- **microsoft/terminal#13424** — "Windows Terminal not properly resetting default colors altered within WSL" — After WSL applications (like ncurses-based vim/top) alter colors via ANSI sequences, Windows Terminal does not properly reset to the profile's default colors when the application exits
- **microsoft/terminal#8823** — "Background colour sometimes ignored in Windows Terminal" — ConPTY occasionally drops background color escape sequences, especially with rapid color switching
- **microsoft/terminal#832** — "Vim background color renders incorrectly" — Classic ConPTY color translation issue where vim's background color doesn't match what's expected

**How ConPTY Color Translation Works:**
1. Application (e.g., WSL bash) emits ANSI escape sequence
2. ConPTY intercepts and translates to internal representation
3. Windows Terminal renders using the profile's color scheme as base
4. **Bug window:** Colors can get clipped, remapped, or dropped at steps 2-3

**Severity: HIGH** — Core architectural issue affecting all cross-platform color rendering. Most visible with:
- True color (24-bit) sequences being downgraded
- Background colors not resetting after application exit
- Color table index mismatches between what the app expects and what's rendered

---

## 3. FORCE_COLOR=1 Causing Unexpected Color Output in Tools

### Key Issues

**Relevant References:**
- **force-color.org** (FORCE_COLOR specification) — Defines FORCE_COLOR as a way to force color output even when piping. When set to `1`, tools should output ANSI colors regardless of TTY detection
- **python/cpython#127353** — "Unable to force color output on Windows" — Python's `can_colorize()` function checks `nt._supports_virtual_terminal` BEFORE checking environment variables like FORCE_COLOR. If the terminal emulator doesn't advertise VT support, FORCE_COLOR is ignored
- **microsoft/terminal#6711** — Color output behavior changes based on environment variable detection

**Specific Problems with FORCE_COLOR=1:**
1. **Python ignores FORCE_COLOR** when `nt._supports_virtual_terminal` returns False (can happen in certain ConPTY states)
2. **Node.js tools** (chalk, colorette, picocolors) check `FORCE_COLOR` but also check `process.stdout.isTTY` — in piped/non-TTY contexts, FORCE_COLOR overrides correctly, but in Windows Terminal it can cause double-colorization
3. **npm/node tools** may emit raw ANSI codes when FORCE_COLOR=1 even in contexts where Windows Terminal's color scheme should handle colors — leading to color-on-color conflicts
4. **Cross-profile inconsistency:** FORCE_COLOR=1 in WSL bash profile behaves correctly (Linux tools respect it), but in PowerShell 7 profile the same variable may cause PowerShell's $PSStyle and the tool's ANSI codes to clash

**Severity: MEDIUM** — Causes unexpected color output especially when:
- Running tools that detect TTY vs pipe differently across Windows/WSL
- Mixing PowerShell's native coloring with ANSI-forced coloring
- Python scripts failing to colorize despite FORCE_COLOR=1

**Mitigation:** Set `FORCE_COLOR=1` only in specific profile environments, not globally. In PowerShell 7, prefer `$PSStyle` over external FORCE_COLOR.

---

## 4. TERM=xterm-256color vs TERM=vt100 Color Capability Mismatches

### Key Issues

**Relevant GitHub Issues:**
- **microsoft/terminal#9402** — "Microsoft Terminal sets TERM=xterm-256color instead of TERM=ms-terminal" — Windows Terminal is NOT xterm and does not conform to xterm-256color terminfo capabilities. It should use its own TERM string. This causes tools to expect xterm-specific behaviors that Windows Terminal doesn't implement
- **microsoft/terminal#10531** — "Differences between vt100/xterm and windows console" — Windows console does not implement many vt100/xterm controls, creating capability mismatches when TERM claims xterm-256color

**Specific Mismatch Problems:**

| TERM Value | Expected Capabilities | Windows Terminal Actual Support |
|-----------|----------------------|-------------------------------|
| xterm-256color | 256 colors, mouse tracking, bracketed paste, title setting, alternate screen | Most but not all — missing some xterm-specific sequences |
| vt100 | Basic 8 colors, no mouse | Over-reports — Windows Terminal supports more than vt100 claims |
| xterm | 8 colors + bold/blink for 16 | Close but not exact match |

**Impact on Color:**
- Tools reading terminfo for `xterm-256color` may attempt 256-color or true color sequences that get silently dropped or misrendered
- Setting `TERM=vt100` in WSL causes tools to use only 8 basic colors, wasting Windows Terminal's full color capability
- The mismatch is worst for ncurses-based applications (vim, htop, tmux) that strictly follow terminfo

**Severity: MEDIUM** — The user's WSL setup (`TERM=xterm-256color`) is the best available option but is technically inaccurate. Tools that strictly follow xterm terminfo will occasionally misbehave.

---

## 5. PowerShell 7 Color Rendering vs PowerShell 5 (Windows PowerShell)

### Key Issues

**Relevant References:**
- **Microsoft Learn: about_ANSI_Terminals** — PowerShell 7.2+ uses `$PSStyle` automatic variable for ANSI rendering, while PowerShell 5.1 uses Win32 Console API color calls
- **Microsoft Learn: Differences between Windows PowerShell 5.1 and PowerShell 7.x** — Breaking changes include how colors are rendered
- **PowerShell/PowerShell#18778** — "The colors for directories output look super weird since PowerShell" — Color rendering differences between PS versions in Windows Terminal

**Key Differences:**

| Feature | PowerShell 5.1 | PowerShell 7 |
|---------|---------------|--------------|
| Color API | Win32 Console API (SetConsoleTextAttribute) | ANSI escape sequences via $PSStyle |
| True Color | No | Yes (in Windows Terminal) |
| 256 Colors | No (16 colors only) | Yes |
| `$PSStyle` | Not available | Available since 7.2 |
| ANSI rendering | Not natively supported | Full support via VT100 |
| Color scheme interaction | Uses Windows Terminal's 16-color table directly | Uses ANSI codes that Windows Terminal maps to its color scheme |

**Specific Issues:**
- PowerShell 5.1 in Windows Terminal renders the 16 system colors from the profile's color scheme, but cannot use 256-color or true color
- PowerShell 7 can emit 256-color and true color ANSI codes, but these may look different from PS 5.1's 16-color rendering of the same data
- `Get-ChildItem` (ls) colors differ: PS 5.1 uses `$Host.UI.RawUI.ForegroundColor/BackgroundColor` while PS 7 uses `$PSStyle.FileInfo` with ANSI codes
- PS 7's `$PSStyle` can conflict with tools that also emit ANSI codes (double-styling)

**Severity: MEDIUM** — The user uses PowerShell 7 as default, which has better color support. But when switching between PS 7 and PS 5 (hidden profile), colors will look noticeably different for the same commands.

---

## 6. Git Bash (MSYS2) Color Translation Issues with Windows Terminal

### Key Issues

**Relevant GitHub Issues:**
- **microsoft/terminal#5073** — "Colors & glyphs broken with git-for-windows bash" — Git Bash in Windows Terminal has broken colors and Unicode glyphs compared to native MinTTY
- **Azure/azure-cli#19391** — ANSI escape color codes broken specifically in Git Bash within Windows Terminal
- **BurntSushi/ripgrep#117** — "Color doesn't work in windows mintty (git bash)" — ripgrep --color always fails in Git Bash
- **mintty/mintty#747** — "MinTTY silently exits if terminal type is set to xterm-256color" — MSYS2 bash aborts when TERM=xterm-256color

**Root Cause:**
Git Bash runs through MSYS2's POSIX compatibility layer, which translates between:
- Unix PTY semantics → Windows ConPTY
- ANSI escape sequences → Win32 Console API (partially)
- Unix paths → Windows paths

This translation layer (MSYS2 runtime) handles color codes differently from native Linux:
1. **MSYS2 may convert ANSI color codes to Win32 console color API calls** instead of passing them through as VT sequences
2. **Windows Terminal then renders these Win32 API calls using its color scheme**, which can produce different colors than the original ANSI sequence intended
3. **256-color and true color support is limited** — MSYS2's translation layer doesn't always pass through extended color sequences

**Severity: HIGH** — Git Bash is the most problematic profile for color rendering. Colors that work perfectly in WSL may appear wrong or missing in Git Bash.

**Mitigation:** Use `MSYS=winsymlinks:nativestrict` and ensure Git for Windows is updated to latest version which has improved ConPTY support.

---

## 7. Split-Pane Color Rendering — Do Adjacent Panes Affect Each Other's Colors?

### Key Issues

**Relevant GitHub Issues:**
- **microsoft/terminal#12563** — "panes question" — Users report color inconsistencies when splitting panes; the colors in one pane can appear different from the same profile in a full-tab view
- **microsoft/terminal#1000** — "Scenario: Add support for panes" — Megathread tracking pane features; color isolation between panes was a design consideration
- **microsoft/terminal#2377** — "It is hard to see the pane divider in dark mode" — Pane divider color contrast issues with dark color schemes
- **microsoft/terminal#8406** — "How to change pane divider color and width?" — Divider color doesn't adapt well to all color schemes
- **microsoft/terminal#6987** — "Rendering errors in tmux split panes" — Split pane rendering glitches

**Key Finding: Adjacent panes do NOT affect each other's colors.** Each pane is an independent ConPTY instance with its own color state. However:
- The **pane divider** may not be visible or may clash with certain color schemes (especially dark themes like Dracula)
- **Focus indication** (which pane is active) uses a border color that may not be visible with dark color schemes
- The user's `startupActions` with split-pane Ubuntu + PowerShell means adjacent panes will have different color schemes applied, and the divider needs to be visible against both

**Severity: LOW** — No cross-pane color bleeding. Main concern is divider visibility with Dracula/Catppuccin schemes.

---

## 8. Color Scheme Not Applying Correctly to Dynamically Generated Profiles

### Key Issues

**Relevant GitHub Issues:**
- **microsoft/terminal#3012** — "Bug Report: profile colorScheme not applied" — colorScheme setting not being applied to profiles
- **microsoft/terminal#2384** — "colorScheme doesn't working" — Custom schemes added to settings not taking effect
- **microsoft/terminal#8001** — "Color Setting not working" — Windows Terminal not responding to color settings in settings.json except foreground/background
- **microsoft/terminal#1435** — "colorScheme in a profile does not apply the selected scheme" — Early bug where colorScheme was ignored
- **microsoft/terminal#14859** — "Ship a sensible default light color scheme" — Discussion about color scheme defaults and dynamic profile generation

**Specific Problems:**
1. **Dynamically generated profiles** (auto-discovered WSL distros, Git Bash, etc.) may not inherit the `defaults` colorScheme setting
2. **Per-profile colorScheme** may be overridden by the profile's own foreground/background settings if both are specified
3. **Light/dark mode switching** may not correctly apply the right color scheme variant (Dracula for dark, Catppuccin Latte for light) to dynamically generated profiles
4. **Settings layering:** Windows Terminal applies settings in order: built-in defaults → settings.json `defaults` → profile-specific settings. If a dynamically generated profile has its own colorScheme in the generated section, it overrides the `defaults` setting

**Severity: MEDIUM** — The user's setup uses per-profile colorScheme via `defaults`, which should work for static profiles but may not apply to auto-discovered profiles (like WSL distros that Windows Terminal generates automatically).

**Mitigation:** Explicitly set `colorScheme` on each profile in settings.json rather than relying on `defaults`.

---

## 9. WSL2 vs WSL1 Color Rendering Differences in Windows Terminal

### Key Issues

**Relevant References:**
- **askubuntu.com/questions/1309068** — "zsh true color disabled on WSL2?" — True color works in PowerShell but not in WSL2 within Windows Terminal
- **microsoft/WSL#76** — "Color rendering issues" — Original WSL color rendering bug (2016), foundational ConPTY color issues
- **microsoft/WSL#9330** — "A Windows .exe repeatedly printing colored text in a WSL window" — Color output differences between WSL1 and WSL2 when running Windows executables
- **cslarsen/jp2a#17** — "True color supports on Windows WSL2" — WSL2 true color support questions

**Key Differences:**

| Feature | WSL1 | WSL2 |
|---------|------|------|
| Kernel | Windows NT kernel translation | Real Linux kernel (Hyper-V) |
| Console I/O | Direct Windows console calls | Linux VT subsystem → ConPTY bridge |
| COLORTERM | May not be set by default | Should be `truecolor` (check with `echo $COLORTERM`) |
| True Color | Supported via ConPTY passthrough | Supported but requires proper TERM/COLORTERM |
| Color Latency | Lower (direct console API) | Slightly higher (extra translation layer) |
| Windows Executable Color Output | Native (same console) | Translated (ConPTY bridge) |

**The user's environment (WSL2 with COLORTERM=truecolor, TERM=xterm-256color) is correctly configured** for true color support. The main difference from WSL1 is:
- WSL2 goes through an additional translation layer (Linux kernel → virtio console → ConPTY → Windows Terminal)
- Windows .exe files run from WSL2 may produce different color output than from WSL1 due to the ConPTY bridge
- tmux inside WSL2 may require explicit `set -g default-terminal "tmux-256color"` and `set -ga terminal-overrides ",xterm-256color:Tc"` for true color

**Severity: LOW** — The user is on WSL2 which is the recommended path. True color should work with current settings.

---

## 10. Color Rendering When Connecting to Remote Systems via SSH from Windows Terminal

### Key Issues

**Relevant GitHub Issues:**
- **microsoft/terminal#7506** — "No bright colors under screen/irssi in SSH session" — Bright/bold colors don't render correctly when SSH'd to remote FreeBSD/Linux systems
- **microsoft/terminal#81** — "Allow terminal color setting" — Fundamental issue about color settings and remote sessions

**Relevant References:**
- **Stack Overflow: "Windows-Terminal Theme Colors SSH"** — Dracula color scheme works locally in WSL bash but colors change when SSHing to remote servers
- **Stack Overflow: "Using an interactive shell over ssh seems to remove/prevent some colors"** — SSH sessions lose some color capabilities

**Specific Problems:**
1. **TERM propagation:** When SSHing from Windows Terminal, the local `TERM=xterm-256color` is sent to the remote system. The remote system's terminfo for `xterm-256color` may not match Windows Terminal's actual capabilities
2. **Color scheme passthrough:** Windows Terminal's color scheme (Dracula) defines the 16 system colors. SSH passes ANSI color indices (0-15), and the remote system's terminal renders them using ITS terminfo for xterm-256color, which may map to different RGB values than Dracula
3. **True color over SSH:** Modern OpenSSH supports true color passthrough, but the remote terminal must support it. If the remote system's TERM doesn't indicate true color support, 24-bit color codes may be silently dropped
4. **Bold/bright color issue:** Some SSH servers interpret bold (SGR 1) as "bright color" which shifts the color index by 8. This can cause colors to look different from local rendering where bold and color are independent
5. **tmux/screen on remote:** Running tmux on a remote server over SSH adds another layer of TERM/COLORTERM negotiation that can break true color

**Severity: MEDIUM** — SSH introduces the most complex color negotiation chain:
```
Windows Terminal → ConPTY → WSL bash → SSH client → Network → SSH server → remote shell → remote terminfo
```

**Mitigation:**
- On remote systems, set `TERM=xterm-256color` (usually automatic via SSH)
- For true color over SSH, ensure remote has `COLORTERM=truecolor` exported
- Use `mosh` as alternative which handles color negotiation better
- Add to remote `~/.bashrc`: `export TERM=xterm-256color` and `export COLORTERM=truecolor`

---

## Master Issue List (microsoft/terminal GitHub)

| Issue # | Title | Severity | Color Impact |
|---------|-------|----------|-------------|
| #88 | Bash fails to render correct background color | Medium | Background colors persist incorrectly |
| #832 | Vim background color renders incorrectly | Medium | ConPTY color translation bug |
| #5073 | Colors & glyphs broken with git-for-windows bash | High | Git Bash color rendering broken |
| #6087 | 24-bit color may not be enabled by default | High | True color not propagating correctly |
| #6711 | Terminal color output not displaying as expected | Medium | Git Bash specific color issues |
| #6987 | Rendering errors in tmux split panes | Medium | Split pane rendering glitches |
| #7506 | No bright colors under screen/irssi in SSH session | High | SSH color loss |
| #8001 | Color Setting not working | Medium | Color scheme not applying |
| #8823 | Background colour sometimes ignored | Medium | ConPTY drops background colors |
| #9402 | TERM=xterm-256color instead of ms-terminal | Medium | Wrong TERM value causes mismatches |
| #10531 | Differences between vt100/xterm and windows console | Medium | Capability mismatch |
| #12563 | panes question — color inconsistencies | Low | Split pane color issues |
| #13424 | Not properly resetting default colors altered within WSL | High | WSL color state leaks |
| #14859 | Ship a sensible default light color scheme | Low | Light/dark scheme issues |
| #18758 | Colors mess up with "One Half Light" scheme | Medium | Color scheme rendering bug |

---

## Recommendations for the User's Setup

1. **Explicitly set `colorScheme` per profile** in settings.json rather than relying on `defaults` — ensures dynamically generated profiles get the right scheme
2. **Git Bash is the weakest link** — consider using WSL bash for color-critical tasks; Git Bash's MSYS2 layer adds color translation issues
3. **FORCE_COLOR=1** — set per-profile in WSL (`export FORCE_COLOR=1` in ~/.bashrc) but avoid in PowerShell 7 where `$PSStyle` handles colors natively
4. **SSH sessions** — ensure remote systems have `COLORTERM=truecolor` exported for true color passthrough
5. **Split pane dividers** — with Dracula (dark) / Catppuccin Latte (light), ensure `paneBorderColor` is explicitly set in settings to maintain visibility
6. **TERM value** — `xterm-256color` is the best available option for WSL despite not being perfectly accurate; do not change to `vt100` (loses color capability)
