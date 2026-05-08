import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Deploy 3 fresh MockERC20 tokens for wave 9 testing
  const Mock = await ethers.getContractFactory("MockERC20");
  const addresses: string[] = [];

  for (const sym of ["USDC","WETH","MCK"]) {
    const t = await Mock.deploy();
    await t.waitForDeployment();
    const addr = await t.getAddress();
    addresses.push(addr);
    console.log(`MockERC20-${sym}: ${addr}`);
  }

  console.log(`\nNEXT_PUBLIC_TOKEN_USDC=${addresses[0]}`);
  console.log(`NEXT_PUBLIC_TOKEN_WETH=${addresses[1]}`);
  console.log(`NEXT_PUBLIC_TOKEN_MCK=${addresses[2]}`);
}

main().catch(e=>{console.error(e);process.exit(1)});
