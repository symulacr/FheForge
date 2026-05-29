# FheForge Demo Video Script (2:30)

**Target:** Akindo Wave Hacks judges (technical and non-technical)
**Platform:** YouTube (unlisted) — link embedded in submission
**Format:** Screen recording at 1440x900 + narration (Loom or OBS)
**Style:** Clean browser profile, no bookmarks bar, pre-funded demo wallet with test ETH and a small existing position

---

## Scene 1 (0:00–0:20) — Problem: DeFi Has No Privacy

> _On screen: FheForge logo centered on dark background. Fade to split-screen: left side shows Etherscan with a wallet's full transaction history (exposed), right side shows a liquidation bot dashboard listing healthy positions about to be targeted._

**Narrator:**
"Today's DeFi is a glass house. Every position, every swap, every liquidation is public on-chain. Anyone with a block explorer can see your wallet balance, your trading strategy, and your liquidation risk in real time."

> _Animate: highlight Etherscan rows showing dollar amounts, then show a liquidation bot scanning and front-running a position. Text overlay: "This is the default — and it's broken."_

**Narrator:**
"That means bots front-run your healthy positions, MEV searchers extract value from your every transaction, and institutional capital simply cannot operate with full public visibility."

> _On screen: fade to title card — "FheForge: Private, Encrypted DeFi" over a circuit-board FHE visual._

**Narrator:**
"For DeFi to reach its potential, privacy isn't optional — it's foundational. That's why we built FheForge."

---

## Scene 2 (0:20–0:45) — FHE Solution: Encrypted Amounts

> _On screen: simplified animation showing a user's USDC being encrypted client-side into a padlock icon labeled "euint128", then sent to a smart contract. The contract performs arithmetic on the padlock — no key required._

**Narrator:**
"FheForge uses Fully Homomorphic Encryption — FHE — from CoFHE and Fhenix. Here's what that means:"

> _On screen: text fades in — "1. Encrypt on client" → "2. Compute on ciphertext" → "3. Only you decrypt". Animation shows the user encrypting 1000 USDC into a ciphertext handle, the contract computing 'supply + borrow' on encrypted values, and only the user's permit key unlocking the result._

**Narrator:**
"Your browser encrypts your amount before it ever reaches the network. The smart contract receives a ciphertext — an `euint128` handle — and performs supply, borrow, and swap logic directly on encrypted data. No one sees the underlying value. Not the protocol. Not the block explorer. Not the MEV bot."

> _On screen: show comparison — plaintext transaction on Etherscan exposing "Deposit: 10,000 USDC" vs. FheForge transaction showing only "shield(InEuint128: 0x7f3a...)". Ciphertext is indecipherable garble on the explorer._

**Narrator:**
"This isn't a zero-knowledge proof that hides your input off-chain. This is on-chain computation on encrypted state — the first DeFi protocol to do it at production scale."

> _Fade to browser mockup of the FheForge app._

---

## Scene 3 (0:45–1:45) — Live App Demo: Connect → Deposit → Borrow → Portfolio

> _On screen: full browser window (1440x900), navigate to the FheForge app. MetaMask installed, already on Arbitrum Sepolia._

**Narrator:**
"Let me show you what this looks like in practice."

> _On screen: click "Connect Wallet" → MetaMask pops up → confirm → wallet connects. Dashboard appears showing portfolio overview with encrypted indicators._

**Narrator:**
"I connect my wallet — standard MetaMask on Arbitrum Sepolia. The dashboard loads my portfolio, but every balance shows as encrypted. The UI displays truncated ciphertext handles, not dollar amounts."

> _On screen: navigate to the deposit flow. Click "Deposit" → enter an amount → transaction is encrypted via CoFHE SDK before submission. Show MetaMask confirmation showing the calldata contains an `InEuint128` parameter._

**Narrator:**
"Let's deposit some USDC as collateral. I enter the amount, and the CoFHE SDK in my browser encrypts it before building the transaction. What gets submitted to the chain is a ciphertext — the block explorer will show garbled data, not my deposit amount."

> _On screen: MetaMask confirms → transaction pending → confirmed. Return to dashboard — the position now shows updated encrypted collateral._

**Narrator:**
"Transaction confirmed. My position is now on-chain, but the amount is encrypted. You can see it in my portfolio, but you cannot read it."

> _On screen: navigate to the borrow panel. Click "Borrow" → select 50% LTV → confirm MetaMask → transaction executes. Then show the portfolio with both encrypted collateral and encrypted borrow displayed._

**Narrator:**
"Now I borrow against that collateral — again, encrypted. The contract checks my loan-to-value ratio using FHE comparisons on ciphertexts. The result: I have both a supply position and a borrow position, both invisible to the outside world."

> _On screen: click "Reveal" button on the portfolio → generate a signed permit → decrypt the position → plaintext balance appears briefly. Text overlay: "Selective disclosure via signed permit."_

**Narrator:**
"Of course, I can still see my own balances — I'm the owner. With a signed cryptographic permit, I can also selectively reveal specific positions to an auditor, a liquidator, or a smart contract. Only what I choose, only to whom I choose."

