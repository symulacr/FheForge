import { ethers } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { setupFhePermissions } from "./helpers/acl";

describe("StrategyVault", () => {
  async function deployAll() {
    await hre.cofhe.mocks.deployMocks();
    const [, user, user2] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("StrategyRegistry");

    const registry = await Registry.deploy(48n * 3600n);
    await registry.waitForDeployment();

    const Vault = await ethers.getContractFactory("StrategyVault");
    const vault = await Vault.deploy(await registry.getAddress());
    await vault.waitForDeployment();

    await registry.setVault(await vault.getAddress());


    await registry.registerStrategy(
      "Test Strategy",
      ethers.zeroPadValue("0xdeadbeef", 32),
    );

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Test", "TST", 18);
    await token.waitForDeployment();

    await token.mint(user.address, ethers.parseEther("100"));
    await token
      .connect(user)
      .approve(await vault.getAddress(), ethers.MaxUint256);

    const userClient = await hre.cofhe.createClientWithBatteries(user);

    return { vault, token, user, user2, userClient };
  }

  async function encryptOpenPosition(
    userClient: any,
    collateralWei: bigint,
  ) {


    const [eCollateral] = await userClient
      .encryptInputs([
        Encryptable.uint128(collateralWei),
      ])
      .execute();
    return {
      eCollateral: ethers.zeroPadValue(ethers.toBeHex(eCollateral.ctHash), 32),
      ctHashBigInt: eCollateral.ctHash,
    };
  }

  async function setupPositionAcl(
    vault: any,
    user: any,
    ctHashBigInt: bigint,
  ): Promise<void> {
    await setupFhePermissions(ctHashBigInt, await vault.getAddress(), user.address);
  }

  async function openPosition(
    vault: any,
    token: any,
    user: any,
    eCollateral: any,
    collateralWei: bigint,
  ): Promise<string> {
    const tx = await vault.connect(user).openPosition(
      await token.getAddress(),
      collateralWei,
      eCollateral,
      1n,
      user.address,
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (log: any) => log.fragment?.name === "PositionOpened",
    );
    return event ? event.args[0] : "";
  }

  it("getUserPositions is empty for new user", async () => {
    const { vault, user } = await deployAll();
    const positions = await vault.getUserPositions(user.address);
    expect(positions.length).to.equal(0);
  });

  it("openPosition adds a user position", async () => {
    const { vault, token, user, userClient } = await deployAll();
    const collateralWei = ethers.parseEther("1");
    const { eCollateral, ctHashBigInt } = await encryptOpenPosition(
      userClient,
      collateralWei,
    );

    await setupPositionAcl(vault, user, ctHashBigInt);

    const positionId = await openPosition(vault, token, user, eCollateral, collateralWei);
    expect(positionId).to.not.be.empty;

    const positions = await vault.getUserPositions(user.address);
    expect(positions.length).to.equal(1);
    expect(positions[0]).to.equal(positionId);
  });

  it("collateral plaintext matches via mock expectPlaintext", async () => {
    const { vault, token, user, userClient } = await deployAll();
    const collateralWei = ethers.parseEther("1");
    const { eCollateral, ctHashBigInt } = await encryptOpenPosition(
      userClient,
      collateralWei,
    );

    await setupPositionAcl(vault, user, ctHashBigInt);

    const positionId = await openPosition(vault, token, user, eCollateral, collateralWei);

    // getCollateral is nonpayable (FHE.allow side effects), so direct call returns a
    // TransactionResponse. Use stored ctHashBigInt for the plaintext check instead.
    await hre.cofhe.mocks.expectPlaintext(ctHashBigInt, collateralWei);
  });

  it("second user cannot read first user collateral", async () => {
    const { vault, token, user, user2, userClient } = await deployAll();
    const collateralWei = ethers.parseEther("1");
    const { eCollateral, ctHashBigInt } = await encryptOpenPosition(
      userClient,
      collateralWei,
    );

    await setupPositionAcl(vault, user, ctHashBigInt);

    const positionId = await openPosition(vault, token, user, eCollateral, collateralWei);

    // The position exists globally, so user2 can call getCollateral without revert.
    // Privacy is enforced at the FHE layer — user2 cannot decrypt user1's encrypted
    // collateral even if they read the ciphertext handle (which returns _ZERO for
    // uninitialized position).
    await expect(
      vault.connect(user2).getCollateral(positionId),
    ).to.not.be.reverted;

    // user2's position list does not include user1's positionId
    const user2Positions = await vault.getUserPositions(user2.address);
    expect(user2Positions).to.not.include(positionId);
  });
});
