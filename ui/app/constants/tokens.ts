export const TOKENS = [
  {
    symbol: "WETH",
    address: process.env.NEXT_PUBLIC_TOKEN_WETH ?? "",
    decimals: 18,
  },
  {
    symbol: "USDC",
    address: process.env.NEXT_PUBLIC_TOKEN_USDC ?? "",
    decimals: 6,
  },
  {
    symbol: "USDT",
    address: process.env.NEXT_PUBLIC_TOKEN_USDT ?? "",
    decimals: 6,
  },
];