> _On screen: overlay "Decrypt permit" animation showing a permit being signed for a specific address, limiting decryption to that one handle._

---

## Scene 4 (1:45–2:15) — Architecture

> _On screen: transition to a clean system architecture diagram (mermaid or animated). Three horizontal layers appear one at a time._

**Narrator:**
"Behind the scenes, FheForge is a three-layer architecture."

> _On screen: Layer 1 lights up — "DeFi Contracts: LendingPool, SwapRouter, StrategyVault, PriceOracle" with icons for each._

**Narrator:**
"Layer one is DeFi logic — standard lending, swapping, and vault semantics, but every amount is an `euint128` ciphertext. LendingPool computes supply and borrow using `FHE.add` and `FHE.lte`. SwapRouter enables intent-based AMM with encrypted amounts."

> _On screen: Layer 2 lights up — "Encryption Layer: CoFHE ACL, FheForgeBase, Permits" with connections to user wallet._

**Narrator:**
"Layer two is encryption — CoFHE handles and ACL management. `FheForgeBase` provides `_verifyEquality` for ciphertext integrity, `FHESafeMath128` for overflow-safe encrypted arithmetic, and the permit system for selective disclosure."

> _On screen: Layer 3 lights up — "Execution Layer: FheForgeComposer, StrategyExecutor" with arrows showing multi-step strategy flow._

**Narrator:**
"Layer three is the execution pipeline. The FheForgeComposer orchestrates multi-step strategies — vault deposit, pool supply, swap, borrow — in a single atomic transaction. The StrategyExecutor manages gas checkpointing for long pipelines of up to eight action types."

> _On screen: show the AI Builder ReactFlow canvas — drag nodes (SWAP, SUPPLY, BORROW) connected by arrows. Then show the AI text input box._

**Narrator:**
"Users compose strategies visually on a ReactFlow canvas — or just describe their goal in plain English. The Gemini-powered AI builder parses it into a structured strategy, the backend simulates it, and then the composer executes it on-chain."

> _On screen: briefly show the backend stack text — "NestJS, Supabase/PostgreSQL, Gemini AI" — and the frontend stack — "Next.js 14, wagmi v2, @cofhe/react, shadcn/ui."_

---

## Scene 5 (2:15–2:30) — Team + Call to Action

> _On screen: fade to dark background. FheForge logo centered. Below it: "Built by @symulacr" — "Smart Contracts · Backend · Frontend · Infrastructure"._

**Narrator:**
"FheForge was built by a solo developer as an end-to-end encrypted DeFi protocol — from Solidity smart contracts hardened with Slither, Aderyn, and Certora formal verification, through the NestJS backend with real Gemini integration, to the Next.js frontend with CoFHE client-side encryption."

> _On screen: show links — "github.com/symulacr/FheForge" and "ui-chi-ashy.vercel.app". Fade in track badges: "RWA & Compliance · DeFi & Lending · Privacy Infrastructure."_

**Narrator:**
"Every contract is deployed and verified on Arbitrum Sepolia. The full test suite passes on live testnet, with real FHE operations verified on-chain. The code is open-source — MIT and Apache 2.0 dual-licensed."

> _On screen: final frame — FheForge logo + "Private. Encrypted. On-Chain." + Akindo Wave Hacks branding. Text: "Try it at ui-chi-ashy.vercel.app" and "Contribute at github.com/symulacr/FheForge."_

**Narrator:**
"This is the future of DeFi — private positions, selective disclosure, and programmable encryption without trusted hardware or off-chain computation. Try the live app, explore the code, and help us build the privacy layer that DeFi has been missing.

Thank you."

---

## Recording Checklist

- [ ] Clean browser profile — no bookmarks bar, extensions disabled except MetaMask
- [ ] Pre-fund demo wallet with test ETH on Arbitrum Sepolia (faucet)
- [ ] Pre-fund demo wallet with test USDC from the LendingPool faucet
- [ ] Pre-create a small encrypted deposit position (saves time during recording)
- [ ] Close all background tabs, notifications, and system pop-ups
- [ ] Record at 1440x900 for consistent README screenshot compatibility
- [ ] Speak at ~150 words per minute
- [ ] Add captions via YouTube Studio after upload
- [ ] Set video to **unlisted**, embed link in README
- [ ] Verify the live app URL in the script matches the deployed Vercel domain

## Script Reference

| Scene | Duration | Key Visuals | Key Message |
|-------|----------|-------------|-------------|
| 1 | 0:00–0:20 | Etherscan contrast, liquidation bots | Public DeFi is broken |
| 2 | 0:20–0:45 | Encryption animation, tx comparison | FHE computes on ciphertexts |
| 3 | 0:45–1:45 | Live screen recording: connect → deposit → borrow → permit reveal | It works, it's encrypted |
| 4 | 1:45–2:15 | Architecture diagram, ReactFlow, AI builder | Three-layer design |
| 5 | 2:15–2:30 | Team, links, closing frame | Open source, try it |
