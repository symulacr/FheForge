import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FhenixStrategyService } from './infrastructure/fhenix-strategy.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [FhenixStrategyService],
  exports: [FhenixStrategyService],
})
export class SharedModule {}
