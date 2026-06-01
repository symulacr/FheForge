import { Global, Module } from '@nestjs/common';
import { FhenixStrategyService } from './infrastructure/fhenix-strategy.service';

@Global()
@Module({
  providers: [FhenixStrategyService],
  exports: [FhenixStrategyService],
})
export class SharedModule {}
