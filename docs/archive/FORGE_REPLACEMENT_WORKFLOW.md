# FheForge — forge.zip → Frontend Replacement Workflow

## What This Is

End-to-end plan to transplant the `forge.zip` mockup design system into the live Next.js 14 frontend.
The mockup ships: warm-paper editorial design, dual light/dark theme, serif + mono type hierarchy,
master-detail layout primitive, `Cipher` encrypted-value component, and 7 complete screens.

---

## Replacement Matrix

| Mockup Source | Maps To (Actual UI) | Action |
|---|---|---|
| `theme.css` (oklch tokens, Paper/Ink/Accent, type scale) | `ui/app/globals.css` | Replace CSS variables; add font imports |
| `components.jsx` → `TopBar` | `ui/app/layout.tsx`, `ui/components/shared/sidebar.tsx` | Rebuild nav with theme toggle, PermitChip, WalletChip |
| `components.jsx` → `Cipher` | **New** `ui/components/shared/cipher.tsx` | Create primitive with blur/unlock + permit tooltip |
| `components.jsx` → `PermitChip` | `ui/components/shared/wallet-button.tsx` | Add permit countdown chip alongside wallet chip |
| `components.jsx` → `MasterDetail` | **New** `ui/components/shared/master-detail.tsx` | Create layout shell (320px rail + detail pane) |
| `components.jsx` → `LtvGauge` | **New** `ui/components/shared/ltv-gauge.tsx` | Meter with fill + liquidation tick |
| `components.jsx` → `Spark`, `Tag`, `Stat`, `AssetGlyph`, `MDItem`, `MDGroup` | **New** `ui/components/shared/primitives.tsx` | Barrel of small shared components |
| `screens/landing.jsx` | `ui/app/page.tsx` + `ui/components/hero-section.tsx` | Full rewrite — hero, BackgroundOrbits, Cipher demo, CTAs |
| `screens/dashboard.jsx` (Portfolio) | `ui/app/strategy/[id]/components/your-strategy-page.tsx` + activities | Rewrite to master-detail — positions / strategies / activity groups |
| `screens/lending.jsx` | `ui/app/lending-demo/page.tsx` + `ui/components/lending/lending-actions-demo.tsx` | Rewrite to master-detail — 5 markets + action panel + FHE encrypt inputs |
| `screens/market.jsx` (Strategies) | `ui/app/strategy/page.tsx` | Rewrite to master-detail — community + drafts left rail, BuilderWorkspace right |
| `screens/builder-workspace.jsx` | `ui/app/builder/components/BuilderPage.tsx` + node files | Rewrite canvas — dot-grid, SVG edge layers, node palette, inspector |
| `screens/connect-modal.jsx` | `ui/components/shared/wallet-button.tsx` + **New** `ui/components/shared/connect-modal.tsx` | 4-step modal: wallet → sign → permit → ready |
| `screens/governance.jsx` | **New** `ui/app/governance/page.tsx` + `ui/app/governance/layout.tsx` | New route — proposals master-detail + vote panel |
| `app.jsx` (theme, routing) | `ui/app/layout.tsx` (providers) | Add `data-theme` attribute toggle, localStorage persistence |

---

## Wiring Map (Design → Live Data)

| Mockup (prototype data) | Live Backend Endpoint | Notes |
|---|---|---|
| `D_POSITIONS` (hardcoded) | `GET /activities` + `GET /users/balance/:addr/:tokenId` | Position amounts encrypted; show Cipher |
| `D_STRATS` | `GET /defi-strategies` | Map name/apy/loops from DB |
| `D_ACTIVITY` | `GET /activities` | block/age/kind/delta from `on_chain_events` |
| `L_MARKETS` (hardcoded) | `GET /defi-token` + env `SUPPLY_APY_BPS`/`BORROW_APY_BPS` | Rates from env; TVL from on_chain_events |
| `COMMUNITY` strategy list | `GET /strategies` | strategist_name/apy/tvl/deployers |
| `PROPOSALS` (hardcoded) | No BE route → static data initially | Governance reads from FheForgeGovernor contract events |
| Connect → nonce/sign/JWT | `GET /auth/nonce/:addr` → `POST /auth/wallet-login` | Wire the 4-step modal fully; store JWT in memory (not localStorage) |
| AI build | `POST /ai-strategy-builder/build` | Prompt screen → BE Gemini → strategy steps |
| Strategy simulate | `POST /defi-strategies/simulate` | Fix: FE uses wrong path; correct to body-driven route |
| Permit | `@cofhe/react` `permits.getOrCreateSelfPermit()` | Triggered on step 3 of connect modal |

---

## Agent Execution Plan

### Wave 1 — Foundation (parallel, no deps)
| Agent | Task | Files |
|---|---|---|
| `css-tokens` | Extract theme.css → globals.css CSS variables; add Google Fonts import (Newsreader, Instrument Serif, Public Sans) | `ui/app/globals.css` |
| `cipher-primitive` | Create Cipher TSX component from components.jsx | `ui/components/shared/cipher.tsx` |
| `master-detail` | Create MasterDetail layout TSX from components.jsx | `ui/components/shared/master-detail.tsx` |
| `shared-primitives` | Create barrel: LtvGauge, Spark, Tag, Stat, AssetGlyph, MDItem, MDGroup | `ui/components/shared/primitives.tsx` |
| `ltv-gauge` | Create LtvGauge TSX | `ui/components/shared/ltv-gauge.tsx` |
| `governance-page` | Scaffold governance route with proposals master-detail + vote panel | `ui/app/governance/page.tsx` |

