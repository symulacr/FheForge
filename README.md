# FheForge — Encrypted DeFi on Arbitrum Sepolia (CoFHE)

amt → `euint128`. Pos invisible. Reveal via signed permit.

---

## Live

Frontend → https://ui-chi-ashy.vercel.app
API → https://fheforge-api-production.up.railway.app

---

## Contracts — Arbitrum Sepolia (421614)

| Contract | Address |
|---|---|---|
| StrategyVault | `0x543Cb8AB0e9dC71553c009B9aA095fB4a1fc3745` |
| LendingPool | `0xAB4CD38DFdf8F7d446d3758ED5958dFcB84Af8C6` |
| SwapRouter | `0x92747133b448767eE94d1B3b19fD1258c1C49d5c` |
| StrategyRegistry | `0xfe9FAb915b0271CEA1243a299a4a4085497DE260` |
| PriceOracle | `0x8c7CF00EA1dB76C8B2465e0CA944f94407f0633C` |
| FheForgeComposer | `0x13Cdc64499530f69553D26C8807A37434c74953b` |
| ExecutorContract | `0x5BF0a5cB4a0e4ae82a13bC4a8d85DfD42D6D4233` |
| WETH (mock) | `0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d` |
| USDC (mock) | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` |

---

## Built

- **StrategyVault** — open/add/close pos, `euint128` collat, FHE ACL
- **LendingPool** — supply/borrow/checkLtvAndBorrow/repay/withdraw, encrypted amt
- **SwapRouter** — submit/cancel/execute swap intents, encrypted `amountIn`/`minOut`
- **StrategyRegistry** — register strategy, track encrypted TVL
- **DeFi Builder** — ReactFlow canvas compose strategy (SWAP/SUPPLY/BORROW)
- **AI Prompt** — Gemini gen strategy from NL
- **Wallet** — wagmi v2 + CoFHE SDK, arb-sepolia, MetaMask

---

## FHE Privacy

- amt → `euint128` (CoFHE/Fhenix)
- ZkVerifier reject unsigned input — no dummy ciphertext
- `decryptForView` require signed permit — only you read pos
- cross-user iso verified: t2 can't decrypt t1 ctHash

---

## Tests

```
forge      13 PASS | 0 FAIL
hardhat      4 PASS | 0 FAIL
brutal     T1-T12 live breaker
```

Run: `node contracts/scripts/test-hardened.js` · `node contracts/scripts/test-sharp.js`

---

## Known Issues

| Severity | Issue | Status |
|---|---|---|
| MED | Dual plain+encrypted input skew — no on-chain `amount == encAmount` enforcement. Mitigation requires CoFHE ZK proof of equality (post-MVP). | Known — documented in @dev |
| LOW | 2 solhint warnings (struct packing). Cosmetic. | Deferred |

### Resolved

| Severity | Issue | Resolution |
|---|---|---|
| HIGH | `LendingPool.borrow()` — no collat check | Stale — no bare `borrow()` exists. Only `checkLtvAndBorrow` + `borrowWithOracle`, both guarded. |
| HIGH | `StrategyVault.positionStrategyIds` never written | Fixed (Wave 5) |
| LOW | `Router.executor` EOA | Fixed — `ExecutorContract` deployed (Wave 6) |
| LOW | 96 solhint prettier warnings | Fixed — prettier format, 0 errors, 2 cosmetic warnings remain |

---

## Stack

| Layer | Tech |
|---|---|
| Contracts | Solidity, CoFHE SDK, OZ, Hardhat |
| Frontend | Next.js 14, wagmi v2, viem, @cofhe/react, ReactFlow |
| Backend | NestJS, Supabase (PostgreSQL), Gemini AI |
| Chain | Arbitrum Sepolia (CoFHE TaskManager live) |
| Deploy | Vercel (FE) · Railway (API) |

---

## Setup

```bash
# contracts
cd contracts && npm install && node scripts/test-hardened.js

# frontend
cd ui && bun install && bun dev

# backend
cd backend/apps && bun install && bun start:dev
```

Copy `ui/.env.example` → `ui/.env.local`, `backend/apps/.env.development.example` → `backend/apps/.env.development`. Fill keys.
