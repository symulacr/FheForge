import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { DefiModulesService } from '../application/defi_modules.service';

@Controller('defi-modules')
export class DefiModulesController {
  constructor(
    private readonly defiModulesService: DefiModulesService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get all DeFi modules',
  })
  @ApiResponse({
    status: 200,
    description: 'List of DeFi modules',
  })
  public async getAllDefiModules() {
    const defiModules = await this.defiModulesService.getAll();
    return defiModules;
  }
}
