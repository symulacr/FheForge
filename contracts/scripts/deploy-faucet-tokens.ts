/**
 * deploy-faucet-tokens.ts
 * Deploy 10 FaucetMockERC20 tokens + register with TokenRegistry + PriceOracle.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-faucet-tokens.ts --network arb-sepolia
 */

import { ethers, network } from "hardhat";

const TOKENS = [
	{
		name: "Ether",
		symbol: "ETH",
		decimals: 18,
		pythId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
	},
	{
		name: "Wrapped Ether",
		symbol: "WETH",
		decimals: 18,
		pythId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
	},
	{
		name: "USD Coin",
		symbol: "USDC",
		decimals: 6,
		pythId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
	},
	{
		name: "Tether USD",
		symbol: "USDT",
		decimals: 6,
		pythId: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
	},
	{
		name: "Wrapped Bitcoin",
		symbol: "WBTC",
		decimals: 8,
		pythId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
	},
	{
		name: "Dai Stablecoin",
		symbol: "DAI",
		decimals: 18,
		pythId: "0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd",
	},
	{
		name: "Arbitrum",
		symbol: "ARB",
		decimals: 18,
		pythId: "0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5",
	},
	{
		name: "Chainlink",
		symbol: "LINK",
		decimals: 18,
		pythId: "0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
	},
	{
		name: "Uniswap",
		symbol: "UNI",
		decimals: 18,
		pythId: "0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501",
	},
	{
		name: "Aave",
		symbol: "AAVE",
		decimals: 18,
		pythId: "0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445",
	},
];

// TokenRegistry and PriceOracle addresses (Arbitrum Sepolia)
const TOKEN_REGISTRY = "0xa731167FcB35c88E7482341Ab14D6363Cb9702Ea";
const PRICE_ORACLE = "0x8E41d720173c347740C05011FadD3a3B015ae18c";
const DEFAULT_STALE_THRESHOLD = 86_400n; // 24 hours — matches forge-deploy.ts

async function main() {
	const [deployer] = await ethers.getSigners();
	const chainId = network.config.chainId;
	console.log(`Deployer: ${deployer.address} on chain ${chainId}`);
	console.log(
		`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`,
	);

	const deployedTokens: { symbol: string; address: string }[] = [];

	// Deploy tokens
	for (const token of TOKENS) {
		console.log(`Deploying ${token.symbol}...`);
		const Factory = await ethers.getContractFactory("FaucetMockERC20");
		const contract = await Factory.deploy(token.name, token.symbol, token.decimals);
		await contract.waitForDeployment();
		const addr = await contract.getAddress();
		console.log(`  ${token.symbol}: ${addr}`);
		deployedTokens.push({ symbol: token.symbol, address: addr });
	}

	// Register with TokenRegistry
	console.log("\nRegistering tokens with TokenRegistry...");
	const registry = await ethers.getContractAt("TokenRegistry", TOKEN_REGISTRY);

	for (const token of deployedTokens) {
		const tokenInfo = TOKENS.find((t) => t.symbol === token.symbol);
		if (!tokenInfo) {
			console.log(`  ${token.symbol}: unknown token, skipping registration`);
			continue;
		}
		try {
			const tx = await registry.registerToken({
				token: token.address,
				ltvBps: 8000, // 80% LTV
				liquidationBonusBps: 500, // 5% liquidation bonus
				decimals: tokenInfo.decimals,
				isLendable: true,
				isBorrowable: true,
				isCollateral: true,
				enabled: true,
				pythPriceId: tokenInfo.pythId,
				borrowCap: 0,
				supplyCap: 0,
			});
			await tx.wait();
			console.log(`  Registered ${token.symbol} ✓`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`  ${token.symbol} already registered or error: ${msg.slice(0, 80)}`);
		}
	}

	// Set oracle sources
	console.log("\nSetting PriceOracle sources...");
	const oracle = await ethers.getContractAt("PriceOracle", PRICE_ORACLE);

	for (const token of deployedTokens) {
		const tokenInfo = TOKENS.find((t) => t.symbol === token.symbol);
		if (!tokenInfo) {
			console.log(`  ${token.symbol}: unknown token, skipping oracle setup`);
			continue;
		}
		try {
			const tx = await oracle.setSource(
				token.address,
				tokenInfo.pythId,
				tokenInfo.decimals,
				DEFAULT_STALE_THRESHOLD,
			);
			await tx.wait();
			console.log(`  Oracle set for ${token.symbol} ✓`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`  ${token.symbol} oracle error: ${msg.slice(0, 80)}`);
		}
	}

	console.log("\n=== Deployed Tokens ===");
	for (const t of deployedTokens) {
		console.log(`${t.symbol.padEnd(6)} ${t.address}`);
	}
	console.log("\nDone!");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
