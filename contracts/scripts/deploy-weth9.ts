import { ethers } from "hardhat";

const POOL = "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Deploy WETH9
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth = await WETH9.deploy();
  await weth.waitForDeployment();
  const wethAddr = await weth.getAddress();
  console.log("WETH9 deployed:", wethAddr);

  // Set Pool.weth to the new WETH9
  const pool = await ethers.getContractAt("LendingPool", POOL, deployer);
  const oldWeth = await pool.weth();
  console.log("Old weth:", oldWeth);
  
  const tx = await pool.setWeth(wethAddr);
  await tx.wait();
  console.log("Pool.setWeth:", tx.hash);
  
  const newWeth = await pool.weth();
  console.log("New weth:", newWeth);

  // Fund deployer with some WETH via deposit
  const depositTx = await weth.deposit({ value: ethers.parseEther("0.1") });
  await depositTx.wait();
  console.log("WETH deposit:", depositTx.hash);
  console.log("WETH balance:", ethers.formatEther(await weth.balanceOf(deployer.address)));
}

main().catch(console.error);
