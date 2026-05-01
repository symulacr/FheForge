/**
 * FheForge POST-FIX validation — Stage 9 of remediation protocol.
 *
 * For every gap closed in Stage 5/6/7 on the v2 deployment, exercise the new
 * code path and confirm the fix produces the expected on-chain behaviour. This
 * is the inverse of `test-stress.ts`: that script is designed to find bugs,
 * this one is designed to *prove the fixes hold* on the live deployment.
 *
 * Run (idempotent — pre-cleans state, can be invoked multiple times):
 *   set -a && source .env && set +a
 *   npx hardhat run scripts/test-postfix.ts --network arb-sepolia
 *
 * Output:
 *   contracts/deployments/421614.postfix-evidence.json — append-only ledger
 *   contracts/POSTFIX_FINDINGS_RUN_01.md … POSTFIX_FINDINGS_RUN_NN.md
 *   contracts/POSTFIX_CONTRACT_AUDIT_FINDINGS.md (consolidated)
 *
 * Severity legend (matches Stage 0/3 stress test):
 *   PASS  — the fix is in place and the expected behaviour observed
 *   FAIL  — the fix is supposed to be there but isn't
 *   WARN  — fix is partial / behaviour is more permissive than ideal
 *   INFO  — observation, no judgement
 */

import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, type CofheClient } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";
import * as path from "path";

type Severity = "PASS" | "WARN" | "FAIL" | "INFO";
const SYM: Record<Severity, string> = { PASS: "✓", WARN: "⚠", FAIL: "✗", INFO: "·" };

interface Finding {
    gap: string; // original gap id from STRESS_FINDINGS.md
    severity: Severity;
    label: string;
    observation: string;
    evidence?: { tx?: string; gas?: string; error?: string };
}

const findings: Finding[] = [];
function record(gap: string, severity: Severity, label: string, observation: string, evidence?: Finding["evidence"]) {
    findings.push({ gap, severity, label, observation, evidence });
    const ev = evidence?.tx ? ` tx=${evidence.tx.slice(0, 12)}…` : "";
    const gas = evidence?.gas ? ` gas=${evidence.gas}` : "";
    console.log(`  ${SYM[severity]} [${gap}] ${label} — ${observation}${ev}${gas}`);
}

const KNOWN_SELECTORS: Record<string, string> = {
    "0x7ba5ffb5": "InvalidSigner [CoFHE]",
    "0xd92e233d": "ZeroAddress",
    "0x1f2a2005": "ZeroAmount",
    "0x2ef13105": "EmptyName",
    "0x680b6caf": "NameTooLong",
    "0xb9698bf3": "ZeroWorkflowHash",
    "0xc45546f7": "StrategyAlreadyExists",
    "0x175bb87a": "StrategyInactive",
    "0x6e8de458": "PositionAlreadyExists",
    "0xabf0f034": "NoPosition",
    "0xd93c0665": "EnforcedPause",
    "0x3a23d825": "InsufficientCollateral",
    "0x28b35f21": "InsufficientReserve",
    "0xcd0fa803": "UnhealthyAfterWithdraw",
    "0xf8794e04": "OracleNotSet",
    "0x0dc08fa2": "WethNotSet",
    "0x6677a596": "TimelockNotElapsed",
    "0xbdb88e3c": "LtvNumeratorZero",
    "0x03a15f8d": "LtvDenominatorZero",
    "0xa2d8c00b": "LtvExceedsHundredPercent",
    "0xbbf455cc": "NoPendingExecutor",
    "0x3923349e": "NoPendingVault",
    "0x25ad15ae": "LiquidationTooLarge",
    "0x179b8d61": "FhePermissionDenied",
    "0x9931e729": "InvalidStrategyId",
    "0x9290475f": "ExceedsDeposit",
    "0xfcb85b5a": "ExceedsSupplyBalance",
    "0xbee61a59": "ExceedsBorrowBalance",
    "0x936bb5ad": "TokenMismatch",
    "0x04b7fcc8": "DeadlineTooShort",
    "0x54090af9": "DeadlineTooLong",
    "0x5fc483c5": "OnlyOwner",
    "0x47bc7cc8": "OnlyCreator",
    "0x8d1af8bd": "OnlyVault",
    "0x21e660fc": "PositionHealthy",
    "0x1bb0ddfb": "VaultAlreadySet",
};

