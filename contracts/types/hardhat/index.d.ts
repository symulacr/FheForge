import type { Artifacts, Network, RunTaskFunction } from "hardhat/types";

declare module "hardhat" {
  /** ethers is augmented by @nomicfoundation/hardhat-ethers (provider, getSigners, etc.) */
  export const ethers: any;
  export const artifacts: Artifacts;
  export const network: Network;
  export const run: RunTaskFunction;
  export const cofhe: any;
}

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    cofhe: any;
  }
}
