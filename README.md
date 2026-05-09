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
| StrategyVault | `0xBf65f09f901340328C17e10d67479bd884feC551` |
| LendingPool | `0x605e973B47C311aE9ad7ea5984e673B129fCB769` |
| SwapRouter | `0xc613Ba147b7d76854c6e2D37E15fe50FFbD8F489` |
| StrategyRegistry | `0xfe9FAb915b0271CEA1243a299a4a4085497DE260` |
| PriceOracle | `0x6793a71fefA499d9A345Bd4Ab15eae8bb27F065C` |
| FheForgeComposer | `0xCEF1B60C8FE8641f3346c5eD0ebBDA742c62e750` |
| ExecutorContract | `0xA4f22e945569e51d006623c92bbA202b65a25182` |
| WETH (mock) | `0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d` |
| USDC (mock) | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` |

---

## Built

- **StrategyVault** — open/add/close pos, `euint128` collat, FHE ACL
- **LendingPool** — supply/borrow/checkLtvAndBorrow/repay/withdraw, encrypted amt
- **Lending Actions** — liquidate, borrowWithOracle, emergencyWithdraw, isSupported (MC-36/37/38/44/45)
- **Event Indexing** — on-chain event monitoring for StrategyVault and LendingPool (MC-55)
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
