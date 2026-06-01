# FheForge — Design Handoff for New Frontend Mockup

## Project Identity

FheForge is a fully homomorphic encryption (FHE) DeFi protocol deployed on Arbitrum Sepolia (chainId 421614). It lets users supply, borrow, swap, liquidate, and automate encrypted financial strategies — every amount stays encrypted on-chain using the Fhenix CoFHE SDK. Only the user can reveal their position via a cryptographic permit.

**Live contracts:** 12 contracts verified on Arbiscan (link in `README.md`)
**Current state:** Akindo Wave Hacks Final Wave submission
**Team:** @symulacr (solo)

**Important:** This handoff describes the BUSINESS LOGIC only. Do NOT replicate the existing frontend. Invent your own design language.

---

## Smart Contract Architecture (Business Logic Only)

### LendingPool.sol
The core lending engine. All user balances are `euint128` — encrypted 128-bit integers. The contract never sees plaintext amounts.

| User Action | What happens |
|-------------|-------------|
| **Supply** (`shield`) | User sends ERC-20 + encrypted InEuint128 handle. Contract verifies equality between plain and encrypted amount using `FHE.eq()`. Tokens deposited to pool. Encrypted supply balance increased via `FHESafeMath128.safeAdd`. |
| **Borrow** (`borrowWithLtvCheck`) | User provides encrypted borrow amount + desired LTV ratio. Contract computes `collateralValue * ltvBps >= debtValue` ENTIRELY ON CIPHERTEXT using `FHE.mul → FHE.lte → FHE.select`. No plaintext LTV leak. Only the encrypted borrow balance is updated — plaintext accounting is a documented gap. |
| **Borrow** (`borrowWithOracle`) | Oracle-based health check using Pyth price. Same FHE equality + encrypted balance update pattern. |
| **Repay** (`repayDebt`) | User repays encrypted debt amount. Contract verifies equality, decreases encrypted borrow balance. |
| **Liquidate** (`liquidateWithProof`) | Uses `FHE.verifyDecryptResult` — threshold network proof that the position was underwater at a specific block. Liquidator provides proof + signature. |
| **Withdraw** (`partialUnshield` / `unshieldWithProof`) | User requests withdrawal. FHE equality check on encrypted amount. Proof-based withdrawal bypasses equality check for emergency cases. |
| **Balance reveal** (`requestBalanceReveal`, `requestBorrowReveal`) | User calls `FHE.allowPublic` on their own encrypted handle — CoFHE threshold network can then decrypt. 1-hour cooldown prevents rapid-fire reveals. |

### StrategyVault.sol
Encrypted vault positions tied to on-chain strategies.

A "strategy" (registered in `StrategyRegistry`) is a program with: name, workflowHash, apyTarget, loopCount, active flag, encrypted TVL. Users open positions within strategies.

| User Action | What happens |
|-------------|-------------|
| **Open Position** (`openPosition`) | User supplies encrypted collateral. Creates a position identified by `positionId = keccak256(user, nonce)`. Associates with a strategy. Grants FHE ACL on encrypted handle. |
| **Add Collateral** (`addCollateral`) | FHE-safely adds to existing encrypted position balance via `FHESafeMath128`. |
| **Close Position** (`closePosition`) | Verifies equality on withdrawal amount via `FHE.eq()`. Decrements strategy encrypted TVL. Transfers plaintext collateral. Partial closes update encrypted balance; full closes delete all state. |

### FheForgeComposer.sol
Multi-step strategy orchestration. Composer chains Vault (collateral), LendingPool (supply/borrow), and SwapRouter (token conversion) in a SINGLE TRANSACTION. This is the primary user-facing pipeline for "automated strategies."

The `openPosition` flow: 1) supply collateral to vault → 2) supply to pool → 3) borrow from pool → 4) swap borrowed tokens → 5) re-supply swapped tokens → 6) repeat. All encrypted. All within one Composer call.

### SwapRouter.sol
Two swap pathways:
- **Intent-based swaps** (`submitSwapIntent` / `executeIntent`): User submits encrypted intent, executor fills it off-chain, verified by minAmountOut check.
- **Direct Uniswap V3** (`swapViaUniswapV3Single` / `swapViaUniswapV3MultiHop`): Direct DEX swap with slippage protection.

### PriceOracle.sol
Pyth oracle as primary price feed with admin-set fallback. Two-tier: `getPriceWithFallback` tries fresh Pyth price, falls back to `fallbackPrices` if stale/failed. Price normalization to 18-dec WAD. Per-token LTV/liquidation BPS. Confidence interval checks.