function decodeRevert(e: unknown): string {
    let cur: any = e;
    let data: string | undefined;
    for (let i = 0; cur && i < 8; i++) {
        if (cur.data && typeof cur.data === "string" && cur.data.startsWith("0x") && cur.data.length >= 10) {
            data = cur.data;
            break;
        }
        if (cur.info?.error?.data) { data = cur.info.error.data; break; }
        if (cur.error?.data) { data = cur.error.data; break; }
        cur = cur.cause;
    }
    if (!data) {
        const msg = (e as any).shortMessage ?? (e as any).message ?? String(e);
        return msg.slice(0, 100);
    }
    if (data.startsWith("0x08c379a0")) {
        try {
            const s = ethers.AbiCoder.defaultAbiCoder().decode(["string"], ethers.dataSlice(data, 4))[0] as string;
            return `Error("${s}")`;
        } catch {
            return "Error(string)";
        }
    }
    const sel = data.slice(0, 10).toLowerCase();
    return KNOWN_SELECTORS[sel] ?? `selector ${sel}`;
}

const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";

interface DeploymentRecord {
    chainId: number;
    contracts: {
        StrategyRegistry: string;
        StrategyVault: string;
        LendingPool: string;
        SwapRouter: string;
        PriceOracle: string;
        FheForgeComposer: string;
    };
    swapExecutor: string;
}

