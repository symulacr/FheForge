import { Injectable, NotFoundException } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { DefiStrategySimulationSnapshot } from "../domain/defi_strategy_simulation_snapshot.entity";
import { DefiStrategySimulationSnapshotRepository } from "../domain/defi_strategy_simulation_snapshot.repository";
import type { CreateDefiStrategySimulationSnapshotDto } from "../interfaces/dto/create_defi_strategy_simulation_snapshot.dto";
import { DefiStrategyVersionService } from "./defi_strategy_version.service";

export interface SnapshotResponse {
	id: string;
	strategy_version_id: string;
	snapshot_type: string;
	estimated_outputs: object;
	estimated_weight: string;
	estimated_fee: string;
	chain_state_ref: string;
	created_at: Date;
}

@Injectable()
export class DefiStrategySimulationSnapshotService {
	constructor(
		private readonly repository: DefiStrategySimulationSnapshotRepository,
		private readonly defiStrategyVersionService: DefiStrategyVersionService,
	) {}

	async create(dto: CreateDefiStrategySimulationSnapshotDto): Promise<SnapshotResponse> {
		const version = await this.defiStrategyVersionService.getById(dto.strategy_version_id);
		if (!version) {
			throw new NotFoundException("Strategy version not found");
		}
		const snapshot = new DefiStrategySimulationSnapshot(
			uuidv4(),
			dto.strategy_version_id,
			dto.snapshot_type,
			{
				estimated_outputs: dto.estimated_outputs,
				estimated_weight: dto.estimated_weight,
				estimated_fee: dto.estimated_fee,
				chain_state_ref: dto.chain_state_ref,
			},
			new Date(),
		);
		const saved = await this.repository.save(snapshot);
		return {
			id: saved.id,
			strategy_version_id: saved.strategy_version_id,
			snapshot_type: saved.snapshot_type,
			estimated_outputs: saved.estimated_outputs,
			estimated_weight: saved.estimated_weight.toString(),
			estimated_fee: saved.estimated_fee.toString(),
			chain_state_ref: saved.chain_state_ref,
			created_at: saved.created_at,
		};
	}

	async getByStrategyVersion(
		strategy_version_id: string,
	): Promise<DefiStrategySimulationSnapshot[]> {
		return this.repository.getByStrategyVersion(strategy_version_id);
	}
}