### FheForgeBase.sol (abstract)
Provides the security model that all contracts inherit:
- `FHE.allowThis()` — contract grants itself ACL for stored handles
- `FHE.allow()` — grant specific address ACL for a handle
- `FHE.allowPublic()` — anyone can decrypt (used ONLY for balance reveal + liquidation)
- `_verifyEquality()` — checks FHE.eq between caller-provided plaintext and encrypted handle using `FHE.select(isMatch, verifiedHandle, _ZERO)`
- `_grantAcl()` — grants ACL to msg.sender so they can decrypt their own position
- `FHESafeMath128` — add/sub/mul with overflow/underflow detection on encrypted values without ever decrypting

### Governance
- **FheForgeToken.sol** — ERC20 + ERC20Votes. Deployer mints supply. Holders delegate voting power.
- **FheForgeTimelock.sol** — OZ TimelockController. minDelay = 90s (demo) / 2 days (prod). Anyone can execute after delay (EXECUTOR_ROLE → address(0)).
- **FheForgeGovernor.sol** — OZ Governor. votingDelay=12 (demo), votingPeriod=144 (demo), quorum=100 bps of supply. Proposal threshold = 100 tokens hardcoded.

---

## Backend API (Business Logic)

### Auth Flow
1. `GET /auth/nonce/:walletAddress` → returns EIP-191 sign message
2. User signs with MetaMask
3. `POST /auth/wallet-login` {walletAddress, signature, nonce, chainId} → JWT (15min, HS256)
4. `GET /users/me` with JWT → user profile

### Strategy Flow
1. `POST /ai-strategy-builder/build` — Gemini AI generates DeFi strategy from natural language prompt. Rate limited 5/min.
2. `POST /defi-strategies` — Save strategy workflow JSON
3. `POST /defi-strategies/:id/simulate` — Simulate strategy (runs through SwapSimulator, SupplySimulator, BorrowSimulator)
4. `GET /defi-strategies` — List strategies with filters
5. `POST /defi-strategies/:id/execute` — Execute on-chain via FheForgeComposer

### DeFi Modules
- `GET /defi-modules` — List available DeFi protocols (Aave, Uniswap, etc.)
- `GET /defi-modules/actions/required` — Required data per action type
- `POST /defi-modules/pairs/estimate` — Estimate output of a swap/supply/borrow

### Event Indexer
Polls on-chain every 15s for StrategyVault + LendingPool events (OpenPosition, ClosePosition, AddCollateral, Withdraw, Supply, Borrow, Repay, Liquidate). Persists to `on_chain_events` table.

---

## Database Schema (16 tables)

Key tables the designer should understand:
- **users** — wallet_address, chain_id
- **strategies** — strategy marketplace listings (strategist_name, apy, tags, assets, agents, chains)
- **defi_strategies** — user-created strategies (owner, name, description, status, chain_context)
- **defi_strategy_versions** — versioned workflow JSON + graph
- **defi_strategy_executions** — on-chain execution records with status
- **defi_modules** — protocol definitions (name, protocol, category, icon_url, is_active)
- **defi_module_actions** — actions per module (swap, supply, borrow with action_type)
- **defi_pairs** — token pair registry
- **activities** — user activity log with tx hashes and step status

---

## Key UX Concepts the Designer Should Understand

1. **Encrypted vs Decrypted state** — Every user balance exists in two states: encrypted (ciphertext handle visible) and decrypted (plaintext after permit grant). The UI must distinguish these clearly.
2. **Permit lifecycle** — User must grant a CoFHE permit before encrypting amounts. Without permit, no FHE operations work. This is a mandatory first step.
3. **Pending/Encrypting states** — FHE operations are async (1-6 blocks). UI must handle pending states gracefully.
4. **Gas awareness** — Each FHE operation costs ~115-450k gas. Users need wallet ETH for gas. The strategy builder should estimate total gas cost.
5. **CoFHE Wasm requirement** — CoFHE SDK requires SharedArrayBuffer (COOP/COEP headers). Browser support is Chrome/Firefox 79+. Safari has limited support.
6. **Chain-specific** — Only Arbitrum Sepolia (chainId 421614). UI should be explicit about the chain.
7. **Wallet connection mandatory** — Every meaningful interaction requires a connected wallet. App without wallet is a landing page.

---

## Reference Files

| File | Content |
|------|---------|
| `/tmp/review-repos/MOCKUP_*.md` (21 files) | Full business logic research from contracts + backend |
| `README.md` | Project overview, architecture, deployed addresses |
| `contracts/deployments/421614.json` | 12 live contract addresses |
| `schema.sql` | Full database schema (16 tables) |

---

## What the Designer Should Do

1. Read the 21 MOCKUP_*.md files for business logic understanding
2. Choose any tech stack, design system, color palette, typography, animation language
3. Design desktop + mobile prototype covering: landing → connect → deposit → build strategy → deploy → monitor
4. Show the encrypted/decrypted state toggle visually
5. Interactive prototype (Figma/Framer/Web/any tool)
6. Document design decisions and rationale

**Do NOT** look at the existing frontend. Build your own vision.