### Wave 2 — Layout + Connect (depends on Wave 1 primitives)
| Agent | Task | Files |
|---|---|---|
| `layout-topbar` | Rebuild layout.tsx TopBar with theme toggle (data-theme), PermitChip (permit countdown + wagmi hook), WalletChip | `ui/app/layout.tsx` |
| `connect-modal` | Build 4-step connect modal fully wired: wallet select → wagmi connect → BE nonce/sign/JWT → @cofhe permit | `ui/components/shared/connect-modal.tsx` |

### Wave 3 — Screens (parallel, depend on Wave 1+2)
| Agent | Task | Files |
|---|---|---|
| `landing-page` | Rewrite landing: BackgroundOrbits CSS animation, hero grid, live Cipher demo, CTAs wired to router | `ui/app/page.tsx`, `ui/components/hero-section.tsx` |
| `portfolio-page` | Rewrite portfolio as master-detail with positions/strategies/activity from real API | `ui/app/strategy/[id]/components/your-strategy-page.tsx` |
| `lending-page` | Rewrite lending as master-detail: 5 markets from `/defi-token`, FHE encrypt inputs, LtvGauge | `ui/app/lending-demo/page.tsx`, `ui/components/lending/lending-actions-demo.tsx` |
| `strategy-market` | Rewrite strategy list as master-detail: community from `/strategies`, drafts from localStorage, builder detail | `ui/app/strategy/page.tsx` |
| `builder-workspace` | Rewrite BuilderPage: dot-grid canvas, SVG edge layers (halo/hit/stroke), nodes with ports, inspector, palette, deploy button wired to Composer contract | `ui/app/builder/components/BuilderPage.tsx` |

### Wave 4 — Verification
| Agent | Task |
|---|---|
| `type-check` | Run `cd ui && bun run build --dry-run` or `tsc --noEmit`; report errors |
| `wiring-check` | Verify all API calls use correct endpoints; check JWT attached in axios; check permit flow |

---

## Design System Decisions

| Property | Mockup Value | Actual Constraint (DESIGN.md) | Resolution |
|---|---|---|---|
| Background | warm paper oklch(96.8%) | dark terminal #0a0a0a | **Mockup wins** — user explicitly asked to replace with mockup design |
| Typeface | Newsreader + Public Sans + JetBrains Mono | JetBrains Mono only | **Mockup wins** — adds serif+sans on top of mono |
| Border-radius | 0 except chip dots | 0 non-negotiable | Both agree — keep 0 |
| Accent | oklch(70% 0.135 72) = warm amber | #3b82f6 blue | **Mockup wins** |
| Theme | light + dark toggle | dark only | **Mockup wins** — adds light mode |

---

## Key Technical Constraints

- `@cofhe/react`: requires SharedArrayBuffer (COOP/COEP headers); `permits.getOrCreateSelfPermit()` async
- Cipher encrypt: `Encryptable.uint128(amount)` — must run after permit
- wagmi v2: `useAccount`, `useConnect`, `useSignMessage`, `useContractWrite`
- JWT: stored in-memory (React context), not localStorage. 15min expiry, no refresh.
- Fix route bugs before wiring: `/defi-strategies/simulate` path mismatch, `?walletAddress` vs `?address`
- Governance: no BE route — read proposals from FheForgeGovernor contract via wagmi `useContractRead`

---

## File Tree After Replacement

```
ui/
  app/
    globals.css              ← theme tokens (from theme.css)
    layout.tsx               ← TopBar, theme toggle, providers
    page.tsx                 ← Landing (from screens/landing.jsx)
    lending-demo/page.tsx    ← Lending (from screens/lending.jsx)
    strategy/page.tsx        ← Market+Builder (from screens/market.jsx)
    strategy/[id]/...        ← Portfolio detail (from screens/dashboard.jsx)
    governance/page.tsx      ← NEW (from screens/governance.jsx)
    builder/components/
      BuilderPage.tsx        ← Canvas (from screens/builder-workspace.jsx)
  components/shared/
    cipher.tsx               ← NEW: Cipher primitive
    master-detail.tsx        ← NEW: MasterDetail layout
    ltv-gauge.tsx            ← NEW: LTV meter
    primitives.tsx           ← NEW: Tag, Stat, Spark, AssetGlyph, MDItem, MDGroup
    connect-modal.tsx        ← NEW: 4-step connect flow
    wallet-button.tsx        ← Extended: PermitChip + WalletChip
```

---

## Run Sequence

```bash
# 1. Install fonts (if not already via next/font)
# Add to layout.tsx: import { Newsreader, Public_Sans, Instrument_Serif } from 'next/font/google'

# 2. Verify build after each wave
cd ui && bun run build

# 3. Run dev to test
cd ui && bun run dev
```

---
*Generated by FheForge ultrawork exploration workflow — 2026-06-01*
