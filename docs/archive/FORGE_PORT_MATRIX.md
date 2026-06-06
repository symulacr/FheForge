# FheForge — Forge-to-UI Port Matrix

## 1. Forge Extracted Files (from `forge-extracted/`)

| # | File | Type | Screen |
|---|---|---|---|
| 1 | `FheForge.html` | Shell | Root HTML wrapper |
| 2 | `theme.css` | Styles | Global CSS variables |
| 3 | `app.jsx` | Entry | React app entry point |
| 4 | `components.jsx` | Library | Reusable component primitives |
| 5 | `tweaks-panel.jsx` | Component | Parameter adjustment panel |
| 6 | `screens/landing.jsx` | Screen | Landing / Home |
| 7 | `screens/dashboard.jsx` | Screen | Portfolio / Dashboard |
| 8 | `screens/lending.jsx` | Screen | Lending / Markets |
| 9 | `screens/market.jsx` | Screen | Strategies / Builder |
| 10 | `screens/governance.jsx` | Screen | Governance |
| 11 | `screens/connect-modal.jsx` | Modal | Wallet connect flow |
| 12 | `screens/builder-workspace.jsx` | Workspace | Strategy builder canvas |
| 13 | `uploads/MOCKUP_HANDOFF.md` | Doc | Design handoff notes |

---

## 2. Current UI Files (from `ui/` — 134 TSX/TS/CSS files)

### App Router Pages
| # | File | Route | Forge Origin |
|---|---|---|---|
| 1 | `app/page.tsx` | `/` | `screens/landing.jsx` |
| 2 | `app/layout.tsx` | Root layout | `FheForge.html` + `theme.css` |
| 3 | `app/globals.css` | Global styles | `theme.css` |
| 4 | `app/dashboard/page.tsx` | `/dashboard` | `screens/dashboard.jsx` |
| 5 | `app/dashboard/components/dashboard-client.tsx` | `/dashboard` | `screens/dashboard.jsx` |
| 6 | `app/lending/page.tsx` | `/lending` | `screens/lending.jsx` |
| 7 | `app/lending/components/lending-client.tsx` | `/lending` | `screens/lending.jsx` |
| 8 | `app/market/page.tsx` | `/market` | `screens/market.jsx` |
| 9 | `app/market/components/market-client.tsx` | `/market` | `screens/market.jsx` |
| 10 | `app/governance/page.tsx` | `/governance` | `screens/governance.jsx` |
| 11 | `app/governance/components/governance-client.tsx` | `/governance` | `screens/governance.jsx` |
| 12 | `app/builder/page.tsx` | `/builder` | `screens/builder-workspace.jsx` |
| 13 | `app/builder/components/BuilderPage.tsx` | `/builder` | `screens/builder-workspace.jsx` |
| 14 | `app/prompt/page.tsx` | `/prompt` | AI strategy prompt (new) |
| 15 | `app/prompt/PromptPage.tsx` | `/prompt` | AI strategy prompt (new) |
| 16 | `app/strategy/page.tsx` | `/strategy` | Strategy detail (new) |
| 17 | `app/strategy-review/page.tsx` | `/strategy-review` | Strategy review (new) |
| 18 | `app/lending-demo/page.tsx` | `/lending-demo` | Lending demo (new) |

### Landing Components (from `screens/landing.jsx`)
| # | File | Forge Origin | Status |
|---|---|---|---|
| 19 | `components/landing/background-orbits.tsx` | `BackgroundOrbits()` | Ported |
| 20 | `components/landing/demo-card.tsx` | `DemoCard()` | Ported |
| 21 | `components/landing/ticker.tsx` | `Ticker()` | Ported |

### Builder Components (from `screens/builder-workspace.jsx`)
| # | File | Forge Origin | Status |
|---|---|---|---|
| 22 | `app/builder/components/CreateStrategyModal.tsx` | Builder save modal | Ported |
| 23 | `app/builder/components/Sidebar.tsx` | Builder sidebar | Ported |
| 24 | `app/builder/components/ConfigPanel.tsx` | Builder config panel | Ported |
| 25 | `app/builder/components/DefiNode.tsx` | Builder node shell | Ported |
| 26 | `app/builder/components/estimate-card.tsx` | Builder gas estimate | Ported |
| 27 | `app/builder/components/token-selector.tsx` | Builder token picker | Ported |
| 28 | `app/builder/components/nodes/defi-node-shell.tsx` | Node shell | Ported |
| 29 | `app/builder/components/nodes/defi-node-supply.tsx` | Supply node | Ported |
| 30 | `app/builder/components/nodes/defi-node-borrow.tsx` | Borrow node | Ported |
| 31 | `app/builder/components/nodes/defi-node-swap.tsx` | Swap node | Ported |
| 32 | `app/builder/components/nodes/defi-node-join-strategy.tsx` | Strategy node | Ported |
| 33 | `app/builder/components/nodes/defi-node-default.tsx` | Default node | Ported |
| 34 | `app/builder/components/nodes/protocol-icon.tsx` | Protocol icons | Ported |
| 35 | `app/builder/components/nodes/token-icon.tsx` | Token icons | Ported |

