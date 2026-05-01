const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(signer.address);
  const network = await hre.ethers.provider.getNetwork();

  console.log(`\n=== Wallet Balance Check ===`);
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Wallet Address: ${signer.address}`);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH`);
  console.log(`============================\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
