import { Injectable } from '@nestjs/common';
import { DefiModulesRepository } from '../domain/defi_modules.repository';

@Injectable()
export class DefiModulesService {
  constructor(private readonly defiModulesRepository: DefiModulesRepository) {}

  public async getAll() {
    return this.defiModulesRepository.findAll();
  }
}
