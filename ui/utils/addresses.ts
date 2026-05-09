import type { Address } from "viem";

export const TOKEN_SYMBOL_MAP: Record<
  string,
  { address: string; decimals: number }
> = {
  WETH: { address: process.env.NEXT_PUBLIC_TOKEN_WETH!, decimals: 18 },
  USDC: { address: process.env.NEXT_PUBLIC_TOKEN_USDC!, decimals: 6 },
  USDT: { address: process.env.NEXT_PUBLIC_TOKEN_USDT ?? "", decimals: 6 },
};
export interface ContractAddresses {
  vault: Address;
  pool: Address;
  router: Address;
  registry: Address;
  composer: Address;
  swapRouter: Address;
  oracle: Address;
}

export const FHENIX_CONTRACT_ADDRESSES: ContractAddresses = {
  vault: process.env.NEXT_PUBLIC_VAULT_ADDRESS! as Address,
  pool: process.env.NEXT_PUBLIC_POOL_ADDRESS! as Address,
  router: process.env.NEXT_PUBLIC_ROUTER_ADDRESS! as Address,
  registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS! as Address,
  composer: process.env.NEXT_PUBLIC_COMPOSER_ADDRESS! as Address,
  swapRouter: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS! as Address,
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS! as Address,
};
export const CHAIN_CONTRACT_ADDRESSES: Record<
  number,
  ContractAddresses
> = {
  421614: FHENIX_CONTRACT_ADDRESSES,
  84532: {
    vault: process.env.NEXT_PUBLIC_BASE_VAULT_ADDRESS! as Address,
    pool: process.env.NEXT_PUBLIC_BASE_POOL_ADDRESS! as Address,
    router: process.env.NEXT_PUBLIC_BASE_ROUTER_ADDRESS! as Address,
    registry: process.env.NEXT_PUBLIC_BASE_REGISTRY_ADDRESS! as Address,
    composer: process.env.NEXT_PUBLIC_COMPOSER_ADDRESS! as Address,
    swapRouter: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS! as Address,
    oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS! as Address,
  },
};
export const getContractAddresses = (chainId: number) => {
  const addrs = CHAIN_CONTRACT_ADDRESSES[chainId];
  if (!addrs)
    throw new Error(
      `No FheForge contracts configured for chainId ${chainId}. Supported: 421614 (arb-sepolia), 84532 (base-sepolia).`,
    );
  return addrs;
};
export const validateEuint128 = (v: bigint) => {
  if (v < 0n || v > 2n ** 128n - 1n)
    throw new Error(`Amount ${v} exceeds euint128 range`);
};

export const validateEnvVars = () => {
  const required = [
    "NEXT_PUBLIC_VAULT_ADDRESS",
    "NEXT_PUBLIC_POOL_ADDRESS",
    "NEXT_PUBLIC_ROUTER_ADDRESS",
    "NEXT_PUBLIC_REGISTRY_ADDRESS",
    "NEXT_PUBLIC_COMPOSER_ADDRESS",
    "NEXT_PUBLIC_SWAP_ROUTER_ADDRESS",
    "NEXT_PUBLIC_ORACLE_ADDRESS",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`[FheForge] Missing env vars: ${missing.join(", ")}`);
  }
};
