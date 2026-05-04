import { ethers } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";

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
    const token = await Token.deploy();
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
    debtWei: bigint,
  ) {


    const [eCollateral, eDebt] = await userClient
      .encryptInputs([
        Encryptable.uint128(collateralWei),
        Encryptable.uint128(debtWei),
      ])
      .execute();
    return { eCollateral, eDebt };
  }

  it("hasPosition is false for new user", async () => {
    const { vault, user } = await deployAll();
    expect(await vault.hasPosition(user.address)).to.equal(false);
  });

  it("openPosition sets hasPosition to true", async () => {
    const { vault, token, user, userClient } = await deployAll();
    const collateralWei = ethers.parseEther("1");
    const { eCollateral, eDebt } = await encryptOpenPosition(
      userClient,
      collateralWei,
      ethers.parseEther("0.5"),
    );

    await vault
      .connect(user)
      .openPosition(await token.getAddress(), collateralWei, eCollateral, eDebt, 1);

    expect(await vault.hasPosition(user.address)).to.equal(true);
  });

  it("collateral plaintext matches via mock expectPlaintext", async () => {
    const { vault, token, user, userClient } = await deployAll();
    const collateralWei = ethers.parseEther("1");
    const { eCollateral, eDebt } = await encryptOpenPosition(
      userClient,
      collateralWei,
      ethers.parseEther("0.5"),
    );

    await vault
      .connect(user)
      .openPosition(await token.getAddress(), collateralWei, eCollateral, eDebt, 1);

    const ctHash = await vault.connect(user).getCollateral.staticCall();
    await hre.cofhe.mocks.expectPlaintext(BigInt(ctHash), collateralWei);
  });

  it("second user cannot read first user collateral", async () => {
    const { vault, token, user, user2, userClient } = await deployAll();
    const collateralWei = ethers.parseEther("1");
    const { eCollateral, eDebt } = await encryptOpenPosition(
      userClient,
      collateralWei,
      ethers.parseEther("0.5"),
    );

    await vault
      .connect(user)
      .openPosition(await token.getAddress(), collateralWei, eCollateral, eDebt, 1);

    await expect(
      vault.connect(user2).getCollateral.staticCall(),
    ).to.be.revertedWithCustomError(vault, "NoPosition");
  });
});
