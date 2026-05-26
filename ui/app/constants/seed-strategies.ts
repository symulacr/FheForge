export const SEED_STRATEGIES = [
  {
    id: "seed-1",
    title: "WETH Loop x3",
    strategistName: "FheForge",
    strategistHandle: "@fheforge",
    apy: 18.5,
    tags: ["FHE", "WETH", "Loop"],
    assets: ["WETH"],
    chains: ["Arbitrum Sepolia"],
    agents: [],
    context: "CoFHE",
    description:
      "Supply WETH, borrow at 75% LTV, loop 3x. All amounts encrypted.",
  },
  {
    id: "seed-2",
    title: "USDC Yield",
    strategistName: "FheForge",
    strategistHandle: "@fheforge",
    apy: 8.2,
    tags: ["FHE", "USDC", "Lending"],
    assets: ["USDC"],
    chains: ["Arbitrum Sepolia"],
    agents: [],
    context: "CoFHE",
    description:
      "Supply USDC to lending pool. Encrypted balance, private yield.",
  },
  {
    id: "seed-3",
    title: "WETH → USDC Swap",
    strategistName: "FheForge",
    strategistHandle: "@fheforge",
    apy: 5.0,
    tags: ["FHE", "Swap", "Privacy"],
    assets: ["WETH", "USDC"],
    chains: ["Arbitrum Sepolia"],
    agents: [],
    context: "CoFHE",
    description:
      "Submit encrypted swap intent. Amount invisible until execution.",
  },
];
