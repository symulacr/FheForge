import type { DefiStrategySimulationSnapshot } from "./defi_strategy_simulation_snapshot.entity";

export abstract class DefiStrategySimulationSnapshotRepository {
	abstract save(snapshot: DefiStrategySimulationSnapshot): Promise<DefiStrategySimulationSnapshot>;

	abstract getByStrategyVersion(
		strategy_version_id: string,
	): Promise<DefiStrategySimulationSnapshot[]>;

	abstract getById(id: string): Promise<DefiStrategySimulationSnapshot | null>;
}
