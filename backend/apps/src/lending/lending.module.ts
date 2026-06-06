import { Module } from '@nestjs/common';
import { LendingController } from './lending.controller';

@Module({
  controllers: [LendingController],
})
export class LendingModule {}
