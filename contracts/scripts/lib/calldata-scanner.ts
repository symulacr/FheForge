import { ethers } from "ethers";

export interface LeakRecord {
    scenario: string;
    txHash: string;
    leakedFieldType: string;
    source: "input" | "event" | "state";
    proofSnippet: string;
}

export class CalldataScanner {
    private provider: ethers.Provider;
    private findings: LeakRecord[] = [];

    constructor(provider: ethers.Provider) {
        this.provider = provider;
    }

    /**
     * Scan calldata for plain amounts (e.g. 2,000,000 USDC -> 0x1e8480, 1,000,000 -> 0x0f4240)
     */
    public async scanTransactionInput(
        scenario: string,
        txHash: string,
        targetAmounts: bigint[]
    ): Promise<void> {
        try {
            const tx = await this.provider.getTransaction(txHash);
            if (!tx || !tx.data) return;

            const calldata = tx.data.toLowerCase();

            for (const amt of targetAmounts) {
                // Check both hex string representation and padded versions
                const hexVal = amt.toString(16).toLowerCase();
                const paddedHexVal = hexVal.padStart(64, "0");

                if (calldata.includes(paddedHexVal)) {
                    this.findings.push({
                        scenario,
                        txHash,
                        leakedFieldType: `Plaintext Amount (${amt.toString()} units)`,
                        source: "input",
                        proofSnippet: `Found raw padded hex value of ${amt.toString()} in transaction calldata: ...${paddedHexVal.slice(-16)}`,
                    });
                } else if (calldata.includes(hexVal)) {
                    this.findings.push({
                        scenario,
                        txHash,
                        leakedFieldType: `Unpadded Plaintext Amount (${amt.toString()} units)`,
                        source: "input",
                        proofSnippet: `Found raw unpadded hex value: ${hexVal}`,
                    });
                }
            }
        } catch (e) {
            // Ignore fetch errors
        }
    }

    /**
     * Parse logs and check if plaintext amounts are publicly logged
     */
    public async scanEventLogs(
        scenario: string,
        txHash: string,
        contractAbi: string[],
        expectedAmount?: bigint
    ): Promise<void> {
        try {
            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (!receipt || !receipt.logs) return;

            const iface = new ethers.Interface(contractAbi);

            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog({
                        topics: log.topics as string[],
                        data: log.data,
                    });
                    if (!parsed) continue;

                    // Search args for public plaintext values matching our amount
                    for (const key of Object.keys(parsed.args)) {
                        const val = parsed.args[key];
                        if (typeof val === "bigint" && expectedAmount && val === expectedAmount) {
                            this.findings.push({
                                scenario,
                                txHash,
                                leakedFieldType: `Event Parameter Leak (${parsed.name}.${key})`,
                                source: "event",
                                proofSnippet: `Event ${parsed.name} emitted public plaintext value ${val.toString()}`,
                            });
                        }
                    }
                } catch {
                    // Skip mismatching event decoders
                }
            }
        } catch (e) {
            // Ignore errors
        }
    }

    /**
     * Audit public state getters for leakage of private states
     */
    public async scanPublicState(
        scenario: string,
        txHash: string,
        contract: ethers.Contract,
        getterName: string,
        args: any[],
        expectedValue: bigint
    ): Promise<void> {
        try {
            const result = await contract[getterName](...args);
            if (typeof result === "bigint" && result === expectedValue) {
                this.findings.push({
                    scenario,
                    txHash,
                    leakedFieldType: `Public State Getter (${getterName})`,
                    source: "state",
                    proofSnippet: `Called ${getterName}(${args.join(",")}) and retrieved public value ${result.toString()} matching private state`,
                });
            }
        } catch (e) {
            // Ignore state query errors
        }
    }

    public getFindings(): LeakRecord[] {
        return this.findings;
    }
}
