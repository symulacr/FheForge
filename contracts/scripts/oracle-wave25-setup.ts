import { ethers } from "hardhat";
import deployments from "../deployments/421614.json";

interface TokenConfig {
  address: string;
  feedId: string; // hex string without 0x prefix
  decimals: number;
  collateralFactorMantissa: string;
}

const ORACLE_STALE_THRESHOLD = 86400n;

const CONFIGS: TokenConfig[] = [
  { address: "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32", feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", decimals: 18, collateralFactorMantissa: "0.80" }, // WETH
  { address: "0x150376EdEbc5AC48771655a61a795d828BeC8Df6", feedId: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", decimals: 6, collateralFactorMantissa: "0.90" }, // USDC
  { address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", feedId: "c9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33", decimals: 8, collateralFactorMantissa: "0.70" }, // WBTC
  { address: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", feedId: "3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5", decimals: 18, collateralFactorMantissa: "0.65" }, // ARB
  { address: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9", feedId: "8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221", decimals: 18, collateralFactorMantissa: "0.70" }, // LINK
  { address: "0x0165878A594ca255338adfa4d48449f69242Eb8F", feedId: "710659c5a68e2416ce4264ca8d50d34acc20041d91289110eea152c52ff3dc39", decimals: 18, collateralFactorMantissa: "0.85" }, // DAI
  { address: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6", feedId: "55f8289be7450f1ae564dd9798e49e7d797d89adbc54fe4f8c906b1fcb94b0c3", decimals: 18, collateralFactorMantissa: "0.60" }, // SOL
  { address: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788", feedId: "93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7", decimals: 18, collateralFactorMantissa: "0.65" }, // AVAX
  { address: "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0", feedId: "7eab5e260e42d81013207e623be60c66c9c55bfe0ace4797ad00d1c5a1335eae", decimals: 18, collateralFactorMantissa: "0.50" }, // DOGE
  { address: "0x9A676e781A523b5d0C0e43731313A708CB607508", feedId: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", decimals: 18, collateralFactorMantissa: "0.65" }, // UNI
  { address: "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1", feedId: "d54d8d4e3774ea53660e660ecd03aa9daa31eed9b7e67d1a2aed3095b3e6720d", decimals: 18, collateralFactorMantissa: "0.60" }, // OP
  { address: "0x68B1D87F95878fE05B998F19b66F4baba5De1aed", feedId: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", decimals: 18, collateralFactorMantissa: "0.50" }, // PYTH
  { address: "0xc6e7DF5E7b4f2A278906862b61205850344D4e7d", feedId: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", decimals: 18, collateralFactorMantissa: "0.70" }, // AAVE
  { address: "0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1", feedId: "c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750", decimals: 18, collateralFactorMantissa: "0.55" }, // NEAR
  { address: "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f", feedId: "b962539d0fcb272a494d65ea56f94851c2bcf8823935da05bd628916e2e9edbf", decimals: 18, collateralFactorMantissa: "0.60" }, // GMX
];

const ORACLE_ADDRESS = (deployments.contracts as Record<string, string>).PriceOracle;
if (!ORACLE_ADDRESS) throw new Error("PriceOracle not found in deployments");

const WETH_FEED = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const USDC_FEED = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

async function fetchHermesUpdates(feedIds: string[]): Promise<string[]> {
  const idsParam = feedIds.map((id) => `ids[]=${id}`).join("&");
  const resp = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${idsParam}`);
  if (!resp.ok) throw new Error(`Hermes fetch failed: ${resp.status}`);
  const data = (await resp.json()) as { binary?: { data?: string[] } };
  if (!data.binary?.data || data.binary.data.length === 0) {
    throw new Error("No update data in Hermes response");
  }
  return data.binary.data.map((d) => "0x" + d);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", ORACLE_ADDRESS, signer);

  console.log("Oracle at:", ORACLE_ADDRESS);
  console.log("Deployer:", await signer.getAddress());
  console.log("\n--- Registering Pyth sources via batchSetSources ---");

  const feeds = CONFIGS.map((c) => ({
    token: c.address,
    priceId: "0x" + c.feedId,
    decimals: c.decimals,
    staleThreshold: ORACLE_STALE_THRESHOLD,
  }));

  const setSourcesTx = await oracle.batchSetSources(feeds);
  await setSourcesTx.wait();
  console.log(`Registered ${feeds.length} Pyth sources`);

  console.log("\n--- Setting collateral factors ---");

  for (const cfg of CONFIGS) {
    const ltvBps = Math.round(parseFloat(cfg.collateralFactorMantissa) * 1e4);
    const liqBps = Math.min(ltvBps + 500, 10000);
    const setCfTx = await oracle.setCollateralFactor(cfg.address, ltvBps, liqBps);
    await setCfTx.wait();
    console.log(`  ${cfg.address.slice(0, 10)}... LTV=${ltvBps}bps liq=${liqBps}bps`);
  }

  console.log("\n--- Fetching WETH + USDC prices from Hermes ---");
  const updateDataList = await fetchHermesUpdates([WETH_FEED, USDC_FEED]);
  console.log(`Got ${updateDataList.length} update data blobs from Hermes`);

  const fee = await oracle.getPythUpdateFee.staticCall(updateDataList);
  console.log(`Estimated Pyth update fee: ${ethers.formatEther(fee)} ETH`);

  console.log("\n--- Pushing prices to oracle ---");
  const pushTx = await oracle.updatePriceFeeds(updateDataList, { value: fee });
  await pushTx.wait();
  console.log("Price update confirmed on-chain");

  console.log("\n--- Verifying prices ---");
  const wethPrice = await oracle.getPriceWithFallback(CONFIGS[0].address);
  const usdcPrice = await oracle.getPriceWithFallback(CONFIGS[1].address);
  console.log(`WETH price: ${ethers.formatEther(wethPrice)} WAD`);
  console.log(`USDC price: ${ethers.formatEther(usdcPrice)} WAD`);

  console.log("\n--- Oracle Wave25 setup complete ---");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
