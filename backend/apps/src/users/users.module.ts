import { Module } from '@nestjs/common';
import { SupabaseModule } from '../shared/supabase.module';
import { UserService } from './application/user.service';
import { UserRepository } from './domain/user.repository';
import { UserRepositoryImplement } from './infrastructure/user.repository.impl';

@Module({
  imports: [SupabaseModule],
  providers: [UserService, { provide: UserRepository, useClass: UserRepositoryImplement }],
  exports: [UserService],
})
export class UsersModule {}
