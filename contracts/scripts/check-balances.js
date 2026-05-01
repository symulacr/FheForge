const hre = require("hardhat");

async function main() {
  const provider = hre.ethers.provider;
  const network = await provider.getNetwork();
  const deployer = process.env.DEPLOYER_ADDRESS;
  const tester = process.env.TESTER_ADDRESS;

  // Arbitrum Sepolia native USDC (Circle)
  const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];
  const usdc = new hre.ethers.Contract(USDC, erc20Abi, provider);

  console.log(`\n=== BALANCE CHECK on ${network.name} (chain ${network.chainId}) ===\n`);

  for (const [label, addr] of [["DEPLOYER", deployer], ["TESTER", tester]]) {
    const eth = await provider.getBalance(addr);
    let usdcBal = 0n;
    let usdcDec = 6;
    let usdcSym = "USDC";
    try {
      [usdcBal, usdcDec, usdcSym] = await Promise.all([
        usdc.balanceOf(addr),
        usdc.decimals(),
        usdc.symbol(),
      ]);
    } catch (e) {
      console.log(`  (USDC contract not reachable: ${e.message})`);
    }
    console.log(`${label.padEnd(8)} ${addr}`);
    console.log(`  ETH:  ${hre.ethers.formatEther(eth)}`);
    console.log(`  ${usdcSym}: ${hre.ethers.formatUnits(usdcBal, usdcDec)}`);
    console.log();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
