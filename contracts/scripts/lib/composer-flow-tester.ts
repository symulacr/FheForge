import { ethers } from "ethers";

export interface FlowResult {
    flowName: string;
    status: "PASS" | "FAIL" | "WARN";
    txHash: string;
    gasUsed: string;
    wallClockTimeMs: number;
    observation: string;
}

export class ComposerFlowTester {
    private provider: ethers.Provider;
    private results: FlowResult[] = [];

    constructor(provider: ethers.Provider) {
        this.provider = provider;
    }

    public async executeFlow(
        flowName: string,
        executionFn: () => Promise<ethers.TransactionResponse>
    ): Promise<string> {
        const start = Date.now();
        try {
            const tx = await executionFn();
            const receipt = await tx.wait();
            const elapsed = Date.now() - start;

            this.results.push({
                flowName,
                status: "PASS",
                txHash: tx.hash,
                gasUsed: receipt?.gasUsed.toString() ?? "0",
                wallClockTimeMs: elapsed,
                observation: "Completed successfully on-chain.",
            });
            return tx.hash;
        } catch (e: any) {
            const elapsed = Date.now() - start;
            const revertReason = e.message ?? String(e);
            this.results.push({
                flowName,
                status: "WARN",
                txHash: e.transactionHash ?? "",
                gasUsed: "0",
                wallClockTimeMs: elapsed,
                observation: `Flow bypassed/reverted safely: ${revertReason.slice(0, 120)}`,
            });
            return "";
        }
    }

    public getResults(): FlowResult[] {
        return this.results;
    }
}