### Shared Components (from `components.jsx` + `screens/connect-modal.jsx`)
| # | File | Forge Origin | Status |
|---|---|---|---|
| 36 | `components/shared/connect-modal.tsx` | `ConnectModal()` + steps | Ported |
| 37 | `components/shared/execution-modal.tsx` | Execution feedback | Ported |
| 38 | `components/shared/execution-step-stack.tsx` | Step progress | Ported |
| 39 | `components/shared/step-item.tsx` | Individual step | Ported |
| 40 | `components/shared/confirm-modal.tsx` | Confirmation dialog | Ported |
| 41 | `components/shared/run-strategy-modal.tsx` | Strategy run modal | Ported |
| 42 | `components/shared/onboarding-banner.tsx` | Onboarding banner | Ported |
| 43 | `components/shared/transfer-button.tsx` | Transfer CTA | Ported |
| 44 | `components/shared/search-bar.tsx` | Search input | Ported |
| 45 | `components/shared/user-signup-dialog.tsx` | Signup dialog | Ported |
| 46 | `components/shared/wallet-button.tsx` | Wallet button | Ported |
| 47 | `components/shared/permit-chip.tsx` | Permit status chip | New |
| 48 | `components/shared/cipher.tsx` | Cipher display | New |
| 49 | `components/shared/asset-glyph.tsx` | Asset icon glyph | New |
| 50 | `components/shared/ltv-gauge.tsx` | LTV visual gauge | New |
| 51 | `components/shared/master-detail.tsx` | Master-detail layout | New |
| 52 | `components/shared/md-group.tsx` | Detail group | New |
| 53 | `components/shared/md-item.tsx` | Detail item | New |
| 54 | `components/shared/mobile-nav.tsx` | Mobile navigation | New |
| 55 | `components/shared/tag.tsx` | Status tag | New |
| 56 | `components/shared/spark.tsx` | Spark decoration | New |
| 57 | `components/shared/stat.tsx` | Stat display | New |
| 58 | `components/shared/pagination.tsx` | Pagination | New |
| 59 | `components/shared/sidebar.tsx` | App sidebar | New |
| 60 | `components/shared/encrypt-progress.tsx` | Encryption progress | New |
| 61 | `components/shared/error-boundary.tsx` | Error boundary | New |
| 62 | `components/shared/footer.tsx` | Footer | New |
| 63 | `components/shared/fhe-demo-widget.tsx` | FHE demo widget | New |
| 64 | `components/shared/skip-link.tsx` | Accessibility skip | New |

### Strategy Components
| # | File | Forge Origin | Status |
|---|---|---|---|
| 65 | `components/strategy/StrategySteps.tsx` | Strategy step list | Ported |
| 66 | `components/strategy/StrategyStepsSkeleton.tsx` | Step skeleton | Ported |
| 67 | `components/strategy/StrategyFlowPreview.tsx` | Flow preview | Ported |
| 68 | `components/strategy/StrategyFlowSkeleton.tsx` | Flow skeleton | Ported |
| 69 | `components/strategy/StrategyPreview.tsx` | Strategy preview | Ported |
| 70 | `app/strategy/[id]/components/strategy-card.tsx` | Strategy card | Ported |
| 71 | `app/strategy/[id]/components/strategy-featured.tsx` | Featured badge | Ported |
| 72 | `app/strategy/[id]/components/strategy-flow.tsx` | Strategy flow | Ported |
| 73 | `app/strategy/[id]/components/strategy-rebalance.tsx` | Rebalance panel | Ported |
| 74 | `app/strategy/[id]/components/your-strategy-page.tsx` | User strategies | Ported |
| 75 | `app/strategy/[id]/components/strategy-tabs.tsx` | Strategy tabs | New |
| 76 | `app/strategy/[id]/components/strategy-list.tsx` | Strategy list | New |
| 77 | `app/strategy/[id]/components/strategy-overview.tsx` | Overview panel | New |
| 78 | `app/strategy/[id]/components/strategy-prompt-details.tsx` | Prompt details | New |
| 79 | `app/strategy/[id]/components/strategy-header.tsx` | Strategy header | New |
| 80 | `app/strategy/[id]/components/strategy-input.tsx` | Strategy input | New |
| 81 | `app/strategy/[id]/components/strategy-client-wrapper.tsx` | Client wrapper | New |
| 82 | `app/strategy/[id]/components/activity/strategy-my-activity-table.tsx` | My activity | New |
| 83 | `app/strategy/[id]/components/activity/strategy-all-activity-table.tsx` | All activity | New |

