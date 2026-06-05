export class DefiStrategySimulationSnapshot {
  public estimated_outputs: object;
  public estimated_weight: bigint;
  public estimated_fee: bigint;
  public chain_state_ref: string;

  constructor(
    public id: string,
    public strategy_version_id: string,
    public snapshot_type: string,
    data: Record<string, unknown>,
    public created_at: Date,
  ) {
    this.estimated_outputs = (data.estimated_outputs as object) ?? {};
    this.estimated_weight = BigInt((data.estimated_weight as string) ?? '0');
    this.estimated_fee = BigInt((data.estimated_fee as string) ?? '0');
    this.chain_state_ref = (data.chain_state_ref as string) ?? '';
  }
}