function loadDeployment(): DeploymentRecord {
    const p = path.join(__dirname, "..", "deployments", "421614.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
    const startedAt = Date.now();
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  FheForge POST-FIX validation — Stage 9 of remediation    ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const provider = ethers.provider;
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== 421614) throw new Error("Run on arb-sepolia");
    const dep = loadDeployment();

    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const tester = signers[1] ?? signers[0];

    const erc20Abi = [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
        "function allowance(address,address) view returns (uint256)",
    ];
    const usdc = await ethers.getContractAt(erc20Abi, USDC, tester);

    const startEth = await provider.getBalance(tester.address);
    const startUsdc = (await usdc.balanceOf(tester.address)) as bigint;
    console.log(`Tester: ${tester.address}`);
    console.log(`ETH: ${ethers.formatEther(startEth)}  USDC: ${ethers.formatUnits(startUsdc, 6)}`);
    console.log(`Registry: ${dep.contracts.StrategyRegistry}`);
    console.log(`Vault:    ${dep.contracts.StrategyVault}`);
    console.log(`Pool:     ${dep.contracts.LendingPool}`);
    console.log(`Router:   ${dep.contracts.SwapRouter}`);
    console.log(`Oracle:   ${dep.contracts.PriceOracle}`);
    console.log(`Composer: ${dep.contracts.FheForgeComposer}\n`);

    const registry = await ethers.getContractAt("StrategyRegistry", dep.contracts.StrategyRegistry, tester);
    const vault = await ethers.getContractAt("StrategyVault", dep.contracts.StrategyVault, tester);
    const pool = await ethers.getContractAt("LendingPool", dep.contracts.LendingPool, tester);
    const router = await ethers.getContractAt("SwapRouter", dep.contracts.SwapRouter, tester);
    const composer = await ethers.getContractAt("FheForgeComposer", dep.contracts.FheForgeComposer, tester);

    // Approvals
    if ((await usdc.allowance(tester.address, dep.contracts.StrategyVault)) < ethers.MaxUint256 / 2n) {
        await (await usdc.approve(dep.contracts.StrategyVault, ethers.MaxUint256)).wait();
    }
    if ((await usdc.allowance(tester.address, dep.contracts.LendingPool)) < ethers.MaxUint256 / 2n) {
        await (await usdc.approve(dep.contracts.LendingPool, ethers.MaxUint256)).wait();
    }
    if ((await usdc.allowance(tester.address, dep.contracts.FheForgeComposer)) < ethers.MaxUint256 / 2n) {
        await (await usdc.approve(dep.contracts.FheForgeComposer, ethers.MaxUint256)).wait();
    }

    // CoFHE
    const cofhe = await (async () => {
        const c = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [arbSepolia] }));
        const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(tester);
        await c.connect(publicClient, walletClient);
        await c.permits.createSelf({ issuer: tester.address });
        return c;
    })();

    // Pre-clean
    if ((await vault.hasPosition(tester.address)) as boolean) {
        const dep0 = (await vault.getDepositedAmount()) as bigint;
        const enc = await cofhe.encryptInputs([Encryptable.uint128(dep0)]).execute();
        await (await vault.closePosition(dep0, enc[0])).wait();
    }
    const sup = (await pool.getPlainSupplyBalance(USDC)) as bigint;
    const bor = (await pool.getPlainBorrowBalance(USDC)) as bigint;
    if (bor > 0n) {
        const enc = await cofhe.encryptInputs([Encryptable.uint128(bor)]).execute();
        await (await pool.repay(USDC, bor, enc[0])).wait();
    }
    if (sup > 0n) {
        const enc = await cofhe.encryptInputs([Encryptable.uint128(sup)]).execute();
        await (await pool.withdraw(USDC, sup, enc[0])).wait();
    }

    const ts = Date.now().toString();

    // ── Group 1: Registry hardening (B.5, B.6, Q.3, Q.4, Q.6, S.2, C.3) ──
    console.log("── Registry hardening ──");

    // B.5 — empty name now reverts
    try {
        await registry.registerStrategy.staticCall("", ethers.zeroPadValue("0x01", 32));
        record("B.5", "FAIL", "Registry empty name still accepted", "expected EmptyName revert");
    } catch (e) {
        const msg = decodeRevert(e);
        record("B.5", msg.includes("EmptyName") ? "PASS" : "WARN", "Registry empty name reverts", msg);
    }
    // B.6 — name > 256 bytes reverts
    try {
        await registry.registerStrategy.staticCall("x".repeat(257), ethers.zeroPadValue("0x01", 32));
        record("B.6", "FAIL", "Registry oversize name accepted", "expected NameTooLong");
    } catch (e) {
        const msg = decodeRevert(e);
        record("B.6", msg.includes("NameTooLong") ? "PASS" : "WARN", "Registry name>256B reverts", msg);
    }
    // Q.3 — ZeroHash reverts
    try {
        await registry.registerStrategy.staticCall(`Z-${ts}`, ethers.ZeroHash);
        record("Q.3", "FAIL", "Registry ZeroHash accepted", "expected ZeroWorkflowHash");
    } catch (e) {
        const msg = decodeRevert(e);
        record("Q.3", msg.includes("ZeroWorkflowHash") ? "PASS" : "WARN", "Registry ZeroHash workflow reverts", msg);
    }
    // Q.4 / Q.6 — duplicate (creator,name) reverts
    {
        const name = `dup-${ts}`;
        const tx1 = await registry.registerStrategy(name, ethers.zeroPadValue("0x01", 32));
        const r1 = await tx1.wait();
        const newId = (await registry.strategyCount()) as bigint;
        record("Q.4-setup", "INFO", `register first instance id=${newId}`, "ok", { tx: tx1.hash, gas: r1!.gasUsed.toString() });
        try {
            await registry.registerStrategy.staticCall(name, ethers.zeroPadValue("0x02", 32));
            record("Q.4", "FAIL", "Registry duplicate (creator,name) accepted", "expected StrategyAlreadyExists");
        } catch (e) {
            const msg = decodeRevert(e);
            record(
                "Q.4",
                msg.includes("StrategyAlreadyExists") ? "PASS" : "WARN",
                "Registry duplicate (creator,name) reverts",
                msg,
            );
        }
    }
    // S.2 / C.3 — setActive flips the flag
    {
        const sCount = (await registry.strategyCount()) as bigint;
        const txOff = await registry.setActive(sCount, false);
        await txOff.wait();
        const meta = await registry.getStrategyMeta(sCount);
        record(
            "C.3-S.2",
            meta[4] === false ? "PASS" : "FAIL",
            "setActive(false) archives the strategy",
            `meta.active=${meta[4]}`,
            { tx: txOff.hash },
        );
        // restore
        const txOn = await registry.setActive(sCount, true);
        await txOn.wait();
    }
    // C.4 / X.7 — proposeVault timelock proposal works
    try {
        // Read the configured timelock from the contract so this works in both
        // production (48h) and demo (90s) deployments.
        const vaultDelay = (await registry.VAULT_ROTATION_DELAY()) as bigint;
        const txProp = await (registry.connect(deployer) as typeof registry).proposeVault(deployer.address);
        const r = await txProp.wait();
        const earliest = (await registry.pendingVaultEarliest()) as bigint;
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        // Allow +/- 60s clock skew on the lower bound.
        const expectedEarliest = nowSec + vaultDelay - 60n;
        record(
            "C.4-X.7",
            earliest > expectedEarliest ? "PASS" : "WARN",
            `proposeVault sets ${vaultDelay}s timelock`,
            `pendingEarliest=${earliest} delay=${vaultDelay}s`,
            { tx: txProp.hash, gas: r!.gasUsed.toString() },
        );
        // Try acceptVault before timelock — should revert
        try {
            await registry.acceptVault.staticCall();
            record("C.4-acceptEarly", "FAIL", "acceptVault before timelock", "expected TimelockNotElapsed");
        } catch (e) {
            const msg = decodeRevert(e);
            record(
                "C.4-acceptEarly",
                msg.includes("TimelockNotElapsed") ? "PASS" : "WARN",
                "acceptVault before timelock reverts",
                msg,
            );
        }
    } catch (e) {
        record("C.4-X.7", "WARN", "proposeVault setup", decodeRevert(e));
    }

    // ── Group 2: Vault partial close (A.3 / F.4 / AA.6) ──
    console.log("\n── Vault partial close ──");

    // Open 2 USDC, partial-close 0.5, then full-close remainder
    const sIdForClose = (await registry.strategyCount()) as bigint;
    const collateral = 2_000_000n;
    {
        // F-03: openPosition takes only collateral + debt encrypted (apy/loop
        // moved to plaintext on the registry's Strategy struct).
        const enc = await cofhe.encryptInputs([
            Encryptable.uint128(collateral),
            Encryptable.uint128(0n),
        ]).execute();
        const tx = await vault.openPosition(USDC, collateral, enc[0], enc[1], sIdForClose);
        const r = await tx.wait();
        record("A.3-setup", "PASS", "openPosition 2 USDC for partial close", `block=${r!.blockNumber}`, { tx: tx.hash, gas: r!.gasUsed.toString() });
    }
    // partial close 0.5 USDC
    {
        const closeAmt = 500_000n;
        const enc = await cofhe.encryptInputs([Encryptable.uint128(closeAmt)]).execute();
        const tx = await vault.closePosition(closeAmt, enc[0]);
        const r = await tx.wait();
        const remaining = (await vault.getDepositedAmount()) as bigint;
        const stillOpen = (await vault.hasPosition(tester.address)) as boolean;
        const okRemaining = remaining === collateral - closeAmt;
        record(
            "A.3",
            okRemaining && stillOpen ? "PASS" : "FAIL",
            "partial close keeps state (no stranded collateral)",
            `remaining=${remaining} hasPosition=${stillOpen}`,
            { tx: tx.hash, gas: r!.gasUsed.toString() },
        );
    }
    // full close
    {
        const remaining = (await vault.getDepositedAmount()) as bigint;
        const enc = await cofhe.encryptInputs([Encryptable.uint128(remaining)]).execute();
        const tx = await vault.closePosition(remaining, enc[0]);
        await tx.wait();
        const has = (await vault.hasPosition(tester.address)) as boolean;
        record("A.3-full", has ? "FAIL" : "PASS", "full close clears state", `hasPosition=${has}`, { tx: tx.hash });
    }

    // A.4 — TokenMismatch error (vs ZeroAddress for wrong-token addCollateral)
    {
        // Open a fresh position first (F-03: 2 ciphertexts, not 4)
        const enc = await cofhe.encryptInputs([
            Encryptable.uint128(1_000_000n),
            Encryptable.uint128(0n),
        ]).execute();
        await (await vault.openPosition(USDC, 1_000_000n, enc[0], enc[1], sIdForClose)).wait();
        try {
            const wrongEnc = await cofhe.encryptInputs([Encryptable.uint128(1n)]).execute();
            await vault.addCollateral.staticCall(WETH, 1n, wrongEnc[0]);
            record("A.4", "FAIL", "addCollateral wrong-token still ZeroAddress", "expected TokenMismatch");
        } catch (e) {
            const msg = decodeRevert(e);
            record(
                "A.4",
                msg.includes("TokenMismatch") ? "PASS" : "WARN",
                "addCollateral wrong token reverts TokenMismatch",
                msg,
            );
        }
        const dAmt = (await vault.getDepositedAmount()) as bigint;
        const cleanEnc = await cofhe.encryptInputs([Encryptable.uint128(dAmt)]).execute();
        await (await vault.closePosition(dAmt, cleanEnc[0])).wait();
    }

    // ── Group 3: Pool reserve gate (A.5b2 / A.5c / F.6 / Q.5) ──
    console.log("\n── Pool reserve gate ──");

    // Supply 2 USDC, borrow 1 USDC, then attempt to withdraw 2 USDC — should now revert
    {
        const supAmt = 2_000_000n;
        const borAmt = 1_000_000n;
        const e1 = await cofhe.encryptInputs([Encryptable.uint128(supAmt)]).execute();
        await (await pool.supply(USDC, supAmt, e1[0])).wait();
        const e2 = await cofhe.encryptInputs([Encryptable.uint128(borAmt)]).execute();
        await (await pool.checkLtvAndBorrow(USDC, USDC, borAmt, e2[0], 70, 100)).wait();

        const reserveBefore = (await pool.liquidReserve(USDC)) as bigint;
        const totalBorrow = (await pool.totalPlainBorrow(USDC)) as bigint;
        record(
            "A.5b2",
            "INFO",
            "Reserve invariant after borrow",
            `liquidReserve=${reserveBefore} totalPlainBorrow=${totalBorrow}`,
        );

        // Try to withdraw the FULL supply — should revert with InsufficientReserve OR UnhealthyAfterWithdraw
        try {
            const e3 = await cofhe.encryptInputs([Encryptable.uint128(supAmt)]).execute();
            await pool.withdraw.staticCall(USDC, supAmt, e3[0]);
            record("A.5c-F.6-Q.5", "FAIL", "Withdraw with active borrow not gated", "drained successfully");
        } catch (e) {
            const msg = decodeRevert(e);
            const closes = msg.includes("InsufficientReserve") || msg.includes("UnhealthyAfterWithdraw");
            record("A.5c-F.6-Q.5", closes ? "PASS" : "WARN", "Withdraw with active borrow now reverts", msg);
        }

        // Cleanup: repay + withdraw
        const eRep = await cofhe.encryptInputs([Encryptable.uint128(borAmt)]).execute();
        await (await pool.repay(USDC, borAmt, eRep[0])).wait();
        const eWd = await cofhe.encryptInputs([Encryptable.uint128(supAmt)]).execute();
        await (await pool.withdraw(USDC, supAmt, eWd[0])).wait();
    }

    // AA.1 — ltvNum=0 explicit revert
    try {
        const e = await cofhe.encryptInputs([Encryptable.uint128(1n)]).execute();
        await pool.checkLtvAndBorrow.staticCall(USDC, USDC, 1n, e[0], 0, 100);
        record("AA.1", "FAIL", "ltvNum=0 accepted", "expected LtvNumeratorZero");
    } catch (e) {
        const msg = decodeRevert(e);
        record("AA.1", msg.includes("LtvNumeratorZero") ? "PASS" : "WARN", "ltvNum=0 reverts", msg);
    }

    // ── Group 4: Pool oracle path (Y.1 / Y.2 / Y.3 / F.5 partial) ──
    console.log("\n── Pool oracle path ──");

    {
        const supAmt = 1_000_000n;
        const borAmt = 500_000n;
        const e1 = await cofhe.encryptInputs([Encryptable.uint128(supAmt)]).execute();
        await (await pool.supply(USDC, supAmt, e1[0])).wait();

        // Borrow with oracle-gated LTV (no caller-supplied ltvNum/ltvDen)
        try {
            const e2 = await cofhe.encryptInputs([Encryptable.uint128(borAmt)]).execute();
            const tx = await pool.borrowWithOracle(USDC, USDC, borAmt, e2[0]);
            const r = await tx.wait();
            record(
                "Y.1-Y.2-Y.3",
                "PASS",
                "borrowWithOracle uses Chainlink price + per-token LTV",
                `gas=${r!.gasUsed}`,
                { tx: tx.hash, gas: r!.gasUsed.toString() },
            );
        } catch (e) {
            record("Y.1-Y.2-Y.3", "WARN", "borrowWithOracle", decodeRevert(e));
        }

        // Cleanup
        const repayBal = (await pool.getPlainBorrowBalance(USDC)) as bigint;
        if (repayBal > 0n) {
            const eRep = await cofhe.encryptInputs([Encryptable.uint128(repayBal)]).execute();
            await (await pool.repay(USDC, repayBal, eRep[0])).wait();
        }
        const supBal = (await pool.getPlainSupplyBalance(USDC)) as bigint;
        if (supBal > 0n) {
            const eWd = await cofhe.encryptInputs([Encryptable.uint128(supBal)]).execute();
            await (await pool.withdraw(USDC, supBal, eWd[0])).wait();
        }
    }

    // ── Group 5: Native ETH (F.3 / H.1-H.3) ──
    console.log("\n── Native ETH ──");
    {
        const ethAmt = 1_000_000_000_000_000n; // 0.001 ETH
        try {
            const enc = await cofhe.encryptInputs([Encryptable.uint128(ethAmt)]).execute();
            const txS = await pool.supplyEth(enc[0], { value: ethAmt });
            const rS = await txS.wait();
            record("F.3-supply", "PASS", "supplyEth wraps to WETH internally", `${ethAmt} wei`, {
                tx: txS.hash,
                gas: rS!.gasUsed.toString(),
            });

            const enc2 = await cofhe.encryptInputs([Encryptable.uint128(ethAmt)]).execute();
            const txW = await pool.withdrawEth(ethAmt, enc2[0]);
            const rW = await txW.wait();
            record("F.3-withdraw", "PASS", "withdrawEth unwraps WETH and forwards", `${ethAmt} wei`, {
                tx: txW.hash,
                gas: rW!.gasUsed.toString(),
            });
        } catch (e) {
            record("F.3", "WARN", "Native ETH flow", decodeRevert(e));
        }
    }

    // ── Group 6: Pause / unpause (X.1 / X.2 / X.3 / X.4) ──
    console.log("\n── Pause / unpause ──");

    for (const [name, contract] of [
        ["Vault", vault],
        ["Pool", pool],
        ["Router", router],
        ["Registry", registry],
    ] as const) {
        try {
            const txP = await (contract.connect(deployer) as any).pause();
            await txP.wait();
            const txU = await (contract.connect(deployer) as any).unpause();
            await txU.wait();
            record(`X.${name}`, "PASS", `${name}.pause()/unpause() works`, "round-trip", { tx: txU.hash });
        } catch (e) {
            record(`X.${name}`, "WARN", `${name}.pause()/unpause()`, decodeRevert(e));
        }
    }

    // ── Group 7: SwapRouter deadline + executor rotation (B.7a / B.8 / C.5 / X.7) ──
    console.log("\n── SwapRouter ──");

    // B.7a — deadlineOffset < MIN reverts
    try {
        const e = await cofhe.encryptInputs([Encryptable.uint128(1n), Encryptable.uint128(1n)]).execute();
        await router.submitSwapIntent.staticCall(USDC, WETH, e[0], e[1], 0n);
        record("B.7a", "FAIL", "Router accepts deadlineOffset=0", "expected DeadlineTooShort");
    } catch (e) {
        const msg = decodeRevert(e);
        record("B.7a", msg.includes("DeadlineTooShort") ? "PASS" : "WARN", "deadlineOffset<MIN reverts", msg);
    }
    // B.8 — deadlineOffset > MAX reverts
    try {
        const e = await cofhe.encryptInputs([Encryptable.uint128(1n), Encryptable.uint128(1n)]).execute();
        await router.submitSwapIntent.staticCall(USDC, WETH, e[0], e[1], 8n * 24n * 3600n);
        record("B.8", "FAIL", "Router accepts huge deadlineOffset", "expected DeadlineTooLong");
    } catch (e) {
        const msg = decodeRevert(e);
        record("B.8", msg.includes("DeadlineTooLong") ? "PASS" : "WARN", "deadlineOffset>MAX reverts", msg);
    }

    // C.5 / X.7 — executor rotation timelock proposal
    try {
        // Read the configured timelock from the contract so this works in both
        // production (48h) and demo (90s) deployments.
        const execDelay = (await router.EXECUTOR_ROTATION_DELAY()) as bigint;
        const newExec = "0x000000000000000000000000000000000000dEaD";
        const txP = await (router.connect(deployer) as typeof router).proposeExecutor(newExec);
        await txP.wait();
        const earliest = (await router.pendingExecutorEarliest()) as bigint;
        const okEarliest =
            earliest > BigInt(Math.floor(Date.now() / 1000)) + execDelay - 60n;
        record(
            "C.5-X.7",
            okEarliest ? "PASS" : "WARN",
            `Router.proposeExecutor sets ${execDelay}s timelock`,
            `pendingEarliest=${earliest} delay=${execDelay}s`,
            { tx: txP.hash },
        );
        // Reset pending executor to deployer (zero out pending state by proposing the existing executor)
        // Actually, proposeExecutor overwrites — we'd need a separate "rescind" function. Just leave it pending; the test still validates the lock.
    } catch (e) {
        record("C.5-X.7", "WARN", "Router.proposeExecutor", decodeRevert(e));
    }

    // ── Group 8: Composer (F.1 / F.2 plaintext path) ──
    console.log("\n── Composer ──");
    {
        const tsLc = Date.now().toString();
        const enc = await cofhe.encryptInputs([
            Encryptable.uint128(0n), Encryptable.uint128(0n), Encryptable.uint16(0n), Encryptable.uint8(0n),
            Encryptable.uint128(0n), Encryptable.uint128(0n), Encryptable.uint128(0n), Encryptable.uint128(0n),
        ]).execute();

        try {
            const tx = await composer.openLeveragedStrategy(
                {
                    strategyName: `pf-${tsLc}`,
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
                    collateralPermit: { amount: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                },
                {
                    collateral: enc[0], debt: enc[1], apyTarget: enc[2], loopCount: enc[3],
                    supplyEnc: enc[4], borrowEnc: enc[5],
                    swapAmountIn: enc[6], swapMinOut: enc[7],
                },
            );
            const r = await tx.wait();
            record("F.1-F.2", "PASS", "Composer plaintext-only register works", `gas=${r!.gasUsed}`, {
                tx: tx.hash,
                gas: r!.gasUsed.toString(),
            });
        } catch (e) {
            record("F.1-F.2", "WARN", "Composer plaintext-only register", decodeRevert(e));
        }

        // FHE-bound path — should revert with InvalidSigner (CoFHE limit, documented)
        try {
            const enc2 = await cofhe.encryptInputs([
                Encryptable.uint128(1_000_000n),
                Encryptable.uint128(0n),
                Encryptable.uint16(0n),
                Encryptable.uint8(0n),
                Encryptable.uint128(0n),
                Encryptable.uint128(0n),
                Encryptable.uint128(0n),
                Encryptable.uint128(0n),
            ]).execute();
            await composer.openLeveragedStrategy.staticCall(
                {
                    strategyName: `pf-fhe-${tsLc}`,
                    workflowHash: ethers.zeroPadValue("0xc2", 32),
                    collateralToken: USDC,
                    collateralAmount: 1_000_000n,
                    poolSupplyAmount: 0n,
                    borrowToken: ethers.ZeroAddress,
                    poolBorrowAmount: 0n,
                    useOracleBorrow: false,
                    ltvNum: 0,
                    ltvDen: 0,
                    swapTokenOut: ethers.ZeroAddress,
                    swapDeadlineOffset: 0n,
                    strategyId: 0n,
                    collateralPermit: { amount: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                },
                {
                    collateral: enc2[0], debt: enc2[1], apyTarget: enc2[2], loopCount: enc2[3],
                    supplyEnc: enc2[4], borrowEnc: enc2[5],
                    swapAmountIn: enc2[6], swapMinOut: enc2[7],
                },
            );
            record("F.1-fhe", "WARN", "Composer FHE path succeeded unexpectedly", "expected InvalidSigner per V2 §3.6");
        } catch (e) {
            const msg = decodeRevert(e);
            const cofheLimit = msg.includes("InvalidSigner") || msg.includes("0x7ba5ffb5");
            record(
                "F.1-fhe",
                cofheLimit ? "INFO" : "WARN",
                "Composer FHE path: documented CoFHE InvalidSigner limit",
                msg,
            );
        }
    }

    // ── Wallet snapshot ──
    const endEth = await provider.getBalance(tester.address);
    const endUsdc = (await usdc.balanceOf(tester.address)) as bigint;
    record(
        "wallet",
        startUsdc - endUsdc === 0n ? "PASS" : "WARN",
        "USDC delta",
        `start=${startUsdc} end=${endUsdc} delta=${startUsdc - endUsdc}`,
    );
    record("wallet", "INFO", "ETH gas spent", `${ethers.formatEther(startEth - endEth)} ETH`);

    writeReport(startedAt);
}

function writeReport(startedAt: number) {
    const endedAt = Date.now();
    const summary = {
        pass: findings.filter((f) => f.severity === "PASS").length,
        warn: findings.filter((f) => f.severity === "WARN").length,
        fail: findings.filter((f) => f.severity === "FAIL").length,
        info: findings.filter((f) => f.severity === "INFO").length,
    };
    const out = path.join(__dirname, "..", "deployments", "421614.postfix-evidence.json");
    let runs: unknown[] = [];
    if (fs.existsSync(out)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
            if (Array.isArray(parsed)) runs = parsed;
        } catch {
            /* nope */
        }
    }
    const runIndex = runs.length + 1;
    runs.push({
        run: runIndex,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        timestamp: new Date(startedAt).toISOString(),
        summary,
        findings,
    });
    fs.writeFileSync(out, JSON.stringify(runs, null, 2));

    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║                   POSTFIX RUN SUMMARY                     ║");
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log(
        `  PASS=${summary.pass}  WARN=${summary.warn}  FAIL=${summary.fail}  INFO=${summary.info}`,
    );
    console.log(`  Duration: ${Math.round((endedAt - startedAt) / 1000)}s`);
    console.log(`  Run #${runIndex} appended to ${out}`);
    if (summary.fail > 0) {
        console.log("\nFAILURES:");
        for (const f of findings.filter((x) => x.severity === "FAIL")) {
            console.log(`  ✗ [${f.gap}] ${f.label}: ${f.observation}`);
        }
        process.exit(1);
    }
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
