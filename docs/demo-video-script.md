# Demo Video Script — FheForge (3 minutes)

**Target:** Buildathon judges (technical and non-technical)  
**Platform:** YouTube (unlisted) — link included in submission  
**Tool:** Loom or OBS at 1440×900

---

## 0:00 – 0:30 — Intro

> _On screen: FheForge logo and "Akindo Wave Hacks" overlay_

**Narrator:** "Hi — welcome to FheForge. We're building **private, encrypted DeFi** on Arbitrum Sepolia using fully homomorphic encryption from CoFHE/Fhenix.

Today's DeFi is a glass house — every position, swap, and liquidation is visible to everyone. That's a problem for institutions, for privacy-conscious users, and for real-world asset markets.

FheForge solves this. Let me show you how."

---

## 0:30 – 1:15 — Dashboard & Wallet

> _On screen: browser window at 1440×900, navigate to FheForge frontend_

**Narrator:** "This is the FheForge dashboard. Let me connect my wallet — just MetaMask on Arbitrum Sepolia.

Once connected, you can see your portfolio with **encrypted balance indicators**. Your positions are visible to you — and only you — via signed permits.

No one else — not even the protocol — can see your individual balances."

---

## 1:15 – 2:00 — DeFi Builder with AI Prompt

> _On screen: navigate to /builder, show ReactFlow canvas_

**Narrator:** "The DeFi Builder is a visual canvas where you compose strategies by connecting DeFi building blocks — swap, supply, borrow.

You can also use the **AI Strategy Generator**. Let me type: 'Swap 1 WETH for USDC, supply it to the pool, then borrow 50% against it.'

> _On screen: type prompt, click generate, show result_

The AI — powered by Gemini — produces a structured strategy. You review it, tweak if needed, and confirm."

---

## 2:00 – 2:30 — On-Chain Execution

> _On screen: click "Execute" on a strategy, show MetaMask confirmation, show explorer_

**Narrator:** "When you're ready, click Execute. MetaMask prompts you to confirm the transaction.

The FheForgeComposer contract orchestrates the full strategy: it swaps on SwapRouter, supplies to LendingPool, and borrows — all in one transaction.

> _On screen: show Arbiscan transaction with event logs_

Every amount is encrypted as `euint128`. The contract computes on ciphertexts. Nothing is visible on-chain."

---

## 2:30 – 3:00 — Privacy Demo & Close

> _On screen: navigate to portfolio, show encrypted position, then reveal via permit_

**Narrator:** "Back in the portfolio, my position shows as encrypted. To prove I'm the owner, I request a signed permit — and only then can I decrypt and see my balance.

This is the power of FHE for DeFi: **private positions, selective disclosure, and programmable encryption** — without trusted hardware or off-chain computation.

FheForge is built for Track 1 — RWA & Compliance — enabling private credit scores, confidential real-world asset ownership, and selective auditor disclosure.

Check out the repo at github.com/symulacr/FheForge. Thanks for watching!"

---

## Recording Tips

- Record at 1440×900 to match README screenshots
- Use a clean browser profile with no bookmarks bars
- Pre-fund the demo wallet with test ETH and a small position
- Speak clearly, ~150 words per minute
- Add captions via YouTube Studio after uploading
- Set video to **unlisted** and add link to README
