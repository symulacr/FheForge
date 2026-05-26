import { ethers } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";

describe("Fuzz Edge Cases (MC-072)", () => {
  async function deployMinimal() {
    await hre.cofhe.mocks.deployMocks();
    const [owner] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("StrategyRegistry");
    const registry = await Registry.deploy(48n * 3600n);
    await registry.waitForDeployment();

    const Vault = await ethers.getContractFactory("StrategyVault");
    const vault = await Vault.deploy(await registry.getAddress());
    await vault.waitForDeployment();

    await registry.setVault(await vault.getAddress());

    await registry.registerStrategy(
      "Test",
      ethers.zeroPadValue("0xbeef", 32),
    );

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Test", "TST", 18);
    await token.waitForDeployment();

    const Pyth = await ethers.getContractFactory("MockERC20");
    const pyth = await Pyth.deploy("Pyth", "PYTH", 18);
    await pyth.waitForDeployment();

    const Oracle = await ethers.getContractFactory("PriceOracle");
    const oracle = await Oracle.deploy(await pyth.getAddress(), 3600n);
    await oracle.waitForDeployment();

    const Pool = await ethers.getContractFactory("LendingPool");
    const pool = await Pool.deploy();
    await pool.waitForDeployment();

    await pool.setOracle(await oracle.getAddress());

    return { vault, pool, registry, token, oracle, owner };
  }

  describe("Boundary values", () => {
    it("reverts on zero-amount borrow when using oracle path", async () => {
      const { pool, token } = await deployMinimal();
      const [signer] = await ethers.getSigners();
      const client = await hre.cofhe.createClientWithBatteries(signer);
      const [encBorrow] = await client
        .encryptInputs([Encryptable.uint128(0n)])
        .execute();

      await expect(
        pool.borrowWithOracle(
          await token.getAddress(),
          await token.getAddress(),
          100n,               // non-zero collateral
          0n,                 // zero borrow → ZeroAmount
          encBorrow,
        ),
      ).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });

    it("reverts on zero-amount supply", async () => {
      const { pool, token } = await deployMinimal();

      await expect(
        pool.shield(await token.getAddress(), 0n, {
          ctHash: 0n,
          securityZone: 0,
          utype: 0,
          signature: "0x",
        }),
      ).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });
  });

  describe("ExecutorContract edge cases", () => {
    it("reverts executing intent with no approval", async () => {
      const [owner, executor] = await ethers.getSigners();
      await hre.cofhe.mocks.deployMocks();

      const Router = await ethers.getContractFactory("SwapRouter");
      const router = await Router.deploy(
        await executor.getAddress(),
        30n,
        7n * 24n * 3600n,
        48n * 3600n,
        ethers.ZeroAddress,
      );
      await router.waitForDeployment();

      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const tokenIn = await TokenFactory.deploy("TokenA", "TKA", 18);
      await tokenIn.waitForDeployment();
      const tokenOut = await TokenFactory.deploy("TokenB", "TKB", 18);
      await tokenOut.waitForDeployment();

      await tokenIn.mint(owner.address, ethers.parseEther("100"));
      await tokenIn.approve(await router.getAddress(), ethers.MaxUint256);
      const intentId = await router
        .connect(owner)
        .submitSwapIntent.staticCall(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          ethers.parseEther("10"),
          ethers.parseEther("5"),
          300n,
        );
      await router
        .connect(owner)
        .submitSwapIntent(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          ethers.parseEther("10"),
          ethers.parseEther("5"),
          300n,
        );

      // Executor attempts execute without token approval in router
      // This should revert because executor hasn't funded tokenOut
      await expect(
        router.connect(executor).executeIntent(intentId, ethers.parseEther("5")),
      ).to.be.reverted; // ERC20 transferFrom revert
    });
  });

  describe("Fuzzing patterns (manual edge cases)", () => {
    it("handles max uint128 deadline offset", async () => {
      const [, executor] = await ethers.getSigners();
      await hre.cofhe.mocks.deployMocks();

      const Router = await ethers.getContractFactory("SwapRouter");
      const router = await Router.deploy(
        await executor.getAddress(),
        1n,
        2n ** 128n - 1n, // max uint128
        48n * 3600n,
        ethers.ZeroAddress,
      );

      expect(await router.MAX_DEADLINE_OFFSET()).to.equal(
        2n ** 128n - 1n,
      );
    });

    it("handles roundtrip through zero amounts in constructor validation", async () => {
      const [owner] = await ethers.getSigners();
      await hre.cofhe.mocks.deployMocks();

      const Registry = await ethers.getContractFactory("StrategyRegistry");
      const registry = await Registry.deploy(48n * 3600n);
      await registry.waitForDeployment();
      await expect(
        registry.registerStrategy("", ethers.ZeroHash),
      ).to.be.revertedWithCustomError(registry, "EmptyName");
    });
  });
});
