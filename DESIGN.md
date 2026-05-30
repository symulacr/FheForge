# Design

## Theme

Dark terminal. Scene: a developer running a strategy audit at night, low ambient light, multiple monitors showing on-chain state and ciphertext handles. Darkness is functional: it reduces eye strain during long sessions and makes the glowing accent values (encrypted hashes in blue, confirmed states in green) legible at a glance. Not dark by category default — dark because the physical scene and user context demand it.

Color strategy: Restrained. Near-black surface ramp, single blue accent used for primary actions and interactive state only, four semantic colors (success, warning, destructive, info) completing the vocabulary. Nothing decorative.

## Colors

| Token | Value | Role |
|-------|-------|------|
| `--background` | `#0a0a0a` | Page background |
| `--foreground` | `#e0e0e0` | Primary text |
| `--card` | `#111111` | Card and panel surface |
| `--secondary` | `#1a1a1a` | Secondary / nested surface |
| `--border` | `#2a2a2a` | Borders |
| `--muted` | `#555555` | Secondary text, disabled |
| `--popover` | `#111111` | Popover surface |
| `--input` | `#111111` | Input background |
| `--sidebar` | `#0d0d0d` | Sidebar surface |
| `--accent` | `#3b82f6` | Primary action, active state, focus |
| `--accent-light` | `#60a5fa` | Accent hover |
| `--success` | `#22c55e` | Encrypted/confirmed/healthy state |
| `--warning` | `#eab308` | Pending, at-risk warning |
| `--destructive` | `#ef4444` | Error, liquidation risk |
| `--ring` | `#3b82f6` | Focus ring |

Three surface layers: background (#0a0a0a) → card/panel (#111111) → sidebar (#0d0d0d). Secondary surface (#1a1a1a) for nested content within cards.

## Typography

**One family: JetBrains Mono.** Applied globally via CSS `* { font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace }`. This is a deliberate brand constraint — every label, data value, button, heading, and body text uses the same monospace face. Hierarchy through size and weight, not family switching.

Fixed rem scale (not fluid — product UI at consistent DPI):

| Role | Size | Weight | Notes |
|------|------|--------|-------|
| Display / page hero | 2.5–3rem | 500 | `tracking-tight` |
| Heading | 1.5–2rem | 500 | Section headers |
| Subheading | 1.125–1.25rem | 500 | Card titles |
| Body | 0.875rem | 400 | `leading-relaxed` |
| Label / badge | 0.75rem | 400–500 | |
| Micro | 0.625rem (10px) | 400 | `tracking-[0.2em]` — addresses, ciphertext prefixes |

## Spacing

Base: 4px (Tailwind default). Sections: 24–48px gaps. Cards: 16–24px padding. Dense tables: 8–12px row padding.

## Borders and Radius

`border-radius: 0 !important` globally. Hard brand constraint — brutalist zero-radius is the identity. Every card, button, input, and dialog is sharp-cornered, no exceptions.

Border weight: 1px solid `--border`. On hover/active: `border-color` transitions to `--accent` at 0.15s ease. No box-shadows on cards — single 1px border only.

## Components

### forge-card
```css
background: var(--card);
border: 1px solid var(--border);
transition: border-color 0.15s ease;
/* :hover → border-color: var(--accent) */
```

### terminal-btn
Monospace button, 1px border, no background. Four variants:
- **default**: border `--border`, text `--foreground`; hover: border + text → `--accent`
- **.primary**: border + text `--accent`; hover: bg `--accent`, text `#000`
- **.danger**: border + text `--destructive`
- **.success**: border + text `--success`

### Inputs
1px border `--border`, bg `--input`, text `--foreground`, radius 0. Focus: `border-color: --accent`, `outline: --ring/50`.

### Badges
Short status labels. `rounded-full` permitted for pill shape only — the only radius exception. Text 0.75rem, padding: `2px 8px`.

### DefiNode (ReactFlow)
`min-w-[360px] min-h-[210px]`. Top/bottom connection handles. "Encrypted" badge with lock icon. Protocol icon + name in header. Animated edge color: `#6366f1` (indigo — distinct from blue accent to disambiguate flow edges from interactive state).

## Motion

Framer Motion for transitions (ExecutionModal, PromptPage, StepStack, StrategyFlowPreview). 150–250ms durations. Ease-out curves. All animations have `@media (prefers-reduced-motion: reduce)` fallbacks (instant or crossfade).

On-brand terminal animations:
- `.cursor::after` — blinking underscore cursor at `--accent` color
- `.animate-float-subtle` — 3px vertical float on the preloader / status indicators

No page-load orchestration sequences. Product loads into a task.

## Icons

Lucide React throughout. `w-4 h-4` (16px) standard. `w-5 h-5` (20px) for section header icons.

## Status Vocabulary

| State | Token | Color |
|-------|-------|-------|
| Encrypted / confirmed / healthy | `--success` | `#22c55e` |
| Pending / at-risk | `--warning` | `#eab308` |
| Error / liquidation | `--destructive` | `#ef4444` |
| Active / selected / primary CTA | `--accent` | `#3b82f6` |
| Disabled / secondary | `--muted` | `#555555` |

State is always communicated by label + color, never color alone.

## ReactFlow Canvas

Dark bg matching `--background`. Edge strokes: `#6366f1` (indigo, animated). Minimap: transparent bg, `--accent` viewport stroke. No ReactFlow attribution (hidden). All custom nodes use `forge-card` styling with zero radius.
