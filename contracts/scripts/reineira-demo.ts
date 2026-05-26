























import { ethers } from "ethers";
import { ReineiraSDK, TESTNET_ADDRESSES, formatUsdc } from "@reineira-os/sdk";
import * as fs from "fs";
import * as path from "path";

interface DemoEvidence {
    network: string;
    chainId: number;
    timestamp: string;
    tester: string;
    reineiraAddresses: typeof TESTNET_ADDRESSES;
    balances: {
        eth: string;
        plainUsdc: string;
        plainUsdcFmt: string;
        confidentialUsdcHandle: string;
        governanceToken: string;
    };
    escrowDemo?: {
        attempted: boolean;
        escrowId?: string;
        createTxHash?: string;
        createGas?: string;
        error?: string;
    };
}

async function main() {
    const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
    if (!rpcUrl) throw new Error("ARBITRUM_SEPOLIA_RPC_URL not set in environment.");
    const testerKey = process.env.TESTER1_PRIVATE_KEY;
    if (!testerKey) throw new Error("TESTER1_PRIVATE_KEY not set in environment.");
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const tester = new ethers.Wallet(testerKey, provider);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== 421614) {
        throw new Error(`Reineira testnet is on arb-sepolia 421614; got chainId ${chainId}`);
    }

    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  Reineira-OS SDK demo — track C of remediation protocol   ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    console.log(`Tester:  ${tester.address}`);
    console.log(`Chain:   arb-sepolia (${chainId})\n`);


    const sdk = ReineiraSDK.create({
        network: "testnet",
        signer: tester,
    });
    await sdk.initialize();
    console.log(`SDK initialised. addresses snapshot:\n`);
    for (const [k, v] of Object.entries(TESTNET_ADDRESSES)) {
        console.log(`  ${k.padEnd(28, " ")} ${v}`);
    }


    const erc20Abi = [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
    ];
    const usdc = new ethers.Contract(TESTNET_ADDRESSES.usdc, erc20Abi, tester);
    const conf = new ethers.Contract(TESTNET_ADDRESSES.confidentialUSDC, erc20Abi, tester);
    const gov = new ethers.Contract(TESTNET_ADDRESSES.governanceToken, erc20Abi, tester);

    const eth = await provider.getBalance(tester.address);
    const plainUsdc = (await usdc.balanceOf(tester.address)) as bigint;
    let confHandle: bigint;
    try {
        confHandle = (await conf.balanceOf(tester.address)) as bigint;
    } catch (e) {
        confHandle = 0n;
        console.log(`  (confidentialUSDC.balanceOf failed: ${(e as Error).message.slice(0, 80)})`);
    }
    let govBal: bigint;
    try {
        govBal = (await gov.balanceOf(tester.address)) as bigint;
    } catch (e) {
        govBal = 0n;
    }

    console.log(`\nTester balances:`);
    console.log(`  ETH                    ${ethers.formatEther(eth)}`);
    console.log(`  USDC (plain)           ${formatUsdc(plainUsdc)} (${plainUsdc} base units)`);
    console.log(`  cUSDC (FHE handle)     ${confHandle === 0n ? "(uninitialised)" : confHandle.toString()}`);
    console.log(`  REINEIRA governance    ${govBal}`);

    const evidence: DemoEvidence = {
        network: network.name,
        chainId,
        timestamp: new Date().toISOString(),
        tester: tester.address,
        reineiraAddresses: TESTNET_ADDRESSES,
        balances: {
            eth: eth.toString(),
            plainUsdc: plainUsdc.toString(),
            plainUsdcFmt: formatUsdc(plainUsdc),
            confidentialUsdcHandle: confHandle.toString(),
            governanceToken: govBal.toString(),
        },
    };


    if (process.env.REINEIRA_DEMO_ESCROW === "1") {
        evidence.escrowDemo = { attempted: true };
        try {
            console.log(`\nCreating a 0.5 USDC escrow (recipient = tester)…`);
            const amount = sdk.usdc(0.5);
            const escrow = await sdk.escrow.create({
                amount,
                owner: tester.address,
            });
            evidence.escrowDemo.escrowId = escrow.id.toString();
            evidence.escrowDemo.createTxHash = escrow.createTx?.hash;
            evidence.escrowDemo.createGas = escrow.createTx?.gasUsed?.toString();
            console.log(
                `  escrow id=${escrow.id}  tx=${escrow.createTx?.hash?.slice(0, 14)}…  gas=${escrow.createTx?.gasUsed}`,
            );
            const exists = await escrow.exists();
            console.log(`  escrow.exists() = ${exists}`);
        } catch (e) {
            const msg = (e as Error).message;
            evidence.escrowDemo.error = msg.slice(0, 400);
            console.log(`  escrow.create() failed: ${msg.slice(0, 200)}`);
        }
    } else {
        console.log(
            `\n(set REINEIRA_DEMO_ESCROW=1 to also create a live test escrow)`,
        );
    }

    const out = path.join(__dirname, "..", "deployments", "reineira-demo-evidence.json");
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    console.log(`\nEvidence written to ${out}\n`);
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
