/**
 * Configure the deployed PriceOracle with Chainlink feeds + per-token LTV/liq factors.
 *
 * Run:
 *   set -a && source .env && set +a
 *   npx hardhat run scripts/configure-oracle.ts --network arb-sepolia
 *
 * The script is idempotent — re-running just updates existing config to the
 * latest constants in this file.
 *
 * Chainlink price feeds on Arbitrum Sepolia (verified live in Stage 5):
 *   ETH/USD  0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165 (8 decimals)
 *   USDC/USD 0x0153002d20B96532C639313c2d54c3dA09109309 (8 decimals)
 *
 * Per-token risk parameters:
 *   USDC: LTV 80% / liq threshold 85% — stablecoin, low volatility
 *   WETH: LTV 70% / liq threshold 75% — volatile asset
 */

import { ethers } from "hardhat";
import * as hardhat from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface NetworkConfig {
    name: string;
    config: { chainId?: number };
}
const network: NetworkConfig = (hardhat as unknown as { network: NetworkConfig }).network;

const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"; // arb-sepolia test USDC (6 decimals)
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73"; // arb-sepolia WETH9 (18 decimals)

// Pyth price-feed IDs (bytes32). Source: https://docs.pyth.network/price-feeds/price-feeds
// Pyth contract on arb-sepolia is at 0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF.
const ETH_USD_PRICE_ID =
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const USDC_USD_PRICE_ID =
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

interface DeploymentRecord {
    contracts: { PriceOracle: string };
}

async function main() {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("No deployer signer available");
    const chainId = network.config.chainId ?? 0;
    if (chainId !== 421614) {
        throw new Error(`This script targets arb-sepolia 421614; got chainId ${chainId}`);
    }

    const depPath = path.join(__dirname, "..", "deployments", `${chainId}.json`);
    const dep = JSON.parse(fs.readFileSync(depPath, "utf8")) as DeploymentRecord;
    const oracleAddr = dep.contracts.PriceOracle;
    if (!oracleAddr) throw new Error("No PriceOracle in deployments record");

    const oracle = await ethers.getContractAt("PriceOracle", oracleAddr, deployer);

    console.log(`Configuring PriceOracle ${oracleAddr} on chain ${chainId}…\n`);
    console.log(`Deployer / OWNER: ${deployer.address}`);

    // 1. USDC source: 6 decimals, 24h staleness threshold (matches Pyth heartbeat).
    console.log(`Setting source USDC → priceId ${USDC_USD_PRICE_ID} (6 decimals, 24h stale)…`);
    let tx = await oracle.setSource(USDC, USDC_USD_PRICE_ID, 6, 24 * 3600);
    await tx.wait();
    console.log(`  tx: ${tx.hash}`);

    // 2. WETH source: 18 decimals, 1h staleness (Pyth ETH/USD updates sub-second).
    console.log(`Setting source WETH → priceId ${ETH_USD_PRICE_ID} (18 decimals, 1h stale)…`);
    tx = await oracle.setSource(WETH, ETH_USD_PRICE_ID, 18, 3600);
    await tx.wait();
    console.log(`  tx: ${tx.hash}`);

    // 3. Per-token risk parameters
    console.log(`Setting USDC collateral factor: 80% LTV, 85% liq threshold…`);
    tx = await oracle.setCollateralFactor(USDC, 8000, 8500);
    await tx.wait();
    console.log(`  tx: ${tx.hash}`);

    console.log(`Setting WETH collateral factor: 70% LTV, 75% liq threshold…`);
    tx = await oracle.setCollateralFactor(WETH, 7000, 7500);
    await tx.wait();
    console.log(`  tx: ${tx.hash}`);

    // 4. Sanity-check by reading the prices.
    // NOTE: getPriceUsd will revert with PythErrors.StalePrice if the on-chain Pyth
    // cache hasn't been refreshed within the configured threshold. To refresh,
    // call PriceOracle.updatePriceFeeds(updateData) first with VAA bytes from
    // Pyth's Hermes endpoint (https://hermes.pyth.network).
    try {
        const [usdcPrice, usdcAt] = await oracle.getPriceUsd(USDC);
        const [wethPrice, wethAt] = await oracle.getPriceUsd(WETH);
        console.log(
            `\nLive readback:\n  USDC: ${ethers.formatUnits(usdcPrice, 18)} USD (Pyth ts=${usdcAt})`,
        );
        console.log(`  WETH: ${ethers.formatUnits(wethPrice, 18)} USD (Pyth ts=${wethAt})`);
    } catch (e) {
        console.log(
            `\nLive readback skipped — Pyth cache stale. Call PriceOracle.updatePriceFeeds(updateData) first to refresh.`,
        );
        console.log(`  reason: ${(e as Error).message}`);
    }

    console.log(`\nDone.`);
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
