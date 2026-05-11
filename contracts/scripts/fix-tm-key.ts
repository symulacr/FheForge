import { ethers } from "hardhat";

const TM = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  // Compute setVerifierSigner(address) selector
  const setVerifierSignerIface = new ethers.Interface(["function setVerifierSigner(address)"]);
  const sel = setVerifierSignerIface.getFunction("setVerifierSigner")!.selector;
  console.log("setVerifierSigner(address) selector:", sel);
  
  // Get the SDK mock ZK verifier signer
  // This is the MOCK address used in local testing, NOT the real one
  // The real ZK verifier signer on arb-sepolia is whatever the SDK uses
  try {
    const sdk = require("@cofhe/sdk");
    console.log("SDK MOCKS_ZK_VERIFIER_SIGNER_ADDRESS:", sdk.MOCKS_ZK_VERIFIER_SIGNER_ADDRESS);
    console.log("SDK TASK_MANAGER_ADDRESS:", sdk.TASK_MANAGER_ADDRESS);
  } catch (e: unknown) {
    console.log("SDK import failed:", (e as Error).message?.slice(0, 80));
  }
  
  // Read the current signer key
  const signerSel = "0xa13ba967"; // from our earlier inspection
  const currentSigner = await ethers.provider.call({ to: TM, data: signerSel });
  const currentSignerAddr = ethers.getAddress("0x" + currentSigner.slice(-40));
  console.log(`\nCurrent signer (slot 4 / 0xa13ba967): ${currentSignerAddr}`);
  
  // Try setVerifierSigner with the deployer — see what error we get
  console.log(`\nAttempting setVerifierSigner on TM...`);
  console.log(`  Our deployer: ${deployer.address}`);
  console.log(`  TM owner: 0x6578D0E3A6d902896415c51cf4188fFBEBE753DB`);
  
  try {
    const newKey = "0xd2973164745263e4847b19711e4c6f2942f7ad09";
    const calldata = sel + newKey.slice(2).padStart(64, "0");
    const tx = await deployer.sendTransaction({ to: TM, data: calldata });
    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Receipt: status=${receipt?.status}`);
  } catch (e: unknown) {
    const err = e as { data?: string; shortMessage?: string; message?: string };
    console.log(`  Failed: ${err?.data?.slice(0, 74) || err?.shortMessage || err?.message?.slice(0, 120)}`);
  }
  
  // Now try to find the Fhenix Discord/Telegram contact info from the SDK
  console.log("\n=== NEXT STEPS ===");
  console.log("We cannot update the TaskManager signer key ourselves.");
  console.log("TM owner = 0x6578D0E3A6d902896415c51cf4188fFBEBE753DB (Fhenix team)");
  console.log("");
  console.log("REQUIRED: Contact Fhenix team to update arb-sepolia TaskManager");
  console.log(`  setVerifierSigner(<contract-account signing key>)`);
  console.log(`  Current signer: ${currentSignerAddr} (only works for EOA/wallet setAccount)`);
  console.log(`  New key needed: the signing key used when setAccount targets a contract`);
  console.log(`  The new key varies per call but is always different from ${currentSignerAddr}`);
  console.log("");
  console.log("OR: Fhenix could add BOTH keys as valid signers (multi-signer support)");
}

main().catch(console.error);
