import { ethers } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";
import { Encryptable, type CofheClient } from "@cofhe/sdk";
import { setupFhePermissions } from "./helpers/acl";

describe("Comprehensive FheForge Integration & Flow Test Suite", () => {
    let deployer: any;
    let tester: any;
    let execContract: any;
    let registry: any;
    let vault: any;
    let pool: any;
    let router: any;
    let tokenRegistry: any;
    let strategyExecutor: any;
    let composer: any;
    let pyth: any;
    let oracle: any;
    let weth: any;
    let usdc: any;
    let testerClient: CofheClient;

    const WETH_PYTH_ID = ethers.zeroPadValue("0x01", 32);
    const USDC_PYTH_ID = ethers.zeroPadValue("0x02", 32);

    before(async () => {
        // 1. Setup Accounts and Client Batteries
        await hre.cofhe.mocks.deployMocks();
        const signers = await ethers.getSigners();
        deployer = signers[0];
        tester = signers[1] ?? signers[0];
        testerClient = await hre.cofhe.createClientWithBatteries(tester);

        // 2. Deploy Foundation Layer
        const ExecutorContractFactory = await ethers.getContractFactory("ExecutorContract");
        execContract = await ExecutorContractFactory.deploy();
        await execContract.waitForDeployment();

        const Registry = await ethers.getContractFactory("StrategyRegistry");
        registry = await Registry.deploy(90n); // Fast timelock delay for tests
        await registry.waitForDeployment();

        const Vault = await ethers.getContractFactory("StrategyVault");
        vault = await Vault.deploy(await registry.getAddress());
        await vault.waitForDeployment();

        const Pyth = await ethers.getContractFactory("SimplePythMock");
        pyth = await Pyth.deploy(0n);
        await pyth.waitForDeployment();

        const Oracle = await ethers.getContractFactory("PriceOracle");
        oracle = await Oracle.deploy(await pyth.getAddress(), 3600n);
        await oracle.waitForDeployment();

        const Router = await ethers.getContractFactory("SwapRouter");
        router = await Router.deploy(
            await execContract.getAddress(),
            5n, // Min deadline
            300n, // Max deadline
            90n, // Fast executor rotation delay
            ethers.ZeroAddress // Uniswap V3 stub
        );
        await router.waitForDeployment();

        const Pool = await ethers.getContractFactory("LendingPool");
        pool = await Pool.deploy();
        await pool.waitForDeployment();

        const TokenRegistryFactory = await ethers.getContractFactory("TokenRegistry");
        tokenRegistry = await TokenRegistryFactory.deploy();
        await tokenRegistry.waitForDeployment();

        // 3. Deploy Composer and StrategyExecutor
        const Composer = await ethers.getContractFactory("FheForgeComposer");
        composer = await Composer.deploy(
            await registry.getAddress(),
            await vault.getAddress(),
            await pool.getAddress(),
            await router.getAddress()
        );
        await composer.waitForDeployment();

        const StratExec = await ethers.getContractFactory("StrategyExecutor");
        strategyExecutor = await StratExec.deploy(
            await pool.getAddress(),
            await vault.getAddress(),
            await router.getAddress()
        );
        await strategyExecutor.waitForDeployment();

        // 4. Deploy Mock Tokens
        const TokenFactory = await ethers.getContractFactory("MockERC20");
        const WethFactory = await ethers.getContractFactory("WETH9");
        weth = await WethFactory.deploy();
        await weth.waitForDeployment();
        usdc = await TokenFactory.deploy("USD Coin", "USDC", 6);
        await usdc.waitForDeployment();

        // 5. Connect Wire Paths
        await registry.setVault(await vault.getAddress());
        await pool.setComposer(await composer.getAddress());
        await pool.setOracle(await oracle.getAddress());
        await pool.setWeth(await weth.getAddress());

        // 6. Setup Oracle Price Feeds
        await oracle.setSource(await weth.getAddress(), WETH_PYTH_ID, 18, 3600n);
        await oracle.setSource(await usdc.getAddress(), USDC_PYTH_ID, 6, 3600n);
        await oracle.setCollateralFactor(await usdc.getAddress(), 8000, 8500);

        // Seed pyth oracle with prices (WETH = 3000 USD, USDC = 1 USD)
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        await pyth.setPrice(WETH_PYTH_ID, {
            price: 3000n * 10n**8n,
            conf: 1n,
            expo: -8n,
            publishTime: nowSec
        });
        await pyth.setPrice(USDC_PYTH_ID, {
            price: 1n * 10n**8n,
            conf: 1n,
            expo: -8n,
            publishTime: nowSec
        });

        // 7. Seed Balances & Approvals for Tester
        await weth.connect(tester).deposit({ value: ethers.parseEther("100") });
        await usdc.mint(tester.address, ethers.parseUnits("100000", 6));

        await weth.connect(tester).approve(await composer.getAddress(), ethers.MaxUint256);
        await usdc.connect(tester).approve(await composer.getAddress(), ethers.MaxUint256);
        await usdc.connect(tester).approve(await vault.getAddress(), ethers.MaxUint256);
        await usdc.connect(tester).approve(await pool.getAddress(), ethers.MaxUint256);
        await usdc.connect(tester).approve(await strategyExecutor.getAddress(), ethers.MaxUint256);

        // 8. Register tokens to TokenRegistry globally for all test processes
        await tokenRegistry.registerToken({
            token: await weth.getAddress(),
            ltvBps: 8000,
            liquidationBonusBps: 500,
            decimals: 18,
            isLendable: true,
            isBorrowable: true,
            isCollateral: true,
            enabled: true,
            pythPriceId: WETH_PYTH_ID,
            borrowCap: ethers.parseEther("1000"),
            supplyCap: ethers.parseEther("10000")
        });
        await tokenRegistry.registerToken({
            token: await usdc.getAddress(),
            ltvBps: 8000,
            liquidationBonusBps: 500,
            decimals: 6,
            isLendable: true,
            isBorrowable: true,
            isCollateral: true,
            enabled: true,
            pythPriceId: USDC_PYTH_ID,
            borrowCap: ethers.parseUnits("100000", 6),
            supplyCap: ethers.parseUnits("1000000", 6)
        });
    });

    describe("1. TokenRegistry Tests", () => {
        it("can register, update, and disable tokens dynamically", async () => {
            // Register WETH
            await tokenRegistry.registerToken({
                token: await weth.getAddress(),
                ltvBps: 8000,
                liquidationBonusBps: 500,
                decimals: 18,
                isLendable: true,
                isBorrowable: true,
                isCollateral: true,
                enabled: true,
                pythPriceId: WETH_PYTH_ID,
                borrowCap: ethers.parseEther("1000"),
                supplyCap: ethers.parseEther("10000")
            });

            const count = await tokenRegistry.getTokenCount();
            expect(count).to.equal(2n);

            // Update configuration
            await tokenRegistry.updateTokenConfig(await weth.getAddress(), {
                token: await weth.getAddress(),
                ltvBps: 8500,
                liquidationBonusBps: 500,
                decimals: 18,
                isLendable: true,
                isBorrowable: true,
                isCollateral: true,
                enabled: true,
                pythPriceId: WETH_PYTH_ID,
                borrowCap: ethers.parseEther("2000"),
                supplyCap: ethers.parseEther("20000")
            });

            const info = await tokenRegistry.tokens(await weth.getAddress());
            expect(info.ltvBps).to.equal(8500n);

            // Disable token
            await tokenRegistry.disableToken(await weth.getAddress());
            const disabledInfo = await tokenRegistry.tokens(await weth.getAddress());
            expect(disabledInfo.enabled).to.be.false;
        });
    });

    describe("2. StrategyRegistry Timelock & Archiving", () => {
        it("reverts if empty, duplicate, or unregistered names are parsed", async () => {
            const hash = ethers.zeroPadValue("0xc1", 32);
            await expect(registry.registerStrategy("", hash)).to.be.revertedWithCustomError(registry, "EmptyName");
            await expect(registry.registerStrategy("a".repeat(257), hash)).to.be.revertedWithCustomError(registry, "NameTooLong");
            await expect(registry.registerStrategy("Strategy-A", ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "ZeroWorkflowHash");

            await registry.registerStrategy("Strategy-A", hash);
            await expect(registry.registerStrategy("Strategy-A", hash)).to.be.revertedWithCustomError(registry, "StrategyAlreadyExists");
        });

        it("correctly archives and restores registered strategies", async () => {
            const count = await registry.strategyCount();
            await registry.setActive(count, false);
            let meta = await registry.getStrategyMeta(count);
            expect(meta.active).to.be.false;

            await registry.setActive(count, true);
            meta = await registry.getStrategyMeta(count);
            expect(meta.active).to.be.true;
        });
    });

    describe("3. StrategyVault Position Lifecycle & Native ETH", () => {
        it("handles partial deposit, collateral additions, and full position closure cleanly", async () => {
            const collateralAmt = ethers.parseUnits("1000", 6);
            const [eCollateral] = await testerClient.encryptInputs([Encryptable.uint128(collateralAmt)]).execute();
            const hCollateral = ethers.zeroPadValue(ethers.toBeHex(eCollateral.ctHash), 32);

            // Grant FHE ACL permissions for vault to access collateral ciphertext
            await setupFhePermissions(eCollateral.ctHash, await vault.getAddress(), tester.address);

            // Open position
            const tx = await vault.connect(tester).openPosition(
                await usdc.getAddress(),
                collateralAmt,
                hCollateral,
                1n, // strategyId
                tester.address
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find((log: any) => log.fragment?.name === "PositionOpened");
            const positionId = event.args[0];

            let positions = await vault.getUserPositions(tester.address);
            expect(positions.length).to.be.greaterThan(0);

            // Partial close
            const closeAmt = ethers.parseUnits("400", 6);
            const [eClose] = await testerClient.encryptInputs([Encryptable.uint128(closeAmt)]).execute();
            const hClose = ethers.zeroPadValue(ethers.toBeHex(eClose.ctHash), 32);

            await setupFhePermissions(eClose.ctHash, await vault.getAddress(), tester.address);
            await vault.connect(tester).closePosition(positionId, closeAmt, hClose);

            const remaining = await vault.getDepositedAmount(positionId);
            expect(remaining).to.equal(ethers.parseUnits("600", 6));

            // Full close
            const [eRemaining] = await testerClient.encryptInputs([Encryptable.uint128(remaining)]).execute();
            const hRemaining = ethers.zeroPadValue(ethers.toBeHex(eRemaining.ctHash), 32);

            await setupFhePermissions(eRemaining.ctHash, await vault.getAddress(), tester.address);
            await vault.connect(tester).closePosition(positionId, remaining, hRemaining);

            positions = await vault.getUserPositions(tester.address);
            expect(positions.length).to.equal(0);
        });
    });

    describe("4. LendingPool Supply/Borrow & Native Wrapping Flow", () => {
        it("supports supply, checkLtvAndBorrow, repay, and withdraw gates", async () => {
            const supplyAmt = ethers.parseUnits("2000", 6);
            const borrowAmt = ethers.parseUnits("1000", 6);

            const [eSupply] = await testerClient.encryptInputs([Encryptable.uint128(supplyAmt)]).execute();
            await pool.connect(tester).shield(await usdc.getAddress(), supplyAmt, eSupply);

            // Borrow with dynamic LTV verification (70%)
            const [eBorrow] = await testerClient.encryptInputs([Encryptable.uint128(borrowAmt)]).execute();
            await pool.connect(tester).borrowWithLtvCheck(
                await usdc.getAddress(),
                await usdc.getAddress(),
                borrowAmt,
                eBorrow,
                70,
                100
            );

            const plainBorrow = await pool.totalPlainBorrow(await usdc.getAddress());
            expect(plainBorrow).to.equal(borrowAmt);

            // Revert withdraw check due to reserve threshold breach
            const [eWd] = await testerClient.encryptInputs([Encryptable.uint128(supplyAmt)]).execute();
            await expect(pool.connect(tester).partialUnshield(await usdc.getAddress(), supplyAmt, eWd))
                .to.be.revertedWithCustomError(pool, "InsufficientReserve");

            // Clean repay & withdraw
            const [eRepay] = await testerClient.encryptInputs([Encryptable.uint128(borrowAmt)]).execute();
            await pool.connect(tester).repayDebt(await usdc.getAddress(), borrowAmt, eRepay);

            await pool.connect(tester).partialUnshield(await usdc.getAddress(), supplyAmt, eWd);
        });

        it("integrates with native ETH wrappers", async () => {
            const ethAmt = ethers.parseEther("1");
            const [eSupplyEth] = await testerClient.encryptInputs([Encryptable.uint128(ethAmt)]).execute();

            await setupFhePermissions(eSupplyEth.ctHash, await pool.getAddress(), tester.address);

            // Native supply
            await pool.connect(tester).shieldEth(eSupplyEth, { value: ethAmt });

            const wrappedBal = await weth.balanceOf(await pool.getAddress());
            expect(wrappedBal).to.equal(ethAmt);

            // Native withdraw
            const [eWithdrawEth] = await testerClient.encryptInputs([Encryptable.uint128(ethAmt)]).execute();
            await setupFhePermissions(eWithdrawEth.ctHash, await pool.getAddress(), tester.address);
            await pool.connect(tester).partialUnshieldEth(ethAmt, eWithdrawEth);
        });
    });

    describe("5. SwapRouter Intent Boundaries & Timelocks", () => {
        it("reverts swaps if deadline limits are violated", async () => {
            await expect(router.submitSwapIntent(
                await usdc.getAddress(),
                await weth.getAddress(),
                1000n,
                10n,
                0n // Under min deadline
            )).to.be.revertedWithCustomError(router, "DeadlineTooShort");

            await expect(router.submitSwapIntent(
                await usdc.getAddress(),
                await weth.getAddress(),
                1000n,
                10n,
                1000n // Over max deadline
            )).to.be.revertedWithCustomError(router, "DeadlineTooLong");
        });
    });

    describe("6. StrategyExecutor Multi-step Pipeline & Checkpointing", () => {
        it("correctly executes and checkpoints structured pipeline tasks", async () => {
            const supplyAmt = ethers.parseUnits("500", 6);
            const [eSupply] = await testerClient.encryptInputs([Encryptable.uint128(supplyAmt)]).execute();

            // Structure a multi-step action pipeline (e.g. Shielding Deposit)
            const action: any = {
                actionType: await strategyExecutor.SHIELD_SUPPLY(),
                params: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "uint256"],
                    [await usdc.getAddress(), supplyAmt]
                ),
                encAmount: eSupply
            };

            await usdc.connect(tester).transfer(await strategyExecutor.getAddress(), supplyAmt);

            // Temporarily set StrategyExecutor as pool composer for depositFor check
            await pool.setComposer(await strategyExecutor.getAddress());

            // Grant FHE ACL permissions for StrategyExecutor and LendingPool to access ciphertext
            await setupFhePermissions(eSupply.ctHash, await strategyExecutor.getAddress(), tester.address);
            await setupFhePermissions(eSupply.ctHash, await pool.getAddress(), tester.address);

            // Execute pipeline
            const strategyId = ethers.zeroPadValue("0xe1", 32);
            await strategyExecutor.connect(tester).executePipeline(strategyId, [action]);

            const cp = await strategyExecutor.checkpoints(strategyId);
            expect(cp.completed).to.be.true;

            // Restore original composer
            await pool.setComposer(await composer.getAddress());
        });
    });

    describe("7. FheForgeComposer Compound Leverage Flow", () => {
        it("successfully opens and manages leveraged portfolios in a single call", async () => {
            const collateral = ethers.parseUnits("1000", 6);
            const poolSupply = ethers.parseUnits("500", 6);

            const [eCol, eSup, eBor] = await testerClient.encryptInputs([
                Encryptable.uint128(collateral),
                Encryptable.uint128(poolSupply),
                Encryptable.uint128(0n)
            ]).execute();

            await composer.connect(tester).openPosition(
                {
                    strategyName: "Leveraged Portfolio",
                    workflowHash: ethers.zeroPadValue("0xc3", 32),
                    collateralAmount: collateral,
                    poolSupplyAmount: poolSupply,
                    poolBorrowAmount: 0n,
                    swapDeadlineOffset: 0n,
                    strategyId: 0n,
                    swapAmountIn: 0n,
                    swapMinOut: 0n,
                    collateralToken: await usdc.getAddress(),
                    borrowToken: ethers.ZeroAddress,
                    swapTokenOut: ethers.ZeroAddress,
                    ltvNum: 100n,
                    ltvDen: 100n,
                    useOracleBorrow: false,
                    apyTarget: 0,
                    loopCount: 0
                },
                {
                    collateral: eCol,
                    supplyEnc: eSup,
                    borrowEnc: eBor
                }
            );

            const stratCount = await registry.strategyCount();
            expect(stratCount).to.be.greaterThan(0n);
        });
    });

    describe("8. Exhaustive PriceOracle & Fallback Configurations", () => {
        it("properly resolves isSupported, getPriceUsd, and convertToUsd/convertFromUsd", async () => {
            const supported = await oracle.isSupported(await weth.getAddress());
            expect(supported).to.be.true;

            const [priceWad] = await oracle.getPriceUsd(await weth.getAddress());
            expect(priceWad).to.equal(3000n * 10n**18n); // Normalizes to 18 decimals

            const convertUsd = await oracle.convertToUsd(await weth.getAddress(), ethers.parseEther("2"));
            expect(convertUsd).to.equal(6000n * 10n**18n);

            const convertAsset = await oracle.convertFromUsd(await weth.getAddress(), 6000n * 10n**18n);
            expect(convertAsset).to.equal(ethers.parseEther("2"));
        });

        it("manages dynamic fallback prices and staleness parameters", async () => {
            // Set dynamic fallback
            await oracle.setFallbackPrice(await weth.getAddress(), 2500n * 10n**18n);

            // Test fallback resolution
            const resolved = await oracle.getPriceWithFallback(await weth.getAddress());
            expect(resolved).to.equal(3000n * 10n**18n); // Uses Pyth feed when not stale

            // Force staleness threshold down
            await oracle.setStalenessThreshold(1n); // 1s staleness threshold
            
            // Remove fallback price configuration
            await oracle.removeFallbackPrice(await weth.getAddress());
        });

        it("allows batch feed setups and removal", async () => {
            const feed = {
                token: await usdc.getAddress(),
                staleThreshold: 1800n,
                decimals: 6,
                priceId: USDC_PYTH_ID
            };
            await oracle.batchSetSources([feed]);
            await oracle.removeSource(await usdc.getAddress());
            
            // Restore usdc source for other tests
            await oracle.setSource(await usdc.getAddress(), USDC_PYTH_ID, 6, 3600n);
        });
    });

    describe("9. Timelocked Rotations & Admin Sweeps", () => {
        it("executes registry vault rotation with EVM time travel", async () => {
            const delay = await registry.ROTATION_DELAY();
            const newVault = "0x0000000000000000000000000000000000000001";
            
            await registry.proposeVault(newVault);
            const proposed = await registry.pendingRole();
            expect(proposed).to.equal(newVault);

            // Fast forward time
            await hre.network.provider.send("evm_increaseTime", [Number(delay) + 10]);
            await hre.network.provider.send("evm_mine");

            await registry.acceptVault();
            const activeVault = await registry.vaultAddress();
            expect(activeVault).to.equal(newVault);

            // Restore original vault
            await registry.proposeVault(await vault.getAddress());
            await hre.network.provider.send("evm_increaseTime", [Number(delay) + 10]);
            await hre.network.provider.send("evm_mine");
            await registry.acceptVault();
        });

        it("executes router executor rotation with EVM time travel", async () => {
            const delay = await router.ROTATION_DELAY();
            const newExec = "0x0000000000000000000000000000000000000002";

            await router.proposeExecutor(newExec);
            const proposed = await router.pendingRole();
            expect(proposed).to.equal(newExec);

            // Fast forward time
            await hre.network.provider.send("evm_increaseTime", [Number(delay) + 10]);
            await hre.network.provider.send("evm_mine");

            await router.acceptExecutor();
            const activeExec = await router.executor();
            expect(activeExec).to.equal(newExec);
        });

        it("validates StrategyExecutor checkpoint resets and sweeping", async () => {
            const strategyId = ethers.zeroPadValue("0xf8", 32);
            await strategyExecutor.resetCheckpoint(strategyId);

            // Fund executor with USDC and sweep
            await usdc.mint(await strategyExecutor.getAddress(), 1000n);
            await strategyExecutor.sweepToken(await usdc.getAddress(), tester.address);
            
            const bal = await usdc.balanceOf(await strategyExecutor.getAddress());
            expect(bal).to.equal(0n);
        });

        it("validates ExecutorContract approve and withdraw helpers", async () => {
            await usdc.mint(await execContract.getAddress(), 1000n);
            await execContract.approveToken(await usdc.getAddress(), tester.address, 1000n);
            await execContract.withdrawTokens(await usdc.getAddress(), 1000n);
        });
    });
});
