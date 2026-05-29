import { ethers } from "hardhat";
import hre from "hardhat";
import { TASK_MANAGER_ADDRESS } from "@cofhe/sdk";

/**
 * Grant persistent ACL on a ciphertext handle for a contract and user.
 *
 * In production, the real CoFHE coprocessor calls verifyInput which sets
 * transient ACL automatically. In the mock environment, MockZkVerifier
 * stores encrypted inputs without setting ACL on the TaskManager, so we
 * need to impersonate the TaskManager and set permissions manually.
 *
 * @param ctHashBigInt - The ciphertext hash to grant permission on.
 * @param contractAddress - The contract that needs access (e.g. vault).
 * @param userAddress - The user that needs decryption access.
 */
export async function setupFhePermissions(
  ctHashBigInt: bigint,
  contractAddress: string,
  userAddress: string,
): Promise<void> {
  const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";

  if (isLocal) {
    const taskManager = await hre.cofhe.mocks.getMockTaskManager();
    const aclAddress = await taskManager.acl();
    const acl = await ethers.getContractAt("MockACL", aclAddress);

    await hre.network.provider.send("hardhat_setBalance", [
      TASK_MANAGER_ADDRESS,
      "0x" + ethers.parseEther("1").toString(16),
    ]);
    await hre.network.provider.send("hardhat_impersonateAccount", [
      TASK_MANAGER_ADDRESS,
    ]);
    const tmSigner = await ethers.getSigner(TASK_MANAGER_ADDRESS);

    // Disable auto-mining so both calls land in the same block.
    // Then allow uses that transient to set persistent permission for contract and user.
    await hre.network.provider.send("evm_setAutomine", [false]);

    await acl
      .connect(tmSigner)
      .allowTransient(ctHashBigInt, TASK_MANAGER_ADDRESS, TASK_MANAGER_ADDRESS);
    await acl
      .connect(tmSigner)
      .allow(ctHashBigInt, contractAddress, TASK_MANAGER_ADDRESS);
    await acl
      .connect(tmSigner)
      .allow(ctHashBigInt, userAddress, TASK_MANAGER_ADDRESS);

    await hre.network.provider.send("evm_mine");
    await hre.network.provider.send("evm_setAutomine", [true]);

    await hre.network.provider.send("hardhat_stopImpersonatingAccount", [
      TASK_MANAGER_ADDRESS,
    ]);
  } else {
    // REAL ON-CHAIN FALLBACK: direct allowance transaction from user wallet on live network
    const [userSigner] = await ethers.getSigners();
    const taskManager = await ethers.getContractAt("ITaskManager", TASK_MANAGER_ADDRESS, userSigner);

    // Explicitly grant the target contract permission on the real TaskManager
    const tx = await taskManager.allow(ctHashBigInt, contractAddress);
    await tx.wait();
  }
}
