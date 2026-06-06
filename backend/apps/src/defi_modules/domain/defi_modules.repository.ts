import type { DefiModule } from './defi_modules.entity';

export abstract class DefiModulesRepository {
  abstract save(defiModule: DefiModule): Promise<DefiModule>;
  abstract findAll(): Promise<DefiModule[]>;
  abstract findById(id: string): Promise<DefiModule | null>;
}
