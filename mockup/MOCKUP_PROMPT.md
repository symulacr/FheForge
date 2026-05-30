Design a completely new frontend mockup for **FheForge** — an encrypted DeFi protocol on Arbitrum Sepolia using Fhenix CoFHE (fully homomorphic encryption). 12 deployed contracts handle encrypted lending, strategy vaults, swaps, and governance.

**Do NOT look at the current frontend.** Read the contracts and backend API docs to understand the *business logic*, then invent your own visual language, tech stack, layout, colors, and animations.

**Business model:** Users connect their wallet (MetaMask/Arb Sepolia) → deposit encrypted collateral → borrow encrypted amounts → build multi-step strategies (supply→borrow→swap→rebalance) via a visual builder → deploy strategies on-chain. Everything stays encrypted. Only the user can decrypt via permit.

**Key pages to mockup (desktop + mobile + interactive prototype):**
1. **Dashboard** — portfolio overview showing encrypted balances, wallet status, FHE permit health, active strategies, market data (TVL, APY, liquidation prices)
2. **Strategy Builder** — visual canvas where users compose DeFi steps (supply, borrow, swap) into pipelines. Encrypted step nodes show locked/unlocked states. Drag, connect, configure.
3. **Strategy Market** — browse community/featured strategies. Filter by risk, APY, chain. Simulate before deploying.
4. **Lending Hub** — supply/borrow interface with real-time LTV gauge, encrypted amount input, liquidation warnings
5. **Governance** — proposal list, vote, delegate (if applicable)

**Design freedom:** Choose any aesthetic — dark-tech, industrial, clean-minimal, cyberpunk, brutalist. Pick your own color palette. Your own typography. Your own animation language. Justify your choices.

**Deliver:** A clickable interactive prototype (Figma, Framer, Web-based, or any tool) showing the full user flow: connect → deposit → build → deploy → monitor. Prototype must work on desktop AND mobile.

**Tech:** Any stack you prefer. No constraints. Show what you'd build with.
