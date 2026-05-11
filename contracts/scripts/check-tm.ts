import { ethers } from "hardhat";
async function main() {
  const [deployer] = await ethers.getSigners();
  const TM = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";
  
  // Read TaskManager storage slots to find the verifier key
  // The TaskManager is behind a proxy — read the implementation
  const implSlot = await ethers.provider.getStorage(TM, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  const implAddr = ethers.getAddress("0x" + implSlot.slice(-40));
  console.log("TaskManager implementation:", implAddr);
  
  // Check if there's a verifierKey storage slot
  // Common storage patterns for OZ-based contracts
  for (const [name, slot] of [
    ["owner", 0],
    ["verifierKey", 1],
    ["verifier", 2],
    ["zkVerifier", 3],
    ["signer", 4],
    ["cofheSigner", 5],
  ] as [string, number][]) {
    const val = await ethers.provider.getStorage(TM, slot);
    if (val !== ethers.ZeroHash) {
      try {
        const addr = ethers.getAddress("0x" + val.slice(-40));
        console.log(`  Slot ${slot} (${name}): ${addr}`);
      } catch {
        console.log(`  Slot ${slot} (${name}): ${val.slice(0, 34)}…`);
      }
    }
  }
  
  // Try reading the verifier key from the implementation too
  console.log("\nImplementation storage:");
  for (const [name, slot] of [
    ["owner", 0],
    ["verifierKey", 1],
    ["verifier", 2],
    ["zkVerifier", 3],
    ["signer", 4],
  ] as [string, number][]) {
    const val = await ethers.provider.getStorage(implAddr, slot);
    if (val !== ethers.ZeroHash) {
      try {
        const addr = ethers.getAddress("0x" + val.slice(-40));
        console.log(`  Slot ${slot} (${name}): ${addr}`);
      } catch {
        console.log(`  Slot ${slot} (${name}): ${val.slice(0, 34)}…`);
      }
    }
  }

  // Read the known addresses from the error
  console.log("\nKnown addresses from InvalidSigner error:");
  console.log("  0xd2973164745263e4847b19711e4c6f2942f7ad09 (recovered signer from Test C)");
  console.log("  0x013a19c3401b19c21390bf3f0bcdf9c01eaafe71 (expected signer from Test C)");
  console.log("  0xd67f6962e7a431d2ebf421ca45c2443897052848 (recovered signer from previous run)");
  console.log("  0x0000000000000000000000000000000000000000 (expected signer from previous run)");
  
  // Check which one has code
  for (const addr of [
    "0xd2973164745263e4847b19711e4c6f2942f7ad09",
    "0x013a19c3401b19c21390bf3f0bcdf9c01eaafe71",
    "0xd67f6962e7a431d2ebf421ca45c2443897052848",
  ]) {
    const code = await ethers.provider.getCode(addr);
    console.log(`  ${addr}: ${code === "0x" ? "NO CODE" : "HAS CODE (" + code.length + " chars)"}`);
  }
}

main().catch(console.error);
