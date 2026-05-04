




const hre = require("hardhat");

async function main() {
  const provider = hre.ethers.provider;
  const [deployer] = await hre.ethers.getSigners();
  const testerAddress = process.env.TESTER_ADDRESS;
  if (!testerAddress) throw new Error("TESTER_ADDRESS env var missing");

  const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ];
  const usdc = new hre.ethers.Contract(USDC, erc20Abi, deployer);

  const ethBefore = await provider.getBalance(deployer.address);
  const usdcBefore = await usdc.balanceOf(deployer.address);
  const decimals = await usdc.decimals();

  console.log(`\n=== FUND TESTER from ${deployer.address} ===`);
  console.log(`Deployer ETH:  ${hre.ethers.formatEther(ethBefore)}`);
  console.log(`Deployer USDC: ${hre.ethers.formatUnits(usdcBefore, decimals)}`);
  console.log(`Tester:        ${testerAddress}\n`);


  if (usdcBefore > 0n) {
    console.log(`→ Sending ${hre.ethers.formatUnits(usdcBefore, decimals)} USDC to tester...`);
    const usdcTx = await usdc.transfer(testerAddress, usdcBefore);
    const rcpt = await usdcTx.wait();
    console.log(`  ✓ USDC transfer mined. Tx: ${usdcTx.hash}`);
    console.log(`    Block: ${rcpt.blockNumber} | Gas: ${rcpt.gasUsed.toString()}`);
  } else {
    console.log("→ Deployer has 0 USDC; skipping USDC transfer.");
  }


  const ethToSend = hre.ethers.parseEther("0.15");
  const ethBalNow = await provider.getBalance(deployer.address);
  if (ethBalNow > ethToSend + hre.ethers.parseEther("0.05")) {
    console.log(`\n→ Sending 0.15 ETH to tester...`);
    const ethTx = await deployer.sendTransaction({
      to: testerAddress,
      value: ethToSend,
    });
    const rcpt = await ethTx.wait();
    console.log(`  ✓ ETH transfer mined. Tx: ${ethTx.hash}`);
    console.log(`    Block: ${rcpt.blockNumber} | Gas: ${rcpt.gasUsed.toString()}`);
  } else {
    console.log("\n→ Insufficient deployer ETH (need >0.20 to maintain deploy buffer); skipping.");
  }


  const ethAfterDep = await provider.getBalance(deployer.address);
  const usdcAfterDep = await usdc.balanceOf(deployer.address);
  const ethAfterTest = await provider.getBalance(testerAddress);
  const usdcAfterTest = await usdc.balanceOf(testerAddress);

  console.log("\n=== FINAL BALANCES ===");
  console.log(`Deployer ${deployer.address}`);
  console.log(`  ETH:  ${hre.ethers.formatEther(ethAfterDep)}`);
  console.log(`  USDC: ${hre.ethers.formatUnits(usdcAfterDep, decimals)}`);
  console.log(`Tester   ${testerAddress}`);
  console.log(`  ETH:  ${hre.ethers.formatEther(ethAfterTest)}`);
  console.log(`  USDC: ${hre.ethers.formatUnits(usdcAfterTest, decimals)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
