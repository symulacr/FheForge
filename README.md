# FheForge — Encrypted DeFi on Arbitrum Sepolia (CoFHE)

amt → `euint128`. Pos invisible. Reveal via signed permit.

---

## Live

Frontend → https://ui-chi-ashy.vercel.app
API → https://fheforge-api-production.up.railway.app

---

## Contracts — Arbitrum Sepolia (421614)

| Contract | Address |
|---|---|
| StrategyVault | `0x261c4b5a66C24Dd1974E7ea470e76154dff062F5` |
| LendingPool | `0xb4F6b792219e3d6Cd3f3B8088285e52a64CCcb44` |
| SwapRouter | `0x78C2818a401477F78E129A7526bC833Eb93d964A` |
| StrategyRegistry | `0xcdFB608e7f45f6e6cCA27e504ce6b8aDe64701B9` |
| WETH | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

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
hardened  108 PASS | 0 FAIL | 7 VULN
sharp      46 PASS | 2 FAIL (LendingPool withdraw guard — known bug)
```

Run: `node contracts/scripts/test-hardened.js` · `node contracts/scripts/test-sharp.js`

---

## Known Issues

| Severtiy | Issue | Status |
|---|---|---|---|
| HIGH | `LendingPool.borrow()` — no collat check. Use `checkLtvAndBorrow` | Open |
| HIGH | `StrategyVault.positionStrategyIds` never written — TVL decrement dead code | FIXED (Wave 5) |
| MED | `closePosition()` — no encrypted debt check before close | Open |
| LOW | `Router.executor` EOA — need dedicated executor contract | Open (FHE-stripped, lower impact) |
| LOW | 96 solhint prettier warnings | Open (cosmetic) |

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
