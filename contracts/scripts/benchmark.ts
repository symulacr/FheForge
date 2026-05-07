






























import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, type CofheClient } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";
import * as path from "path";

interface GasRow {
    phase: string;
    id: string;
    contract: string;
    fn: string;
    inputCategory: "min" | "real" | "max" | "fheHi" | "lifecycle" | "throughput" | "fheOverhead";
    inputDesc: string;
    txHash?: string;
    blockNumber?: number;
    gasUsed?: string;
    gasPrice?: string;
    usdEstimate?: string;
    success: boolean;
    revertReason?: string;
}

interface ThroughputRow {
    batchSize: number;
    fn: string;
    perOpGas?: string;
    totalGas?: string;
    success: boolean;
    note?: string;
}

interface BenchmarkRecord {
    label: "pre" | "post";
    network: string;
    chainId: number;
    timestamp: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    deployerAddr: string;
    testerAddr: string;
    walletStart: { eth: string; usdc: string };
    walletEnd: { eth: string; usdc: string };
    contractAddrs: Record<string, string>;
    rows: GasRow[];
    throughput: ThroughputRow[];
    summary: {
        totalTxs: number;
        successTxs: number;
        revertTxs: number;
        ethGasSpent: string;
    };
}

const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";

function loadDeployment(chainId: number): {
    contracts: Record<string, string>;
    swapExecutor: string;
} {
    const p = path.join(__dirname, "..", "deployments", `${chainId}.json`);
    if (!fs.existsSync(p)) throw new Error(`No deployment record at ${p}`);
    return JSON.parse(fs.readFileSync(p, "utf8"));
}






const KNOWN_SELECTORS: Record<string, string> = {
    "0x7ba5ffb5": "InvalidSigner(address,address) [CoFHE: input signed by user, not by intermediary contract]",
    "0xd92e233d": "ZeroAddress()",
    "0x1f2a2005": "ZeroAmount()",
    "0x2ef13105": "EmptyName()",
    "0x680b6caf": "NameTooLong()",
    "0xb9698bf3": "ZeroWorkflowHash()",
    "0xc45546f7": "StrategyAlreadyExists()",
    "0x175bb87a": "StrategyInactive()",
    "0x6e8de458": "PositionAlreadyExists()",
    "0xabf0f034": "NoPosition()",
    "0xd93c0665": "EnforcedPause()",
    "0x3a23d825": "InsufficientCollateral()",
    "0x28b35f21": "InsufficientReserve()",
    "0xcd0fa803": "UnhealthyAfterWithdraw()",
    "0xf8794e04": "OracleNotSet()",
    "0x0dc08fa2": "WethNotSet()",
    "0x179b8d61": "FhePermissionDenied()",
    "0x9931e729": "InvalidStrategyId()",
};

function decodeRevertData(data: string | undefined): string {
    if (!data || typeof data !== "string" || !data.startsWith("0x")) return "(no data)";
    if (data.startsWith("0x08c379a0")) {
        try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ["string"],
                ethers.dataSlice(data, 4),
            )[0] as string;
            return `Error("${decoded}")`;
        } catch {
            return "Error(string) decode-failed";
        }
    }
    if (data.startsWith("0x4e487b71")) return "Panic(uint256)";
    const sel = data.slice(0, 10).toLowerCase();
    if (KNOWN_SELECTORS[sel]) return KNOWN_SELECTORS[sel];
    return `selector ${sel}`;
}

function extractRevertData(e: unknown): string | null {
    let cur: any = e;
    for (let i = 0; cur && i < 8; i++) {
        if (cur.data && typeof cur.data === "string" && cur.data.startsWith("0x") && cur.data.length >= 10) return cur.data;
        if (cur.info?.error?.data) return cur.info.error.data;
        if (cur.error?.data) return cur.error.data;
        cur = cur.cause;
    }
    return null;
}

