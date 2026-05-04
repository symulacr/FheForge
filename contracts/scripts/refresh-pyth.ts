










import { ethers } from "hardhat";
import * as hardhat from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface NetworkConfig {
    name: string;
    config: { chainId?: number };
}
const network: NetworkConfig = (hardhat as unknown as { network: NetworkConfig }).network;

const ETH_USD_PRICE_ID =
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const USDC_USD_PRICE_ID =
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

const HERMES = "https://hermes.pyth.network";

interface DeploymentRecord {
    contracts: { PriceOracle: string };
}

interface HermesResponse {
    binary: { encoding: string; data: string[] };
    parsed?: Array<{ id: string; price: { price: string; expo: number; conf: string } }>;
}

async function fetchHermes(priceIds: string[]): Promise<string[]> {
    const params = priceIds.map((id) => `ids[]=${id}`).join("&");
    const url = `${HERMES}/v2/updates/price/latest?${params}&encoding=hex`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Hermes ${r.status} ${r.statusText} for ${url}`);
    const json = (await r.json()) as HermesResponse;
    if (!json.binary?.data?.length) throw new Error(`Empty Hermes response: ${JSON.stringify(json)}`);
    return json.binary.data.map((d) => "0x" + d);
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

    const ids = [ETH_USD_PRICE_ID, USDC_USD_PRICE_ID];
    console.log(`Fetching Hermes VAA for ${ids.length} feeds…`);
    const updateData = await fetchHermes(ids);
    console.log(`  got ${updateData.length} VAA blobs (${updateData[0].length / 2} bytes each)`);

    const fee = (await oracle.getPythUpdateFee(updateData)) as bigint;
    console.log(`Pyth update fee: ${ethers.formatEther(fee)} ETH`);

    console.log(`Submitting PriceOracle.updatePriceFeeds via ${oracleAddr}…`);
    const tx = await oracle.updatePriceFeeds(updateData, { value: fee });
    console.log(`  tx: ${tx.hash}`);
    await tx.wait();


    const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
    const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
    const [usdcPrice, usdcAt] = await oracle.getPriceUsd(USDC);
    const [wethPrice, wethAt] = await oracle.getPriceUsd(WETH);
    console.log(`\nLive readback:`);
    console.log(`  USDC: ${ethers.formatUnits(usdcPrice, 18)} USD (Pyth ts=${usdcAt})`);
    console.log(`  WETH: ${ethers.formatUnits(wethPrice, 18)} USD (Pyth ts=${wethAt})`);
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
