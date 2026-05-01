declare module "hardhat" {
  export const ethers: any;
  export const artifacts: any;
  export const cofhe: any;
}

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    cofhe: any;
  }
}