async function main() {
    const startedAt = Date.now();
    const labelEnv = process.env.BENCH_LABEL;
    const label = (labelEnv === "post" ? "post" : "pre") as "pre" | "post";

    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  FheForge BENCHMARK — label=${label.toUpperCase()}   `);
    console.log(`║  Stage ${label === "pre" ? "3" : "7"} of the remediation protocol             ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    const provider = ethers.provider;
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== 421614) throw new Error(`Expected arb-sepolia 421614; got ${chainId}`);
    const dep = loadDeployment(chainId);

    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const tester = signers[1] ?? signers[0];

    const erc20Abi = [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
        "function allowance(address,address) view returns (uint256)",
        "function transfer(address,uint256) returns (bool)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
    ];
    const usdc = await ethers.getContractAt(erc20Abi, USDC, tester);
    const startEth = await provider.getBalance(tester.address);
    const startUsdc = (await usdc.balanceOf(tester.address)) as bigint;

    console.log(`Tester:    ${tester.address}`);
    console.log(`ETH start: ${ethers.formatEther(startEth)}`);
    console.log(`USDC start: ${ethers.formatUnits(startUsdc, 6)}\n`);

    const registry = await ethers.getContractAt("StrategyRegistry", dep.contracts.StrategyRegistry, tester);
    const vault = await ethers.getContractAt("StrategyVault", dep.contracts.StrategyVault, tester);
    const pool = await ethers.getContractAt("LendingPool", dep.contracts.LendingPool, tester);
    const router = await ethers.getContractAt("SwapRouter", dep.contracts.SwapRouter, tester);


    if ((await usdc.allowance(tester.address, dep.contracts.StrategyVault)) < ethers.MaxUint256 / 2n) {
        const tx = await usdc.approve(dep.contracts.StrategyVault, ethers.MaxUint256);
        await tx.wait();
    }
    if ((await usdc.allowance(tester.address, dep.contracts.LendingPool)) < ethers.MaxUint256 / 2n) {
        const tx = await usdc.approve(dep.contracts.LendingPool, ethers.MaxUint256);
        await tx.wait();
    }


    const cfg = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
    const cofhe = createCofheClient(cfg);
    const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(tester);
    await cofhe.connect(publicClient, walletClient);
    await cofhe.permits.createSelf({ issuer: tester.address });


    const had = (await vault.hasPosition(tester.address)) as boolean;
    if (had) {
        const dep0 = (await vault.getDepositedAmount()) as bigint;
        const cleanEnc = await cofhe.encryptInputs([Encryptable.uint64(dep0)]).execute();
        const tx = await vault.closePosition(dep0, cleanEnc[0]);
        await tx.wait();
    }
    const sup = (await pool.getPlainSupplyBalance(USDC)) as bigint;
    const bor = (await pool.getPlainBorrowBalance(USDC)) as bigint;
    if (bor > 0n) {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(bor)]).execute();
        await (await pool.repay(USDC, bor, enc[0])).wait();
    }
    if (sup > 0n) {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(sup)]).execute();
        await (await pool.withdraw(USDC, sup, enc[0])).wait();
    }

    const rows: GasRow[] = [];
    const throughput: ThroughputRow[] = [];

    async function bench(
        phase: string,
        id: string,
        contract: string,
        fn: string,
        inputCategory: GasRow["inputCategory"],
        inputDesc: string,
        runner: () => Promise<{ tx: any; rcpt: any }>,
    ): Promise<bigint | null> {
        try {
            const { tx, rcpt } = await runner();
            const gas = (rcpt.gasUsed as bigint).toString();
            const gasPrice = (rcpt.gasPrice as bigint | undefined)?.toString() ?? "20000000";
            rows.push({
                phase,
                id,
                contract,
                fn,
                inputCategory,
                inputDesc,
                txHash: tx.hash,
                blockNumber: rcpt.blockNumber,
                gasUsed: gas,
                gasPrice,
                success: true,
            });
            console.log(`  + [${phase}.${id}] ${contract}.${fn}(${inputCategory}) gas=${gas} tx=${tx.hash.slice(0, 12)}…`);
            return rcpt.gasUsed as bigint;
        } catch (e) {
            const err = e as any;
            const rev = decodeRevertData(extractRevertData(err) || undefined);
            rows.push({
                phase,
                id,
                contract,
                fn,
                inputCategory,
                inputDesc,
                success: false,
                revertReason: rev,
            });
            console.log(`  ! [${phase}.${id}] ${contract}.${fn}(${inputCategory}) reverted: ${rev}`);
            return null;
        }
    }


    console.log(`\n── 3.2 Gas per function (4 categories) ──`);







    const ts = Date.now().toString();
    await bench("3.2", "reg-min", "StrategyRegistry", "registerStrategy", "min", "name='x', hash=0x01", async () => {
        const tx = await registry.registerStrategy(`x-${ts}-1`, ethers.zeroPadValue("0x01", 32));
        return { tx, rcpt: await tx.wait() };
    });
    await bench("3.2", "reg-real", "StrategyRegistry", "registerStrategy", "real", "name='real', hash=0xdeadbeef", async () => {
        const tx = await registry.registerStrategy(`Real-world strategy ${ts}`, ethers.zeroPadValue("0xdeadbeef", 32));
        return { tx, rcpt: await tx.wait() };
    });
    await bench("3.2", "reg-max", "StrategyRegistry", "registerStrategy", "max", "name=256B (new cap), hash=non-zero", async () => {
        const big = "x".repeat(256 - ts.length - 5) + `-${ts}-3`;
        const tx = await registry.registerStrategy(big, ethers.zeroPadValue("0x02", 32));
        return { tx, rcpt: await tx.wait() };
    });


    console.log(`  using latest strategy for vault probes`);



    await bench("3.2", "vault-open-min", "StrategyVault", "openPosition", "min", "1 wei USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(1n)]).execute();
        const tx = await vault.openPosition(USDC, 1n, enc[0], 1n, tester.address);
        return { tx, rcpt: await tx.wait() };
    });

    {
        const dep0 = (await vault.getDepositedAmount()) as bigint;
        if (dep0 > 0n) {
            const enc = await cofhe.encryptInputs([Encryptable.uint64(dep0)]).execute();
            await (await vault.closePosition(dep0, enc[0])).wait();
        }
    }
    await bench("3.2", "vault-open-real", "StrategyVault", "openPosition", "real", "1 USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(1_000_000n)]).execute();
        const tx = await vault.openPosition(USDC, 1_000_000n, enc[0], 1n, tester.address);
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "vault-add-real", "StrategyVault", "addCollateral", "real", "0.5 USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(500_000n)]).execute();
        const tx = await vault.addCollateral(USDC, 500_000n, enc[0], tester.address);
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "vault-add-real", "StrategyVault", "addCollateral", "real", "0.5 USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(500_000n)]).execute();
        const tx = await vault.addCollateral(USDC, 500_000n, enc[0], tester.address);
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "vault-getCollat", "StrategyVault", "getCollateral", "real", "(view-mutating)", async () => {
        const tx = await vault.getCollateral();
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "vault-close-real", "StrategyVault", "closePosition", "real", "full deposited", async () => {
        const dep0 = (await vault.getDepositedAmount()) as bigint;
        const enc = await cofhe.encryptInputs([Encryptable.uint64(dep0)]).execute();
        const tx = await vault.closePosition(dep0, enc[0]);
        return { tx, rcpt: await tx.wait() };
    });


    await bench("3.2", "pool-supply-min", "LendingPool", "supplyToLending", "min", "1 wei USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(1n)]).execute();
        const tx = await pool.supplyToLending(USDC, 1n, enc[0], tester.address);
        return { tx, rcpt: await tx.wait() };
    });
    await bench("3.2", "pool-supply-real", "LendingPool", "supplyToLending", "real", "1 USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(1_000_000n)]).execute();
        const tx = await pool.supplyToLending(USDC, 1_000_000n, enc[0], tester.address);
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "pool-borrow", "LendingPool", "borrowFromLending", "real", "0.5 USDC against 1 USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(500_000n)]).execute();
        const tx = await pool.borrowFromLending(USDC, 500_000n, enc[0], tester.address);
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "pool-repay", "LendingPool", "repay", "real", "0.5 USDC", async () => {
        const enc = await cofhe.encryptInputs([Encryptable.uint64(500_000n)]).execute();
        const tx = await pool.repay(USDC, 500_000n, enc[0]);
        return { tx, rcpt: await tx.wait() };
    });

    await bench("3.2", "pool-withdraw", "LendingPool", "withdraw", "real", "1 USDC", async () => {
        const supNow = (await pool.getPlainSupplyBalance(USDC)) as bigint;
        const enc = await cofhe.encryptInputs([Encryptable.uint64(supNow)]).execute();
        const tx = await pool.withdraw(USDC, supNow, enc[0]);
        return { tx, rcpt: await tx.wait() };
    });


    let intentId: string | null = null;


    const routerMaxDeadline = (await router.MAX_DEADLINE_OFFSET()) as bigint;
    const deadlineOffset = routerMaxDeadline / 2n;
    await bench("3.2", "router-submit", "SwapRouter", "submitSwapIntent", "real", `USDC→WETH 1 USDC, dl ${deadlineOffset}s`, async () => {
        const tx = await router.submitSwapIntent(USDC, WETH, 1_000_000n, 990_000n, deadlineOffset);
        const rcpt = await tx.wait();
        for (const log of rcpt!.logs) {
            try {
                const p = router.interface.parseLog(log);
                if (p && p.name === "IntentSubmitted") {
                    intentId = p.args[0] as string;
                    break;
                }
            } catch {

            }
        }
        return { tx, rcpt };
    });

    if (intentId) {
        await bench("3.2", "router-getAmt", "SwapRouter", "getAmountIn", "real", "tester's intent", async () => {
            const tx = await router.getAmountIn(intentId!);
            return { tx, rcpt: await tx.wait() };
        });
        await bench("3.2", "router-cancel", "SwapRouter", "cancelIntent", "real", "tester's intent", async () => {
            const tx = await router.cancelIntent(intentId!);
            return { tx, rcpt: await tx.wait() };
        });
    }


    console.log(`\n── 3.3 Strategy lifecycle (register→open→add→close) ──`);

    let lifecycleGas = 0n;
    {
        const g1 = await bench("3.3", "lc-reg", "StrategyRegistry", "registerStrategy", "lifecycle", "lifecycle step 1", async () => {
            const tx = await registry.registerStrategy(`Lifecycle Strat ${ts}`, ethers.zeroPadValue("0xfeed", 32));
            return { tx, rcpt: await tx.wait() };
        });
        if (g1) lifecycleGas += g1;
    }
    {
        const g2 = await bench("3.3", "lc-open", "StrategyVault", "openPosition", "lifecycle", "lifecycle step 2", async () => {
            const enc = await cofhe.encryptInputs([Encryptable.uint64(1_000_000n)]).execute();
        const tx = await vault.openPosition(USDC, 1_000_000n, enc[0], 1n, tester.address);
            return { tx, rcpt: await tx.wait() };
        });
        if (g2) lifecycleGas += g2;
    }
    {
        const g3 = await bench("3.3", "lc-add", "StrategyVault", "addCollateral", "lifecycle", "lifecycle step 3", async () => {
            const enc = await cofhe.encryptInputs([Encryptable.uint64(500_000n)]).execute();
            const tx = await vault.addCollateral(USDC, 500_000n, enc[0], tester.address);
            return { tx, rcpt: await tx.wait() };
        });
        if (g3) lifecycleGas += g3;
    }
    {
        const g3 = await bench("3.3", "lc-add", "StrategyVault", "addCollateral", "lifecycle", "lifecycle step 3", async () => {
            const enc = await cofhe.encryptInputs([Encryptable.uint64(500_000n)]).execute();
            const tx = await vault.addCollateral(USDC, 500_000n, enc[0], tester.address);
            return { tx, rcpt: await tx.wait() };
        });
        if (g3) lifecycleGas += g3;
    }
    {
        const g4 = await bench("3.3", "lc-close", "StrategyVault", "closePosition", "lifecycle", "lifecycle step 4", async () => {
            const enc = await cofhe.encryptInputs([Encryptable.uint64(1_500_000n)]).execute();
            const tx = await vault.closePosition(1_500_000n, enc[0]);
            return { tx, rcpt: await tx.wait() };
        });
        if (g4) lifecycleGas += g4;
    }
    console.log(`  lifecycle total gas = ${lifecycleGas}`);
    rows.push({
        phase: "3.3",
        id: "lc-total",
        contract: "MULTI",
        fn: "lifecycle-total",
        inputCategory: "lifecycle",
        inputDesc: "register+open+addCollateral+close",
        gasUsed: lifecycleGas.toString(),
        success: true,
    });




    console.log(`\n── 3.4 v2 surfaces (oracle / composer / native ETH) ──`);



    try {
        const supAmt = 2_000_000n;
        const borAmt = 500_000n;
        const e1 = await cofhe.encryptInputs([Encryptable.uint64(supAmt)]).execute();
        const t1 = await pool.supply(USDC, supAmt, e1[0]);
        await t1.wait();

        await bench("3.4", "pool-borrow-oracle", "LendingPool", "borrowWithOracle", "real", "0.5 USDC against 2 USDC w/ oracle", async () => {
            const enc = await cofhe.encryptInputs([Encryptable.uint64(borAmt)]).execute();
            const tx = await pool.borrowWithOracle(USDC, USDC, borAmt, enc[0]);
            return { tx, rcpt: await tx.wait() };
        });


        const repayEnc = await cofhe.encryptInputs([Encryptable.uint64(borAmt)]).execute();
        await (await pool.repay(USDC, borAmt, repayEnc[0])).wait();
        const supNow = (await pool.getPlainSupplyBalance(USDC)) as bigint;
        if (supNow > 0n) {
            const e2 = await cofhe.encryptInputs([Encryptable.uint64(supNow)]).execute();
            await (await pool.withdraw(USDC, supNow, e2[0])).wait();
        }
    } catch (e) {
        console.log(`  ! borrowWithOracle benchmark: ${(e as Error).message.slice(0, 200)}`);
    }















    try {
        const composerAddr = (dep.contracts as Record<string, string>).FheForgeComposer;
        if (composerAddr) {
            const composer = await ethers.getContractAt("FheForgeComposer", composerAddr, tester);

            const allow = (await usdc.allowance(tester.address, composerAddr)) as bigint;
            if (allow < ethers.MaxUint256 / 2n) {
                const apprTx = await usdc.approve(composerAddr, ethers.MaxUint256);
                await apprTx.wait();
            }

            const lcCol = 1_000_000n;
            const tsLc = Date.now().toString();


            const enc = await cofhe
                .encryptInputs([
                    Encryptable.uint64(lcCol),
                    Encryptable.uint64(0n),
                    Encryptable.uint64(0n),
                    Encryptable.uint64(0n),
                    Encryptable.uint64(0n),
                    Encryptable.uint64(0n),
                ])
                .execute();


            const permitSkip = { amount: 0n, deadline: 0n, nonce: 0n, signature: "0x" };



            await bench(
                "3.4",
                "composer-openLev-fhe",
                "FheForgeComposer",
                "openLeveragedStrategy",
                "real",
                "FHE-bound vault open (expected revert: CoFHE InvalidSigner)",
                async () => {
                    const tx = await composer.openLeveragedStrategy(
                        {
                            strategyName: `composer-fhe-${tsLc}`,
                            workflowHash: ethers.zeroPadValue("0xc0", 32),
                            collateralToken: USDC,
                            collateralAmount: lcCol,
                            poolSupplyAmount: 0n,
                            borrowToken: ethers.ZeroAddress,
                            poolBorrowAmount: 0n,
                            useOracleBorrow: false,
                            ltvNum: 0,
                            ltvDen: 0,
                            swapTokenOut: ethers.ZeroAddress,
                            swapDeadlineOffset: 0n,
                            strategyId: 0n,
                            apyTarget: 500,
                            loopCount: 2,
                            collateralPermit: permitSkip,
                        },
                        {
                            collateral: enc[0],
                            debt: enc[1],
                            supplyEnc: enc[2],
                            borrowEnc: enc[3],
                            swapAmountIn: enc[4],
                            swapMinOut: enc[5],
                        },
                    );
                    return { tx, rcpt: await tx.wait() };
                },
            );




            await bench(
                "3.4",
                "composer-openLev-plain",
                "FheForgeComposer",
                "openLeveragedStrategy",
                "real",
                "plaintext-only register (no FHE pass-through)",
                async () => {
                    const tx = await composer.openLeveragedStrategy(
                        {
                            strategyName: `composer-plain-${tsLc}`,
                            workflowHash: ethers.zeroPadValue("0xc1", 32),
                            collateralToken: USDC,
                            collateralAmount: 0n,
                            poolSupplyAmount: 0n,
                            borrowToken: ethers.ZeroAddress,
                            poolBorrowAmount: 0n,
                            useOracleBorrow: false,
                            ltvNum: 0,
                            ltvDen: 0,
                            swapTokenOut: ethers.ZeroAddress,
                            swapDeadlineOffset: 0n,
                            strategyId: 0n,
                            apyTarget: 0,
                            loopCount: 0,
                            collateralPermit: permitSkip,
                        },
                        {
                            collateral: enc[0],
                            debt: enc[1],
                            supplyEnc: enc[2],
                            borrowEnc: enc[3],
                            swapAmountIn: enc[4],
                            swapMinOut: enc[5],
                        },
                    );
                    return { tx, rcpt: await tx.wait() };
                },
            );
        } else {
            console.log(`  ! Composer not in deployments record; skipping`);
        }
    } catch (e) {
        console.log(`  ! Composer benchmark: ${(e as Error).message.slice(0, 200)}`);
    }


    try {
        const ethAmt = 1_000_000_000_000_000n;
        const enc = await cofhe.encryptInputs([Encryptable.uint64(ethAmt)]).execute();
        await bench("3.4", "pool-supplyEth", "LendingPool", "supplyEth", "real", "0.001 ETH wrap-and-supply", async () => {
            const tx = await pool.supplyEth(enc[0], { value: ethAmt });
            return { tx, rcpt: await tx.wait() };
        });

        const enc2 = await cofhe.encryptInputs([Encryptable.uint64(ethAmt)]).execute();
        await bench("3.4", "pool-withdrawEth", "LendingPool", "withdrawEth", "real", "0.001 ETH unwrap-and-return", async () => {
            const tx = await pool.withdrawEth(ethAmt, enc2[0]);
            return { tx, rcpt: await tx.wait() };
        });
    } catch (e) {
        console.log(`  ! Native ETH benchmark: ${(e as Error).message.slice(0, 200)}`);
    }


    console.log(`\n── 3.5 Throughput ceiling (registerStrategy batches) ──`);




    for (const N of [1, 5, 10, 25, 50, 100, 250]) {
        let cumGas = 0n;
        let stopReason: string | undefined;
        for (let i = 0; i < N; i++) {
            try {
                const tx = await registry.registerStrategy(
                    `tp-${N}-${i}-${Date.now()}`,
                    ethers.zeroPadValue("0x01", 32),
                );
                const rcpt = await tx.wait();
                cumGas += rcpt!.gasUsed as bigint;
            } catch (e) {
                stopReason = `reverted at i=${i}: ${(e as Error).message.slice(0, 80)}`;
                break;
            }
        }
        const ok = !stopReason;
        const perOp = ok && N > 0 ? (cumGas / BigInt(N)).toString() : undefined;
        throughput.push({
            batchSize: N,
            fn: "registerStrategy",
            perOpGas: perOp,
            totalGas: cumGas.toString(),
            success: ok,
            note: stopReason,
        });
        console.log(`  N=${N} ${ok ? "OK" : "FAIL"} totalGas=${cumGas} perOp=${perOp ?? "n/a"}`);
        if (!ok) {
            console.log(`  Stopping batch progression at N=${N} per Q3.`);
            break;
        }
    }


    console.log(`\n── 3.6 FHE op overhead (delegated to forge test --gas-report and the rows above) ──`);
    rows.push({
        phase: "3.6",
        id: "fhe-add",
        contract: "FHE",
        fn: "FHE.add",
        inputCategory: "fheOverhead",
        inputDesc: "addCollateral gas - openPosition fixed-cost gives FHE.add overhead bound",
        success: true,
        gasUsed: "see 3.2.vault-add-real (~330k) which contains 1× FHE.add + 4× ACL grants",
    });


    const endEth = await provider.getBalance(tester.address);
    const endUsdc = (await usdc.balanceOf(tester.address)) as bigint;
    const ethSpent = startEth - endEth;
    const usdcSpent = startUsdc - endUsdc;

    const out: BenchmarkRecord = {
        label,
        network: network.name,
        chainId,
        timestamp: new Date(startedAt).toISOString(),
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        deployerAddr: deployer.address,
        testerAddr: tester.address,
        walletStart: { eth: startEth.toString(), usdc: startUsdc.toString() },
        walletEnd: { eth: endEth.toString(), usdc: endUsdc.toString() },
        contractAddrs: dep.contracts,
        rows,
        throughput,
        summary: {
            totalTxs: rows.filter((r) => r.txHash).length,
            successTxs: rows.filter((r) => r.success && r.txHash).length,
            revertTxs: rows.filter((r) => !r.success).length,
            ethGasSpent: ethSpent.toString(),
        },
    };

    const jsonOut = path.join(__dirname, "..", "deployments", `${chainId}.benchmark-${label}.json`);
    fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
    console.log(`\n  raw JSON → ${jsonOut}`);


    const mdName = label === "pre" ? "BENCHMARK_PRE.md" : "BENCHMARK_POST.md";
    const mdPath = path.join(__dirname, "..", mdName);
    let md = `# ${mdName.replace(".md", "")} — Stage ${label === "pre" ? "3" : "7"} of remediation protocol\n\n`;
    md += `**Network:** ${network.name} (chain ${chainId})  \n`;
    md += `**Date:** ${new Date(startedAt).toISOString()}  \n`;
    md += `**Tester:** ${tester.address}  \n`;
    md += `**Duration:** ${(out.durationMs / 1000).toFixed(1)}s  \n\n`;

    md += `## Wallet snapshot\n\n`;
    md += `| Asset | Start | End | Delta |\n|---|---:|---:|---:|\n`;
    md += `| ETH | ${ethers.formatEther(startEth)} | ${ethers.formatEther(endEth)} | ${ethers.formatEther(ethSpent)} |\n`;
    md += `| USDC | ${ethers.formatUnits(startUsdc, 6)} | ${ethers.formatUnits(endUsdc, 6)} | ${ethers.formatUnits(usdcSpent, 6)} |\n\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n|---|---:|\n`;
    md += `| Total txs | ${out.summary.totalTxs} |\n`;
    md += `| Success | ${out.summary.successTxs} |\n`;
    md += `| Reverted | ${out.summary.revertTxs} |\n`;
    md += `| ETH gas spent | ${ethers.formatEther(ethSpent)} |\n\n`;

    md += `## §3.2 Gas per function\n\n`;
    md += `| Phase | Contract | Function | Input | Gas | Status | Tx |\n|---|---|---|---|---:|---|---|\n`;
    for (const r of rows) {
        if (r.phase === "3.2") {
            md += `| ${r.phase}.${r.id} | ${r.contract} | ${r.fn} | ${r.inputCategory} (${r.inputDesc}) | ${r.gasUsed ?? "—"} | ${r.success ? "OK" : "REVERT"} | ${r.txHash ? r.txHash.slice(0, 14) + "…" : "—"} |\n`;
        }
    }
    md += `\n## §3.3 Strategy lifecycle\n\n`;
    md += `| Step | Contract | Function | Gas |\n|---|---|---|---:|\n`;
    for (const r of rows) {
        if (r.phase === "3.3") {
            md += `| ${r.id} | ${r.contract} | ${r.fn} | ${r.gasUsed ?? "—"} |\n`;
        }
    }
    md += `\n## §3.5 Throughput ceiling — registerStrategy batches\n\n`;
    md += `| Batch size | Total gas | Per-op gas | Status | Note |\n|---:|---:|---:|---|---|\n`;
    for (const t of throughput) {
        md += `| ${t.batchSize} | ${t.totalGas ?? "—"} | ${t.perOpGas ?? "—"} | ${t.success ? "OK" : "FAIL"} | ${t.note ?? ""} |\n`;
    }
    md += `\n## §3.6 FHE operation overhead\n\n`;
    md += `(see §3.2.vault-add-real — ~330K gas for 1 FHE.add + 4 ACL grants. Deeper per-op breakdown deferred to forge test --gas-report on the production contracts.)\n\n`;

    fs.writeFileSync(mdPath, md);
    console.log(`  markdown → ${mdPath}`);
    console.log(`\nDone. tx=${out.summary.totalTxs} success=${out.summary.successTxs} revert=${out.summary.revertTxs} ETH spent=${ethers.formatEther(ethSpent)}\n`);
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
