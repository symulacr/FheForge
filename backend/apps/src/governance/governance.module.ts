import { Module } from "@nestjs/common";
import { GovernanceController } from "./governance.controller";
import { GovernanceRepository } from "./governance.repository";
import { GovernanceService } from "./governance.service";

@Module({
	controllers: [GovernanceController],
	providers: [GovernanceService, GovernanceRepository],
	exports: [GovernanceService],
})
export class GovernanceModule {}
