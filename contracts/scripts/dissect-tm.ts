import { ethers } from "hardhat";

const TM = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

async function main() {
  const [deployer] = await ethers.getSigners();
  const implSlot = await ethers.provider.getStorage(TM, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  const implAddr = ethers.getAddress("0x" + implSlot.slice(-40));
  
  // Get implementation bytecode and extract all 4-byte selectors
  const implCode = await ethers.provider.getCode(implAddr);
  console.log("Implementation:", implAddr);
  
  // Extract all PUSH4 + follow-up patterns to find selectors
  // PUSH4 = 0x63, followed by 4 bytes, then usually EQ or CALL
  const selectors = new Set<string>();
  for (let i = 0; i < implCode.length - 10; i += 2) {
    // Look for PUSH4 (0x63) followed by 4 bytes then EQ (0x14) or other comparison
    if (implCode.slice(i, i+2) === '63') {
      const sel = implCode.slice(i+2, i+10);
      // Check if followed by something useful (EQ, DUP, etc)
      const next2 = implCode.slice(i+10, i+12);
      if (['14', '15', '80', '81', '82', '83', '84', '85'].includes(next2)) {
        selectors.add('0x' + sel);
      }
    }
  }
  
  console.log(`\nFound ${selectors.size} potential selectors in implementation`);
  
  // Try each selector as a view call
  const known: Record<string, string> = {
    "0x5c975abb": "paused()",
    "0x8da5cb5b": "owner()",
    "0x5a90af44": "ACL()",
    "0xf4f1dcfb": "taskManager()",
  };
  
  // Try calling each selector
  const results: string[] = [];
  for (const sel of selectors) {
    try {
      const result = await ethers.provider.call({ to: TM, data: sel });
      if (result !== "0x" && result !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        const name = known[sel] || "unknown";
        let decoded = result;
        try {
          decoded = ethers.getAddress("0x" + result.slice(-40));
        } catch {}
        results.push(`  ${sel} (${name}): ${decoded}`);
      }
    } catch {}
  }
  
  console.log("\n=== Non-zero view results ===");
  results.forEach(r => console.log(r));
  
  // Now try all known CoFHE TaskManager selectors
  console.log("\n=== Known CoFHE TaskManager selectors ===");
  const tmSelectors: Record<string, string> = {
    "0x5c975abb": "paused()",
    "0x8da5cb5b": "owner()",
    "0x715018a6": "renounceOwnership()",
    "0xf2fde38b": "transferOwnership(address)",
    "0x485cc955": "setImplementation(address)",
    // Possible verifier key setters
    "0xc4d66d68": "setVerifierKey(address)", // common pattern
    "0x0a630ded": "setVerifier(address)",
    "0xfc715433": "zkVerifier()",
    "0x8f283970": "verifierKey()",
    "0x2b7ac3f3": "setVerifierKey(address)",
    "0x5c60daab": "verifier()",
    "0x7c423f": "setSigner(address)",
    "0x2964b0a0": "signer()",
    "0x4e71e0c8": "upgradeTo(address)",
    "0x3659cfe6": "upgradeToAndCall(address,bytes)",
    "0x4f1ef286": "upgradeToAndCall(address,bytes)",
    "0x5f3b2733": "proxiableUUID()",
    "0x1f3ce821": "taskCount()",
    "0x5a90af44": "ACL()",
    "0xf4f1dcfb": "taskManager()",
    "0xb1d tournament": "coProcessor()",
    "0x41f2965e": "coProcessor()",
  };
  
  for (const [sel, name] of Object.entries(tmSelectors)) {
    try {
      const result = await ethers.provider.call({ to: TM, data: sel });
      if (result !== "0x") {
        try {
          const addr = ethers.getAddress("0x" + result.slice(-40));
          console.log(`  ${name}: ${addr}`);
        } catch {
          const num = BigInt(result);
          console.log(`  ${name}: ${num < 1000000n ? num : result.slice(0, 26) + "…"}`);
        }
      }
    } catch (e: unknown) {
      // Silent
    }
  }
  
  // Try writing: attempt setVerifierKey with the correct new key
  // First, get the actual signing key from SDK
  console.log("\n=== Owner check ===");
  const owner = await ethers.provider.call({ to: TM, data: "0x8da5cb5b" });
  const ownerAddr = ethers.getAddress("0x" + owner.slice(-40));
  console.log(`  TM owner: ${ownerAddr}`);
  console.log(`  Our deployer: ${deployer.address}`);
  console.log(`  Match: ${ownerAddr.toLowerCase() === deployer.address.toLowerCase()}`);
  
  // Check proxy admin
  const adminSlot = await ethers.provider.getStorage(TM, "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103");
  if (adminSlot !== ethers.ZeroHash) {
    console.log(`  Proxy admin: ${ethers.getAddress("0x" + adminSlot.slice(-40))}`);
  }
  
  // Check UUPS admin
  console.log("\n=== Checking if deployer can call admin functions ===");
  // Try calling setVerifierKey even if we're not owner — see the error
  try {
    // setVerifierKey(address) = selector varies, try a few
    // Common: setVerifierKey(address) 
    for (const sel of ["0xc4d66d68", "0x2b7ac3f3", "0x0a630ded"]) {
      try {
        const newKey = "0x000000000000000000000000d2973164745263e4847b19711e4c6f2942f7ad09";
        const tx = await deployer.sendTransaction({ to: TM, data: sel + newKey.slice(2) });
        console.log(`  ${sel} sent tx: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`  ${sel} receipt: ${receipt?.status}`);
      } catch (e: unknown) {
        const msg = (e as Error).message?.slice(0, 120) || "";
        console.log(`  ${sel}: ${msg.slice(0, 100)}`);
      }
    }
  } catch {}
}

main().catch(console.error);
