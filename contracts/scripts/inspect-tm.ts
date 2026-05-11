import { ethers } from "hardhat";

const TM = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  // Get the implementation address
  const implSlot = await ethers.provider.getStorage(TM, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  const implAddr = ethers.getAddress("0x" + implSlot.slice(-40));
  console.log("TaskManager implementation:", implAddr);
  
  // Get implementation code to extract function selectors
  const implCode = await ethers.provider.getCode(implAddr);
  console.log(`Implementation code length: ${implCode.length} chars`);
  
  // Try to get the proxy code too
  const proxyCode = await ethers.provider.getCode(TM);
  console.log(`Proxy code length: ${proxyCode.length} chars`);
  
  // Read storage slots 0-20
  console.log("\n=== TaskManager Storage (slots 0-30) ===");
  for (let i = 0; i <= 30; i++) {
    const val = await ethers.provider.getStorage(TM, i);
    if (val !== ethers.ZeroHash) {
      try {
        const addr = ethers.getAddress("0x" + val.slice(-40));
        console.log(`  Slot ${i}: ${addr} (address)`);
      } catch {
        const num = BigInt(val);
        if (num > 0n && num < 1000000000n) {
          console.log(`  Slot ${i}: ${num} (small number)`);
        } else {
          console.log(`  Slot ${i}: ${val.slice(0, 26)}…`);
        }
      }
    }
  }
  
  // Try calling known functions on the TaskManager
  // Common TaskManager functions from CoFHE
  const tmSigner = await ethers.getContractAt([], TM, deployer);
  
  // Try function selectors
  const selectors: Record<string, string> = {
    "0x5c975abb": "paused()",
    "0x8da5cb5b": "owner()",
    "0x715018a6": "renounceOwnership()",
    "0xf2fde38b": "transferOwnership(address)",
    "0x485cc955": "setImplementation(address)",
    // TaskManager-specific
    "0x8f283970": "verifierKey()",
    "0x2b7ac3f3": "setVerifierKey(address)",
    "0x0a630ded": "setVerifier(address)",
    "0xfc715433": "zkVerifier()",
  };
  
  console.log("\n=== Trying Function Selectors ===");
  for (const [sel, name] of Object.entries(selectors)) {
    try {
      const result = await ethers.provider.call({ to: TM, data: sel });
      if (result !== "0x") {
        try {
          const addr = ethers.getAddress("0x" + result.slice(-40));
          console.log(`  ${name}: ${addr}`);
        } catch {
          console.log(`  ${name}: ${result.slice(0, 26)}`);
        }
      }
    } catch (e: unknown) {
      const msg = (e as Error).message?.slice(0, 60) || "";
      if (!msg.includes("revert") && !msg.includes("missing")) {
        console.log(`  ${name}: error - ${msg}`);
      }
    }
  }
  
  // Try owner() on the implementation too
  console.log("\n=== Implementation Owner ===");
  try {
    const owner = await ethers.provider.call({ to: implAddr, data: "0x8da5cb5b" });
    console.log(`  owner(): ${ethers.getAddress("0x" + owner.slice(-40))}`);
  } catch (e: unknown) {
    console.log(`  owner() failed: ${(e as Error).message?.slice(0, 60)}`);
  }
  
  // Check who the proxy admin is (ERC1967 admin slot)
  const adminSlot = await ethers.provider.getStorage(TM, "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103");
  if (adminSlot !== ethers.ZeroHash) {
    const adminAddr = ethers.getAddress("0x" + adminSlot.slice(-40));
    console.log(`\nProxy admin: ${adminAddr}`);
    const adminCode = await ethers.provider.getCode(adminAddr);
    console.log(`Proxy admin has code: ${adminCode !== "0x"}`);
  }
}

main().catch(console.error);
