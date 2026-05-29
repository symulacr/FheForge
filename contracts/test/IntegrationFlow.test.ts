import { Encryptable } from "@cofhe/sdk";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

describe("Integration: deposit → borrow → swap → repay → withdraw (MC-074)", () => {
	async function deployFullStack() {
		await hre.cofhe.mocks.deployMocks();

		const [owner, executor] = await ethers.getSigners();

		const ExecutorContractFactory = await ethers.getContractFactory("ExecutorContract");
		const execContractDeployed = await ExecutorContractFactory.deploy();
		await execContractDeployed.waitForDeployment();

		const Registry = await ethers.getContractFactory("StrategyRegistry");
		const registry = await Registry.deploy(48n * 3600n);
		await registry.waitForDeployment();

		const Vault = await ethers.getContractFactory("StrategyVault");
		const vault = await Vault.deploy(await registry.getAddress());
		await vault.waitForDeployment();

		const Pyth = await ethers.getContractFactory("MockERC20");
		const pyth = await Pyth.deploy("Pyth", "PYTH", 18);
		await pyth.waitForDeployment();

		const Oracle = await ethers.getContractFactory("PriceOracle");
		const oracle = await Oracle.deploy(await pyth.getAddress(), 3600n);
		await oracle.waitForDeployment();

		const Router = await ethers.getContractFactory("SwapRouter");
		const router = await Router.deploy(
			await execContractDeployed.getAddress(),
			30n,
			7n * 24n * 3600n,
			48n * 3600n,
			ethers.ZeroAddress,
		);
		await router.waitForDeployment();

		const Pool = await ethers.getContractFactory("LendingPool");
		const pool = await Pool.deploy();
		await pool.waitForDeployment();

		const Composer = await ethers.getContractFactory("FheForgeComposer");
		const composer = await Composer.deploy(
			await registry.getAddress(),
			await vault.getAddress(),
			await pool.getAddress(),
			await router.getAddress(),
		);
		await composer.waitForDeployment();

		await registry.setVault(await vault.getAddress());
		await pool.setComposer(await composer.getAddress());
		await pool.setOracle(await oracle.getAddress());

		const TokenFactory = await ethers.getContractFactory("MockERC20");
		const token = await TokenFactory.deploy("Collateral", "COL", 18);
		await token.waitForDeployment();
		const tokenB = await TokenFactory.deploy("TokenB", "TKB", 18);
		await tokenB.waitForDeployment();

		await registry.registerStrategy("Integration Test Strategy", ethers.zeroPadValue("0xbeef", 32));

		return {
			vault,
			pool,
			router,
			composer,
			registry,
			oracle,
			token,
			tokenB,
			owner,
			executor,
			execContract: execContractDeployed,
		};
	}

	it("can open position with supply only (no borrow, no swap)", async () => {
		const { vault, pool, composer, registry, token, owner } = await deployFullStack();

		const [, user] = await ethers.getSigners();
		const userClient = await hre.cofhe.createClientWithBatteries(user);

		const supplyAmount = ethers.parseEther("100");

		const [eSupply] = await userClient.encryptInputs([Encryptable.uint128(supplyAmount)]).execute();

		await token.mint(user.address, supplyAmount);
		await token.connect(user).approve(await composer.getAddress(), ethers.MaxUint256);

		await composer.connect(user).openPosition(
			{
				strategyName: "Test",
				workflowHash: ethers.zeroPadValue("0xbeef", 32),
				collateralAmount: supplyAmount,
				poolSupplyAmount: 0n,
				poolBorrowAmount: 0n,
				swapDeadlineOffset: 0n,
				strategyId: 0n, // auto-register
				swapAmountIn: 0n,
				swapMinOut: 0n,
				collateralToken: await token.getAddress(),
				borrowToken: ethers.ZeroAddress,
				swapTokenOut: ethers.ZeroAddress,
				ltvNum: 100n,
				ltvDen: 100n,
				useOracleBorrow: false,
				apyTarget: 0,
				loopCount: 0,
			},
			{
				collateral: eSupply,
				supplyEnc: { ctHash: 0n, securityZone: 0, utype: 0, signature: "0x" },
				borrowEnc: { ctHash: 0n, securityZone: 0, utype: 0, signature: "0x" },
			},
		);

		const userPositions = await vault.getUserPositions(user.address);
		expect(userPositions.length).to.equal(1);
	});

	it("can submit and cancel a swap intent", async () => {
		const { router, executor, token, tokenB, owner } = await deployFullStack();
		const [, user] = await ethers.getSigners();

		const amount = ethers.parseEther("10");
		await token.mint(user.address, amount);
		await token.connect(user).approve(await router.getAddress(), ethers.MaxUint256);

		const intentId = await router
			.connect(user)
			.submitSwapIntent.staticCall(
				await token.getAddress(),
				await tokenB.getAddress(),
				amount,
				amount,
				300n,
			);
		await router
			.connect(user)
			.submitSwapIntent(await token.getAddress(), await tokenB.getAddress(), amount, amount, 300n);

		const [, , intentUser] = await router.getIntentMeta(intentId);
		expect(intentUser).to.equal(user.address);

		await router.connect(user).cancelIntent(intentId);

		const [, , cancelledUser] = await router.getIntentMeta(intentId);
		expect(cancelledUser).to.equal(ethers.ZeroAddress);
	});

	it("can execute intent with executor contract", async () => {
		const { router, executor, token, tokenB, owner, execContract } = await deployFullStack();
		const [, user] = await ethers.getSigners();

		// User submits swap intent (tokenIn -> tokenB)
		const amount = ethers.parseEther("10");
		const outputAmount = ethers.parseEther("9");
		await token.mint(user.address, amount);
		await token.connect(user).approve(await router.getAddress(), ethers.MaxUint256);

		const intentId = await router
			.connect(user)
			.submitSwapIntent.staticCall(
				await token.getAddress(),
				await tokenB.getAddress(),
				amount,
				outputAmount,
				300n,
			);
		await router
			.connect(user)
			.submitSwapIntent(
				await token.getAddress(),
				await tokenB.getAddress(),
				amount,
				outputAmount,
				300n,
			);

		await tokenB.mint(await execContract.getAddress(), outputAmount);
		await execContract
			.connect(owner)
			.approveToken(await tokenB.getAddress(), await router.getAddress(), outputAmount);

		// Execute swap via executor contract (onlyOwner call → router's executor = execContract)
		await execContract
			.connect(owner)
			.executeIntent(await router.getAddress(), intentId, outputAmount);

		expect(await tokenB.balanceOf(user.address)).to.equal(outputAmount);
	});
});