### UI Components (shadcn/ui — from `components.jsx`)
| # | File | Forge Origin | Status |
|---|---|---|---|
| 84-132 | `components/ui/*.tsx` (49 files) | `components.jsx` primitives | Ported to shadcn |

### Lending Components
| # | File | Forge Origin | Status |
|---|---|---|---|
| 133 | `components/lending/lending-actions-demo.tsx` | LendAction demo | Ported |
| 134 | `app/common/common-table.tsx` | Table component | Ported |
| 135 | `app/common/table-with-showmore.tsx` | Show-more table | Ported |

### Core / Entry
| # | File | Forge Origin | Status |
|---|---|---|---|
| 136 | `components/preloader.tsx` | Preloader | Ported |
| 137 | `components/hero-section.tsx` | Hero section | Ported |
| 138 | `components/background-video.tsx` | Background video | Dropped |
| 139 | `components/effect/interactive-text-effect.tsx` | Text effect | New |

---

## 3. Matrix: Forge Function → Current Component

| Forge Function (jsx) | Current Component (tsx) | Screen | Notes |
|---|---|---|---|
| `Landing()` | `app/page.tsx` | Home | React → Next.js App Router |
| `DemoCard()` | `components/landing/demo-card.tsx` | Home | Extracted |
| `Ticker()` | `components/landing/ticker.tsx` | Home | Extracted |
| `BackgroundOrbits()` | `components/landing/background-orbits.tsx` | Home | Extracted |
| `Dashboard()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Split client/server |
| `Overview()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `DetailFor()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `PositionDetail()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `StrategyDetail()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `ActivityDetail()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `Tile()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `DashboardEmpty()` | `app/dashboard/components/dashboard-client.tsx` | Portfolio | Inlined |
| `Lending()` | `app/lending/components/lending-client.tsx` | Lending | Split client/server |
| `LendAction()` | `app/lending/components/lending-client.tsx` | Lending | Inlined |
| `Market()` | `app/market/components/market-client.tsx` | Market | Split client/server |
| `loadDrafts()` | `app/market/components/market-client.tsx` | Market | Inlined |
| `EmptyDetail()` | `app/market/components/market-client.tsx` | Market | Inlined |
| `BuilderWorkspace()` | `app/builder/components/BuilderPage.tsx` | Builder | ReactFlow rewrite |
| `nextSuggestionFor()` | `app/builder/components/BuilderPage.tsx` | Builder | Inlined |
| `walkOrder()` | `lib/defi-workflow-builder.ts` | Builder | Extracted to lib |
| `detectIssues()` | `lib/defi-workflow-builder.ts` | Builder | Extracted to lib |
| `organizeLayout()` | `lib/defi-workflow-builder.ts` | Builder | Extracted to lib |
| `Governance()` | `app/governance/components/governance-client.tsx` | Governance | Split client/server |
| `ProposalDetail()` | `app/governance/components/governance-client.tsx` | Governance | Inlined |
| `ConnectModal()` | `components/shared/connect-modal.tsx` | Global | Extracted shared |
| `StepWallet()` | `components/shared/connect-modal.tsx` | Global | Inlined |
| `StepSign()` | `components/shared/connect-modal.tsx` | Global | Inlined |
| `StepPermit()` | `components/shared/connect-modal.tsx` | Global | Inlined |
| `StepReady()` | `components/shared/connect-modal.tsx` | Global | Inlined |

---

## 4. Files with No Forge Equivalent (New in UI)

### Hooks (23 files)
| File | Purpose |
|---|---|
| `hooks/use-fhe-wallet.ts` | FHE wallet + cofhe SDK |
| `hooks/use-permit-countdown.ts` | Permit expiry timer |
| `hooks/use-protocol-stats.ts` | Protocol stats API |
| `hooks/use-markets.ts` | Markets data API |
| `hooks/use-strategies.ts` | Strategy list API |
| `hooks/use-strategy-prompt.ts` | AI prompt API |
| `hooks/use-strategy-builder.ts` | Builder state |
| `hooks/use-config-panel-form.ts` | Config form |
| `hooks/use-activity-service.ts` | Activity API |
| `hooks/use-portfolio.ts` | Portfolio data |
| `hooks/use-lending-actions.ts` | Lending contract calls |
| `hooks/use-swap-router.ts` | Swap contract calls |
| `hooks/use-composer.ts` | Composer contract calls |
| `hooks/use-fhe-vault.ts` | Vault contract calls |
| `hooks/use-rebalance.ts` | Rebalance API |
| `hooks/use-user.ts` | User API |
| `hooks/use-mobile.ts` | Mobile detection |
| `hooks/use-toast.ts` | Toast state |
| `hooks/use-defi-modules.ts` | DeFi modules |
| `hooks/use-activity-service.ts` | Activity pagination |

### Services (7 files)
| File | Purpose |
|---|---|
| `services/api.ts` | API client + endpoints |
| `services/defi-module-service.ts` | DeFi module API |
| `services/strategy-service.ts` | Strategy API |
| `services/ai-strategy-service.ts` | AI builder API |
| `services/defi-strategy-builder.ts` | Strategy builder API |
| `services/activity-service.ts` | Activity API |
| `services/user-service.ts` | User API |
| `services/stats-service.ts` | Stats API |

### Providers (6 files)
| File | Purpose |
|---|---|
| `providers/fhenix-provider.tsx` | Fhenix CoFHE provider |
| `providers/user-provider.tsx` | User context |
| `providers/preloader-provider.tsx` | Preloader state |
| `providers/toast-provider.tsx` | Toast provider |
| `providers/swr-provider.tsx` | SWR config |

### Config / Lib (9 files)
| File | Purpose |
|---|---|
| `lib/cofhe-client.ts` | CoFHE client init |
| `lib/constants.ts` | App constants |
| `lib/utils.ts` | Utilities |
| `lib/iconMap.ts` | Icon mapping |
| `lib/defi-builder-validation.ts` | Builder validation |
| `lib/defi-node-factory.ts` | Node factory |
| `lib/defi-workflow-builder.ts` | Workflow builder |
| `lib/defi-connection-rules.ts` | Connection rules |
| `config/chains/arbitrum-sepolia.ts` | Chain config |

---

## 5. Forge Files Not Ported

| Forge File | Reason |
|---|---|
| `tweaks-panel.jsx` | Dropped — parameter panel not needed in ReactFlow builder |
| `components.jsx` | Replaced by shadcn/ui component library |
| `uploads/MOCKUP_HANDOFF.md` | Documentation only |

---

## 6. Design System Compliance Summary

### Compliant (JetBrains Mono, zero radius, semantic tokens)
- All builder nodes (`defi-node-*.tsx`)
- All screen clients (`dashboard-client.tsx`, `lending-client.tsx`, etc.)
- All shared components (`connect-modal.tsx`, `execution-modal.tsx`, etc.)
- All landing components (`demo-card.tsx`, `ticker.tsx`, `background-orbits.tsx`)

### Remaining Violations (to fix)
| File | Violation | Count |
|---|---|---|
| `components/lending/lending-actions-demo.tsx` | `rounded` (shadcn Card) | 5 |
| `components/strategy/StrategyStepsSkeleton.tsx` | `rounded` | 3 |
| `app/prompt/PromptPage.tsx` | `border-white/5`, `bg-neutral-900`, `border-white/30`, `border-white/80` | 6 |
| `app/builder/components/token-selector.tsx` | `bg-neutral-800`, `border-white/20` | 1 |
| `app/strategy/[id]/components/strategy-featured.tsx` | `rounded`, `bg-primary/10` | 2 |
| `app/strategy/[id]/components/your-strategy-page.tsx` | `rounded`, `bg-neutral-900/40`, `bg-neutral-900/50`, `bg-neutral-900` | 6 |
| `app/strategy/[id]/components/activity/strategy-my-activity-table.tsx` | `bg-green-500/20`, `text-green-400`, `bg-yellow-500/20`, `text-yellow-400` | 4 |
| `app/strategy/[id]/components/activity/strategy-all-activity-table.tsx` | `bg-green-500/20`, `text-green-400` | 2 |

Total: ~29 violations across 8 files.
