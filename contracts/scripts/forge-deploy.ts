/**
 * forge-deploy.ts
 * Unified FheForge deploy + wire + verify + Pyth push + ABI sync.
 * Uses Hardhat ethers natively (proven pattern from deploy-full.ts Wave30).
 *
 * Usage (testnet):
 *   DEMO_MODE=1 npx hardhat run scripts/forge-deploy.ts --network arb-sepolia
 *
 * Usage (prod):
 *   npx hardhat run scripts/forge-deploy.ts --network arbitrum
 *
 * Env:
 *   DEMO_MODE=1     — fast timelocks (90s), pushes Pyth prices
 *   PUSH_PRICES=1   — force Hermes price push
 *   SYNC_ABIS=1     — copy ABIs to ui/abis/
 *   SKIP_VERIFY=1   — skip Etherscan verification
 *   BENCH=1         — print timing summary
 */

import * as fs from "node:fs";
import * as path from "node:path";
import hre, { artifacts, ethers, network, run } from "hardhat";
import type { Artifact } from "hardhat/types";
import {
	type ContractInfo,
	type DeployRecord,
	elapsed,
	FastVerifier,
	Progress,
} from "./lib/deploy-utils";

const PROD_CHAINS = new Set([1, 42161, 10, 137, 8453, 43114]);
const UNISWAP_V3_ROUTER = "0x101F443B4d1b059569D643917553c771E1b9663E";
const ADDRS: Record<number, { pyth: string; weth: string; usdc: string }> = {
	31337: { pyth: "0x0000000000000000000000000000000000000001", weth: "", usdc: "" },
	421614: {
		pyth: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF",
		weth: "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32",
		usdc: "0x150376EdEbc5AC48771655a61a795d828BeC8Df6",
	},
	84532: { pyth: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", weth: "", usdc: "" },
};
const WETH_PYTH_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const USDC_PYTH_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

const ENV_KEYS: Record<string, string> = {
	StrategyRegistry: "NEXT_PUBLIC_REGISTRY_ADDRESS",
	LendingPool: "NEXT_PUBLIC_POOL_ADDRESS",
	PriceOracle: "NEXT_PUBLIC_ORACLE_ADDRESS",
	SwapRouter: "NEXT_PUBLIC_SWAP_ROUTER_ADDRESS",
	ExecutorContract: "NEXT_PUBLIC_EXECUTOR_CONTRACT_ADDRESS",
	StrategyVault: "NEXT_PUBLIC_VAULT_ADDRESS",
	FheForgeComposer: "NEXT_PUBLIC_COMPOSER_ADDRESS",
	TokenRegistry: "NEXT_PUBLIC_TOKEN_REGISTRY_ADDRESS",
	StrategyExecutor: "NEXT_PUBLIC_STRATEGY_EXECUTOR_ADDRESS",
	FheForgeGovernor: "NEXT_PUBLIC_GOVERNOR_ADDRESS",
	FheForgeTimelock: "NEXT_PUBLIC_TIMELOCK_ADDRESS",
};

async function main() {
	const prog = new Progress();
	const isBench = process.env.BENCH === "1";
	const skipVerify = process.env.SKIP_VERIFY === "1";

	const [deployer] = await ethers.getSigners();
	if (!deployer) throw new Error("No signer — set PRIVATE_KEY in .env");

	const chainId = network.config.chainId ?? 0;
	const bal = await ethers.provider.getBalance(deployer);
	const chainAddrs = ADDRS[chainId];
	if (!chainAddrs) throw new Error(`No ADDRS for chain ${chainId}`);

	if (chainId === 31337 && hre.cofhe?.mocks) {
		prog.phase("Mocks — CoFHE");
		await hre.cofhe.mocks.deployMocks();
		prog.item(true, "CoFHE mocks deployed");
	}

	const isDemo = process.env.DEMO_MODE === "1";
	if (isDemo && PROD_CHAINS.has(chainId)) throw new Error("DEMO_MODE=1 on production chain");

	const timing = {
		vaultRotationDelay: isDemo ? 90n : 172_800n,
		executorRotationDelay: isDemo ? 90n : 172_800n,
		minDeadlineOffset: isDemo ? 5n : 30n,
		maxDeadlineOffset: isDemo ? 300n : 604_800n,
		defaultStaleThreshold: 86_400n,
		timelockMinDelay: isDemo ? 90n : 172_800n,
		governorVotingDelay: isDemo ? 12n : 57_600n,
		governorVotingPeriod: isDemo ? 144n : 172_800n,
		governorQuorumBps: 100n,
	};

	console.log(
		`\n━━━ FheForge Deploy — ${network.name} (${chainId}) — ${isDemo ? "DEMO" : "PROD"} ─━━`,
	);
	console.log(`  Deployer: ${deployer.address}   Balance: ${ethers.formatEther(bal)} ETH`);
	if (bal < ethers.parseEther("0.1")) console.warn("  ⚠ Balance < 0.1 ETH");

	const depDir = path.join(__dirname, "..", "deployments");
	const depPath = path.join(depDir, `${chainId}.json`);
	fs.mkdirSync(depDir, { recursive: true });

	const rec: DeployRecord = fs.existsSync(depPath)
		? JSON.parse(fs.readFileSync(depPath, "utf8"))
		: {
				network: "",
				chainId,
				deployer: "",
				deployedAt: "",
				mode: "",
				contracts: {},
				deploymentTxs: {},
				swapExecutor: "",
				weth: "",
			};
	const verified = new Set<string>();
	if (rec.verificationStatus)
		for (const [k, v] of Object.entries(rec.verificationStatus)) if (v) verified.add(k);

	// ── Deploy helper: no manual nonce/gas management — Hardhat ethers handles it ──
	async function deploy(
		label: string,
		name: string,
		args: unknown[] = [],
	): Promise<ethers.Contract> {
		const factory = await ethers.getContractFactory(name);
		const contract = await factory.deploy(...args);
		await contract.waitForDeployment();
		const addr = await contract.getAddress();
		prog.item(true, `${label}: ${addr}`);
		return contract;
	}

	async function send(
		label: string,
		fn: () => Promise<ethers.ContractTransactionResponse>,
	): Promise<void> {
		const tx = await fn();
		await tx.wait();
		prog.item(true, label);
	}

	// ── L0a — ExecutorContract first ──
	prog.phase("L0a — ExecutorContract");
	const executor = await deploy("ExecutorContract", "ExecutorContract");

	// ── L0b — Independent contracts ──
	prog.phase("L0b — Registry, Pool, Oracle, Router, TokenRegistry");
	const registry = await deploy("StrategyRegistry", "StrategyRegistry", [
		timing.vaultRotationDelay,
	]);
	const pool = await deploy("LendingPool", "LendingPool");
	const oracle = await deploy("PriceOracle", "PriceOracle", [
		chainAddrs.pyth,
		timing.defaultStaleThreshold,
	]);
	const router = await deploy("SwapRouter", "SwapRouter", [
		await executor.getAddress(),
		timing.minDeadlineOffset,
		timing.maxDeadlineOffset,
		timing.executorRotationDelay,
		UNISWAP_V3_ROUTER,
	]);
	const tokenRegistry = await deploy("TokenRegistry", "TokenRegistry");

	const addrs0 = {
		registry: await registry.getAddress(),
		pool: await pool.getAddress(),
		oracle: await oracle.getAddress(),
		router: await router.getAddress(),
		executor: await executor.getAddress(),
		tokenRegistry: await tokenRegistry.getAddress(),
	};

	// ── Tokens (WETH/USDC mocks if not externally provided) ──
	const tokens: Record<string, string> = {};
	if (rec.tokens) Object.assign(tokens, rec.tokens);
	if (process.env.WETH_ADDRESS) tokens.WETH = process.env.WETH_ADDRESS;
	if (process.env.USDC_ADDRESS) tokens.USDC = process.env.USDC_ADDRESS;
	if (!tokens.WETH) {
		const wethMock = await deploy("Mock WETH", "MockERC20", ["Wrapped Ether", "WETH", 18]);
		tokens.WETH = await wethMock.getAddress();
	}
	if (!tokens.USDC) {
		const usdcMock = await deploy("Mock USDC", "MockERC20", ["USD Coin", "USDC", 6]);
		tokens.USDC = await usdcMock.getAddress();
	}

	// ── L1 — Vault ──
	prog.phase("L1 — StrategyVault");
	const vault = await deploy("StrategyVault", "StrategyVault", [addrs0.registry]);
	const vaultAddr = await vault.getAddress();

	// ── L2 — Composer + StrategyExecutor ──
	prog.phase("L2 — Composer, StrategyExecutor");
	const composer = await deploy("FheForgeComposer", "FheForgeComposer", [
		addrs0.registry,
		vaultAddr,
		addrs0.pool,
		addrs0.router,
	]);
	const stratExec = await deploy("StrategyExecutor", "StrategyExecutor", [
		addrs0.pool,
		vaultAddr,
		addrs0.router,
	]);
	const composerAddr = await composer.getAddress();
	const stratExecAddr = await stratExec.getAddress();

	const wethAddr = tokens.WETH ?? chainAddrs.weth;
	const usdcAddr = tokens.USDC ?? chainAddrs.usdc;

	// ── Wiring ──
	prog.phase("Wiring");

	if ((await registry.vaultAddress()) === ethers.ZeroAddress) {
		await send("registry.setVault", () => registry.setVault(vaultAddr));
	} else {
		prog.item(true, "Vault already set — skipping");
	}

	if ((await pool.weth()) === ethers.ZeroAddress) {
		await send("pool.setWeth", () => pool.setWeth(wethAddr));
	}
	if ((await pool.oracle()) === ethers.ZeroAddress) {
		await send("pool.setOracle", () => pool.setOracle(addrs0.oracle));
	}
	if ((await pool.composer()) === ethers.ZeroAddress) {
		await send("pool.setComposer", () => pool.setComposer(composerAddr));
	}

	if ((await oracle.priceId(wethAddr)) !== WETH_PYTH_ID) {
		await send("oracle.setSource WETH", () =>
			oracle.setSource(wethAddr, WETH_PYTH_ID, 18, timing.defaultStaleThreshold),
		);
	}
	if ((await oracle.priceId(usdcAddr)) !== USDC_PYTH_ID) {
		await send("oracle.setSource USDC", () =>
			oracle.setSource(usdcAddr, USDC_PYTH_ID, 6, timing.defaultStaleThreshold),
		);
	}
	if ((await oracle.collateralFactorBps(usdcAddr)) !== 8000) {
		await send("oracle.setCollateral USDC", () => oracle.setCollateralFactor(usdcAddr, 8000, 8500));
	}
	if ((await oracle.collateralFactorBps(wethAddr)) !== 8000) {
		await send("oracle.setCollateral WETH", () => oracle.setCollateralFactor(wethAddr, 8000, 8500));
	}

	// ── Token Registration — register WETH ──
	if (!(await tokenRegistry.isTokenEnabled(wethAddr))) {
		await send("tokenRegistry.registerToken WETH", () =>
			tokenRegistry.registerToken({
				token: wethAddr,
				ltvBps: 8000,
				liquidationBonusBps: 500,
				decimals: 18,
				isLendable: true,
				isBorrowable: true,
				isCollateral: true,
				enabled: true,
				pythPriceId: WETH_PYTH_ID,
				borrowCap: 0n,
				supplyCap: 0n,
			}),
		);
	} else {
		prog.item(true, "WETH already registered — skipping");
	}
	// ── Token Registration — register USDC ──
	if (!(await tokenRegistry.isTokenEnabled(usdcAddr))) {
		await send("tokenRegistry.registerToken USDC", () =>
			tokenRegistry.registerToken({
				token: usdcAddr,
				ltvBps: 8000,
				liquidationBonusBps: 500,
				decimals: 6,
				isLendable: true,
				isBorrowable: true,
				isCollateral: true,
				enabled: true,
				pythPriceId: USDC_PYTH_ID,
				borrowCap: 0n,
				supplyCap: 0n,
			}),
		);
	} else {
		prog.item(true, "USDC already registered — skipping");
	}

	// ── Pyth price push ──
	const pushPrices = process.env.PUSH_PRICES === "1" || isDemo;
	if (pushPrices) {
		try {
			const feedIds = [WETH_PYTH_ID, USDC_PYTH_ID];
			const query = feedIds.map((id) => `ids[]=${id.slice(2)}`).join("&");
			const hermesRes = (await (
				await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${query}`)
			).json()) as { binary?: { data: string[] } };
			const updateData = (hermesRes.binary?.data ?? []).map((d: string) => `0x${d}`);
			if (updateData.length > 0) {
				const fee = await oracle.getPythUpdateFee.staticCall(updateData);
				await send("pyth.push", () => oracle.updatePriceFeeds(updateData, { value: fee }));
			}
		} catch (e) {
			prog.item(false, `Pyth push failed: ${(e as Error).message.slice(0, 80)}`);
		}
	}

	// ── L3 — Governance ──
	prog.phase("L3 — Governance");

	const govToken = await deploy("FheForgeToken", "FheForgeToken", ["FheForge Token", "FHE"]);
	const govTokenAddr = await govToken.getAddress();

	// Mint initial supply to deployer so they can delegate / propose
	await send("govToken.mint deployer", () =>
		govToken.mint(deployer.address, ethers.parseEther("1000000")),
	);

	const timelock = await deploy("FheForgeTimelock", "FheForgeTimelock", [
		timing.timelockMinDelay,
		deployer.address,
	]);
	const timelockAddr = await timelock.getAddress();

	const governor = await deploy("FheForgeGovernor", "FheForgeGovernor", [
		govTokenAddr,
		timelockAddr,
		timing.governorVotingDelay,
		timing.governorVotingPeriod,
		timing.governorQuorumBps,
	]);
	const govAddr = await governor.getAddress();

	// Wire: grant roles on timelock
	const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
	const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
	const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
	const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

	await send("timelock.grantRole PROPOSER → Governor", () =>
		timelock.grantRole(PROPOSER_ROLE, govAddr),
	);
	await send("timelock.grantRole CANCELLER → Governor", () =>
		timelock.grantRole(CANCELLER_ROLE, govAddr),
	);
	// Open execution to anyone after timelock delay
	await send("timelock.grantRole EXECUTOR → address(0)", () =>
		timelock.grantRole(EXECUTOR_ROLE, ethers.ZeroAddress),
	);
	// Renounce admin — deployer no longer controls timelock
	await send("timelock.renounceRole DEFAULT_ADMIN_ROLE", () =>
		timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address),
	);

	// ── Verification ──
	prog.phase("Verification");

	const allContracts: ContractInfo[] = [
		{
			contractName: "StrategyRegistry",
			fqn: "contracts/StrategyRegistry.sol:StrategyRegistry",
			address: addrs0.registry,
			args: [timing.vaultRotationDelay.toString()],
			envKey: ENV_KEYS.StrategyRegistry,
		},
		{
			contractName: "LendingPool",
			fqn: "contracts/LendingPool.sol:LendingPool",
			address: addrs0.pool,
			args: [],
			envKey: ENV_KEYS.LendingPool,
		},
		{
			contractName: "PriceOracle",
			fqn: "contracts/PriceOracle.sol:PriceOracle",
			address: addrs0.oracle,
			args: [chainAddrs.pyth, timing.defaultStaleThreshold.toString()],
			envKey: ENV_KEYS.PriceOracle,
		},
		{
			contractName: "SwapRouter",
			fqn: "contracts/SwapRouter.sol:SwapRouter",
			address: addrs0.router,
			args: [
				addrs0.executor,
				timing.minDeadlineOffset.toString(),
				timing.maxDeadlineOffset.toString(),
				timing.executorRotationDelay.toString(),
				UNISWAP_V3_ROUTER,
			],
			envKey: ENV_KEYS.SwapRouter,
		},
		{
			contractName: "ExecutorContract",
			fqn: "contracts/ExecutorContract.sol:ExecutorContract",
			address: addrs0.executor,
			args: [],
			envKey: ENV_KEYS.ExecutorContract,
		},
		{
			contractName: "StrategyVault",
			fqn: "contracts/StrategyVault.sol:StrategyVault",
			address: vaultAddr,
			args: [addrs0.registry],
			envKey: ENV_KEYS.StrategyVault,
		},
		{
			contractName: "FheForgeComposer",
			fqn: "contracts/FheForgeComposer.sol:FheForgeComposer",
			address: composerAddr,
			args: [addrs0.registry, vaultAddr, addrs0.pool, addrs0.router],
			envKey: ENV_KEYS.FheForgeComposer,
		},
		{
			contractName: "TokenRegistry",
			fqn: "contracts/TokenRegistry.sol:TokenRegistry",
			address: addrs0.tokenRegistry,
			args: [],
			envKey: ENV_KEYS.TokenRegistry,
		},
		{
			contractName: "StrategyExecutor",
			fqn: "contracts/StrategyExecutor.sol:StrategyExecutor",
			address: stratExecAddr,
			args: [addrs0.pool, vaultAddr, addrs0.router],
			envKey: ENV_KEYS.StrategyExecutor,
		},
		{
			contractName: "FheForgeToken",
			fqn: "contracts/governance/FheForgeToken.sol:FheForgeToken",
			address: govTokenAddr,
			args: ["FheForge Token", "FHE"],
		},
		{
			contractName: "FheForgeTimelock",
			fqn: "contracts/governance/FheForgeTimelock.sol:FheForgeTimelock",
			address: timelockAddr,
			args: [timing.timelockMinDelay.toString(), deployer.address],
			envKey: ENV_KEYS.FheForgeTimelock,
		},
		{
			contractName: "FheForgeGovernor",
			fqn: "contracts/governance/FheForgeGovernor.sol:FheForgeGovernor",
			address: govAddr,
			args: [
				govTokenAddr,
				timelockAddr,
				timing.governorVotingDelay.toString(),
				timing.governorVotingPeriod.toString(),
				timing.governorQuorumBps.toString(),
			],
			envKey: ENV_KEYS.FheForgeGovernor,
		},
	];

	const verifier = new FastVerifier(chainId);
	if (skipVerify) {
		for (const c of allContracts) prog.item(true, `${c.contractName}: ${c.address} (skipped)`);
	} else if (verifier.enabled) {
		const vResults = await verifier.verifyBatch(allContracts, verified);
		for (const r of vResults) prog.item(r.ok, `${r.name}: ${r.ok ? r.msg : `FAIL ${r.msg}`}`);
	} else {
		console.log("  Using hardhat verify (no API key for direct)");
		for (const c of allContracts) {
			try {
				await run("verify:verify", { address: c.address, constructorArguments: c.args as any[] });
				verified.add(c.address);
				prog.item(true, `${c.contractName}: verified`);
			} catch (e: any) {
				const m = e?.message ?? String(e);
				if (m.includes("Already") || m.includes("already")) {
					verified.add(c.address);
					prog.item(true, `${c.contractName}: already verified`);
				} else {
					prog.item(false, `${c.contractName}: ${m.slice(0, 120)}`);
				}
			}
		}
	}

	// ── Save ──
	rec.network = network.name;
	rec.chainId = chainId;
	rec.deployer = deployer.address;
	rec.deployedAt = new Date().toISOString();
	rec.mode = isDemo ? "demo" : "production";
	rec.swapExecutor = addrs0.executor;
	rec.weth = wethAddr;
	rec.contracts = Object.fromEntries(allContracts.map((c) => [c.contractName, c.address]));
	rec.tokens = tokens;
	rec.verificationStatus = {};
	for (const c of allContracts) rec.verificationStatus[c.contractName] = verified.has(c.address);
	rec.notes = process.env.DEPLOY_NOTES ?? rec.notes ?? undefined;
	fs.writeFileSync(depPath, JSON.stringify(rec, null, 2));
	prog.item(true, `Record saved: ${depPath}`);

	const envPath = path.join(depDir, `${chainId}.env`);
	const envLines = [
		`# FheForge deploy — ${network.name} (${chainId}) — ${rec.deployedAt}`,
		...allContracts.filter((c) => c.envKey).map((c) => `${c.envKey}=${c.address}`),
		`NEXT_PUBLIC_TOKEN_WETH=${wethAddr}`,
		`NEXT_PUBLIC_TOKEN_USDC=${usdcAddr}`,
		`NEXT_PUBLIC_UNISWAP_V3_ROUTER=${UNISWAP_V3_ROUTER}`,
		`PRICE_ORACLE_ADDRESS=${addrs0.oracle}`,
	];
	fs.writeFileSync(envPath, `${envLines.join("\n")}\n`);
	prog.item(true, `Env saved: ${envPath}`);

	if (process.env.SYNC_ABIS === "1") {
		const abiDir = path.join(__dirname, "..", "..", "ui", "abis");
		fs.mkdirSync(abiDir, { recursive: true });
		for (const c of allContracts) {
			const a = (await artifacts.readArtifact(c.contractName)) as Artifact;
			fs.writeFileSync(path.join(abiDir, `${c.contractName}.json`), JSON.stringify(a.abi, null, 2));
		}
		prog.item(true, `ABIs synced to ${abiDir}`);
	}

	if (isBench) {
		console.log("\n═══ BENCHMARK ═══");
		console.log(`  Contracts: ${Object.keys(rec.contracts).length}`);
		console.log(
			`  Verified: ${Object.values(rec.verificationStatus ?? {}).filter(Boolean).length}`,
		);
		console.log(`  Time: ${elapsed(prog.t0)}`);
	}

	prog.done();
}

main().catch((e) => {
	console.error("FATAL:", e);
	process.exit(1);
});
