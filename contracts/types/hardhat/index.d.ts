import type { Artifacts, Network, RunTaskFunction } from 'hardhat/types';

declare module 'hardhat' {
  /** ethers is augmented by @nomicfoundation/hardhat-ethers (provider, getSigners, etc.) */
  export const ethers: typeof import('ethers');
  export const artifacts: Artifacts;
  export const network: Network;
  export const run: RunTaskFunction;
  export const cofhe: unknown;
}

declare module 'hardhat/types/runtime' {
  interface HardhatRuntimeEnvironment {
    cofhe: unknown;
  }
}
