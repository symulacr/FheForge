import { artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const CONTRACTS = [
  "StrategyRegistry",
  "StrategyVault",
  "LendingPool",
  "SwapRouter",
  "PriceOracle",
  "FheForgeComposer",
] as const;

async function main() {
  const abiDir = path.join(__dirname, "..", "..", "ui", "abis");
  fs.mkdirSync(abiDir, { recursive: true });
  for (const name of CONTRACTS) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(abiDir, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2),
    );
    console.log(`Exported ${name}.json`);
  }
  console.log(`Synced ${CONTRACTS.length} ABIs to ${abiDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
