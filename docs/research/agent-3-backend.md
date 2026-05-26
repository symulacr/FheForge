# Agent 3: Backend Microchange Plan — FheForge

> **Context:** NestJS API in `backend/apps/`, 12 modules, 39 endpoints, 9393 LOC.
> **Target:** All verified P0–P2 findings from the Backend findings audit.
> **Status:** ⬜ Not started | ✅ Ready | 🔧 In progress
> **Generated:** 2026-05-18

---

## Table of Contents

- [P0 — Security & Broken (fix immediately)](#p0--security--broken-fix-immediately)
  - [MC-B3-01: Auth not applied globally or per-controller](#mc-b3-01-auth-not-applied-globally-or-per-controller)
  - [MC-B3-02: RewardsService throws generic Error instead of HttpException](#mc-b3-02-rewardsservice-throws-generic-error-instead-of-httpexception)
  - [MC-B3-03: Missing GET /defi-strategies/:id](#mc-b3-03-missing-get-defi-strategiesid)
  - [MC-B3-04: Missing GET endpoints for defi-token](#mc-b3-04-missing-get-endpoints-for-defi-token)
  - [MC-B3-05: defi_action_required table missing from schema.sql](#mc-b3-05-defi_action_required-table-missing-from-schemasql)
  - [MC-B3-06: Simulation endpoint unhooked — no HTTP route maps to DefiSimulationEngine.simulate()](#mc-b3-06-simulation-endpoint-unhooked--no-http-route-maps-to-defisimulationenginesimulate)
  - [MC-B3-07: checkEvmBinding() hardcoded to return isBound: true](#mc-b3-07-checkevmbinding-hardcoded-to-return-isbound-true)
- [P1 — Functional Gaps](#p1--functional-gaps)
  - [MC-B3-08: Railway Supabase env vars missing from config](#mc-b3-08-railway-supabase-env-vars-missing-from-config)
  - [MC-B3-09: Static exchange rate fallback should read on-chain from PriceOracle](#mc-b3-09-static-exchange-rate-fallback-should-read-on-chain-from-priceoracle)
  - [MC-B3-10: ethers v5 subpath imports in v6 project](#mc-b3-10-ethers-v5-subpath-imports-in-v6-project)
  - [MC-B3-11: Event indexer wiring gaps — COFHE_RPC vs FHENIX_RPC mismatch](#mc-b3-11-event-indexer-wiring-gaps--cofhe_rpc-vs-fhenix_rpc-mismatch)
  - [MC-B3-12: Static APY fallback in simulators](#mc-b3-12-static-apy-fallback-in-simulators)
- [P2 — Infrastructure](#p2--infrastructure)
  - [MC-B3-13: Backend Supabase migrations status](#mc-b3-13-backend-supabase-migrations-status)

---

## P0 — Security & Broken (fix immediately)

---

### MC-B3-01: Auth not applied globally or per-controller

**File:** `backend/apps/src/app.module.ts`
**Logic:** `JwtAuthGuard` exists in `src/auth/jwt-auth.guard.ts` and is exported from `AuthModule`, but it is **never applied**. No controller uses `@UseGuards(JwtAuthGuard)`, and `APP_GUARD` only registers `ThrottlerGuard`. All 39 endpoints are public.

**Old:**
```typescript
// app.module.ts — current providers section
providers: [
    FhenixStrategyService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
```

**New:**
```typescript
// Option A: Global guard via APP_GUARD (applies to ALL routes)
// Add to imports at top
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

// Add provider
providers: [
    FhenixStrategyService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // <-- ADD: applied after ThrottlerGuard
    },
  ],
```

**Note:** Option A (global) will protect **every** endpoint, including `/health`. To allow public routes, use `@SetMetadata('isPublic', true)` with a custom decorator and modify `JwtAuthGuard` to skip when `isPublic` is set. Add a `@Public()` decorator:

```typescript
// backend/apps/src/auth/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```typescript
// backend/apps/src/auth/jwt-auth.guard.ts (updated)
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

```typescript
// Mark /health as public
// app.controller.ts
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  @Get('health')
  @Public()
  async health() { ... }
}
```

**Priority:** P0
**Infrastructure Dep:** JWT_SECRET must be configured in Railway env vars
**Test Required:** Unit test for `JwtAuthGuard` with `@Public()` decorator; e2e test for 401 on unauthenticated requests

---

### MC-B3-02: RewardsService throws generic Error instead of HttpException

**File:** `backend/apps/src/strategies/application/rewards.service.ts`
**Logic:** `calculateAPY()` throws `new Error(...)` which is a raw JavaScript Error. When caught by the global `HttpExceptionFilter`, it does not match any specific pattern, so it is returned as a 500 "Internal server error". Should throw a proper NestJS HTTP exception (`NotImplementedException` or `HttpException`) for correct status code and error serialization.

**Old:**
```typescript
  calculateAPY(_strategistName: string): never {
    throw new Error(
      'Rewards service requires Fhenix oracle integration — not available on testnet',
    );
  }
```

**New:**
```typescript
import { Injectable, NotImplementedException } from '@nestjs/common';

  calculateAPY(_strategistName: string): never {
    throw new NotImplementedException(
      'Rewards service requires Fhenix oracle integration — not available on testnet',
    );
  }
```

**Priority:** P0
**Infrastructure Dep:** None
**Test Required:** Unit test asserting `NotImplementedException` is thrown

---

### MC-B3-03: Missing GET /defi-strategies/:id

**File:** `backend/apps/src/defi_strategies/interfaces/defi_strategies.controller.ts`
**Logic:** The controller has `@Put(':id')` and `@Delete(':id')` but **no** `@Get(':id')`. The `DefiStrategiesRepository` has `getById()` and `DefiStrategiesService` has the capability, but the controller route and service method are missing.

**File:** `backend/apps/src/defi_strategies/application/defi_strategies.service.ts`
**Logic:** The service is also missing a public `getById()` method.

**Old (controller):**
```typescript
  // Missing: @Get(':id') endpoint

  @Put(':id')
  @ApiOperation({ summary: 'Update a DeFi strategy' })
  @ApiParam({ name: 'id', description: 'The ID of the DeFi strategy to update' })
  public async updateStrategy(
    @Param('id') id: string,
    @Body() body: UpdateDefiStrategyDto,
  ) {
    return this.defiStrategiesService.update(id, body);
  }
```

**New (controller):**
```typescript
  @Get(':id')
  @ApiOperation({ summary: 'Get a DeFi strategy by ID' })
  @ApiParam({ name: 'id', description: 'The ID of the DeFi strategy' })
  public async getStrategyById(@Param('id') id: string) {
    return this.defiStrategiesService.getById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a DeFi strategy' })
  @ApiParam({ name: 'id', description: 'The ID of the DeFi strategy to update' })
  public async updateStrategy(
    @Param('id') id: string,
    @Body() body: UpdateDefiStrategyDto,
  ) {
    return this.defiStrategiesService.update(id, body);
  }
```

**New (service — add method):**
```typescript
  public async getById(id: string): Promise<DefiStrategy> {
    const strategy = await this.defiStrategiesRepository.getById(id);
    if (!strategy) {
      throw new NotFoundException(`DefiStrategy with id ${id} not found`);
    }
    return strategy;
  }
```

**Priority:** P0
**Infrastructure Dep:** None
**Test Required:** Unit test for `DefiStrategiesService.getById()`, e2e for `GET /defi-strategies/:id`

---

### MC-B3-04: Missing GET endpoints for defi-token

**File:** `backend/apps/src/defi_token/interfaces/defi_token.controller.ts`
**Logic:** The controller only exposes `@Post()` for creating tokens. The `DefiTokenService` has `getDefiTokenById()`, `getDefiTokenByAssetId()`, and `getAllDefiTokens()` but **none** have HTTP routes.

**Old:**
```typescript
@Controller('defi-token')
export class DefiTokenController {
  constructor(private readonly defiTokenService: DefiTokenService) {}

  @ApiOperation({ summary: 'Create a new DeFi token' })
  @Post()
  async createDefiToken(@Body() body: CreateDefiTokenDto) {
    return this.defiTokenService.createDefiToken(body);
  }
}
```

**New:**
```typescript
import { Controller, Body, Post, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';

@Controller('defi-token')
export class DefiTokenController {
  constructor(private readonly defiTokenService: DefiTokenService) {}

  @ApiOperation({ summary: 'Create a new DeFi token' })
  @Post()
  async createDefiToken(@Body() body: CreateDefiTokenDto) {
    return this.defiTokenService.createDefiToken(body);
  }

  @Get()
  @ApiOperation({ summary: 'Get all DeFi tokens' })
  async getAllDefiTokens() {
    return this.defiTokenService.getAllDefiTokens();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a DeFi token by ID' })
  @ApiParam({ name: 'id', description: 'Token ID' })
  async getDefiTokenById(@Param('id') id: string) {
    return this.defiTokenService.getDefiTokenById(id);
  }

  @Get('asset/:assetId')
  @ApiOperation({ summary: 'Get a DeFi token by asset ID' })
  @ApiParam({ name: 'assetId', description: 'Asset ID (e.g. contract address)' })
  async getDefiTokenByAssetId(@Param('assetId') assetId: string) {
    return this.defiTokenService.getDefiTokenByAssetId(assetId);
  }
}
```

**Note:** `getByAddress`, `transferTokens`, `burnTokens` do **not exist** in the current codebase. The original finding references methods from a previous iteration. Only `getDefiTokenById`, `getDefiTokenByAssetId`, and `getAllDefiTokens` have implementations in the service/repository but lack HTTP routes.

**Priority:** P0
**Infrastructure Dep:** None
**Test Required:** Unit test for the 3 new controller methods

---

### MC-B3-05: defi_action_required table missing from schema.sql

**Files:** Multiple — referenced in `domain/`, `infrastructure/`, `application/` layers of `defi_modules/`
**Schema file:** `/home/eya/archives/refactor/refactor-FheForge-work/schema.sql`
**Logic:** The entity `DefiActionRequired`, repository, and repository implementation all reference a `defi_action_required` table in Supabase. However, `schema.sql` (the root schema definition) has **no** `CREATE TABLE` for `defi_action_required`. This table is referenced in:
- `defi_action_required.entity.ts` — entity class
- `defi_action_required.repository.ts` — abstract repository
- `defi_action_required.repository.impl.ts` — `supabase.from('defi_action_required')`
- `defi_action_required.service.ts` — service layer
- `defi_modules.controller.ts` — `POST /defi-modules/actions/required` and `GET /defi-modules/actions/required`

Any request to `POST /defi-modules/actions/required` or `GET /defi-modules/actions/required` will fail with a database error because the table does not exist.

**Required SQL (add to `schema.sql`):**
```sql
create table if not exists defi_action_required (
  id uuid primary key default gen_random_uuid(),
  action_id uuid references defi_module_actions(id) on delete cascade,
  module_id uuid references defi_modules(id) on delete cascade,
  action_required_id uuid not null,
  created_at timestamptz default now()
);

-- Index for fast lookups by action_id
create index if not exists idx_defi_action_required_action_id
  on defi_action_required(action_id);
```

**Also update `database.types.ts` if any new columns need typing:**
The current `DefiActionRequiredRow` in `database.types.ts` is sufficient (id, action_id, module_id, action_required_id).

**Priority:** P0
**Infrastructure Dep:** Supabase — requires manual migration or migration script execution
**Test Required:** Integration test verifying POST/GET for `defi-action-required` endpoints succeed after migration

---

### MC-B3-06: Simulation endpoint unhooked — no HTTP route maps to DefiSimulationEngine.simulate()

**File:** `backend/apps/src/defi_strategies/application/defi-simulation-engine.service.ts`
**Logic:** `DefiSimulationEngine` has a fully implemented `simulate()` method with swap, supply, borrow simulators wired up, but **no controller or HTTP route** exposes it. The calling code path is dead.

**Required changes:**

1. **Create an interface/dto:** Define a `SimulateStrategyDto` in `defi_strategies/interfaces/dto/simulate-strategy.dto.ts`:

```typescript
// backend/apps/src/defi_strategies/interfaces/dto/simulate-strategy.dto.ts
import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimulateStrategyDto {
  @ApiProperty({ description: 'Strategy workflow JSON' })
  @IsNotEmpty()
  workflow_json: {
    steps: Array<{
      type: string;
      [key: string]: unknown;
    }>;
  };

  @ApiProperty({ description: 'Amount to simulate' })
  @IsNumber()
  @Min(0)
  amount_in: number;

  @ApiProperty({ description: 'Slippage tolerance (default 0.5%)', required: false })
  @IsNumber()
  @IsOptional()
  slippage_tolerance?: number;

  @ApiProperty({ description: 'Gas price override', required: false })
  @IsNumber()
  @IsOptional()
  gas_price?: number;
}
```

2. **Create a simulation controller** or add the route to `defi_strategies.controller.ts`:

```typescript
// Add to defi_strategies.controller.ts
import { SimulateStrategyDto } from './dto/simulate-strategy.dto';
import { DefiSimulationEngine } from '../application/defi-simulation-engine.service';

// Add constructor injection
constructor(
    private readonly defiStrategyVersionService: DefiStrategyVersionService,
    private readonly defiStrategiesService: DefiStrategiesService,
    private readonly defiSimulationEngine: DefiSimulationEngine,  // <-- ADD
) {}

// Add route
@Post('simulate')
@ApiOperation({ summary: 'Simulate a DeFi strategy workflow' })
async simulate(@Body() dto: SimulateStrategyDto) {
    return this.defiSimulationEngine.simulate(
        dto.workflow_json,
        dto.amount_in,
        {
            slippage_tolerance: dto.slippage_tolerance,
            gas_price: dto.gas_price,
        },
    );
}
```

3. **Update the module** to provide `DefiSimulationEngine`:
`backend/apps/src/defi_strategies/defi_strategies.module.ts` needs to provide `DefiSimulationEngine` and its simulator dependencies.

**Priority:** P0
**Infrastructure Dep:** None (self-contained simulation)
**Test Required:** Unit test for the new controller method

---

### MC-B3-07: checkEvmBinding() hardcoded to return isBound: true

**File:** `backend/apps/src/users/application/user.service.ts` (line 48–53)
**Logic:** `checkEvmBinding()` always returns `{ isBound: true, evmAddress: substrateAddress }` without performing any actual EVM binding check. This provides false security to clients.

**Old:**
```typescript
  checkEvmBinding(substrateAddress: string): {
    isBound: boolean;
    evmAddress: string;
  } {
    return { isBound: true, evmAddress: substrateAddress };
  }
```

**New:**
```typescript
  async checkEvmBinding(substrateAddress: string): Promise<{
    isBound: boolean;
    evmAddress: string | null;
  }> {
    // Attempt to verify EVM binding via the contract or registry
    try {
      // Option 1: Query an on-chain EVM binding registry (if deployed)
      // const isBound = await this.evmBindingRegistry.isBound(substrateAddress);
      // const evmAddress = await this.evmBindingRegistry.getEvmAddress(substrateAddress);

      // Option 2: Check Supabase for a stored EVM binding
      const user = await this.userRepo.findByWalletAddress(substrateAddress);
      if (user?.evm_address) {
        return { isBound: true, evmAddress: user.evm_address };
      }

      return { isBound: false, evmAddress: null };
    } catch (error) {
      this.logger.warn(`EVM binding check failed: ${(error as Error).message}`);
      return { isBound: false, evmAddress: null };
    }
  }
```

**Note:** The exact implementation depends on how EVM binding is verified in the system. The above shows two common approaches. If there is no EVM binding contract or stored data yet, a `NotImplementedException` is more honest than hardcoded `true`.

**Priority:** P0
**Infrastructure Dep:** May require a `evm_address` column on `users` table or an on-chain registry contract
**Test Required:** Unit test with mocked repository returning `{ isBound: true }` vs null

---

## P1 — Functional Gaps

---

### MC-B3-08: Railway Supabase env vars missing from config

**Files:** `backend/apps/.env.production.example`, `backend/apps/.env.development.example`
**Logic:** The backend is deployed on Railway, which auto-injects `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_KEY`. The `.env.example` files are missing Railway-specific vars and documentation about Railway's Supabase plugin integration. Additionally, there's no support for reading `SUPABASE_URL`/`SUPABASE_KEY` from Railway's injected env namespace (Railway uses `SUPABASE_URL` and `SUPABASE_KEY` as service variables).

**Current `.env.development.example` (missing Railway vars):**
```
SUPABASE_URL=
SUPABASE_KEY=
```

**Required additions to both `.env.production.example` and `.env.development.example`:**
```
# Railway Supabase Plugin (injected automatically by Railway)
# When deploying on Railway with the Supabase plugin, these are auto-set.
# SUPABASE_URL=<injected-by-railway>
# SUPABASE_KEY=<injected-by-railway>

# Alternative: Direct Supabase connection (for local dev)
# SUPABASE_URL=your-supabase-project-url
# SUPABASE_KEY=your-supabase-service-role-key
```

**Also add to `supabase.service.ts`** — the service already reads `SUPABASE_URL` and `SUPABASE_KEY` from `ConfigService` which gets values from `.env.<NODE_ENV>` or Railway injected env vars. **No code change needed** if Railway injects `SUPABASE_URL` and `SUPABASE_KEY` directly. Verify by checking Railway dashboard → Supabase plugin → environment tab.

**Priority:** P1
**Infrastructure Dep:** Railway Supabase plugin must be attached to the deployment
**Test Required:** Manual verification — deploy to Railway and check logs for Supabase connection

---

### MC-B3-09: Static exchange rate fallback should read on-chain from PriceOracle

**File:** `backend/apps/src/shared/infrastructure/fhenix-strategy.service.ts`
**Logic:** The `FhenixStrategyService.getAssetPriceUsd()` already attempts on-chain reads from PriceOracle and falls back to static env-var rates when oracle is unavailable. This is a **partial fix** — the static fallback (`EXCHANGE_RATE_WETH_USDC=3000`) is hardcoded in config and will become stale. The service already has a caching layer (`priceCache` with 60s TTL) and appropriate logging for stale oracle data.

**The existing code is already well-implemented** with:
- On-chain PriceOracle read ✓
- Cache layer (60s TTL) ✓
- Fallback to static rates ✓
- Stale oracle detection with explicit warning logs ✓

**Recommendation:** Document the current behavior and add a health check endpoint to report whether the PriceOracle is responding:

```typescript
// Add to FhenixStrategyService
async isOracleHealthy(): Promise<boolean> {
  try {
    if (this.priceOracle) {
      const weth = this.configService.get<string>('TOKEN_WETH');
      if (weth) {
        await this.priceOracle.getPriceUsd(weth);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Add health check detail in app.controller.ts
async health() {
  const status = await this.fhenixStrategy.getNetworkStatus();
  const oracleHealthy = await this.fhenixStrategy.isOracleHealthy();
  return {
    ...status,
    status: 'ok',
    chain: 'arb-sepolia',
    chainId: 421614,
    oracle: oracleHealthy ? 'healthy' : 'fallback_static',
  };
}
```

**Priority:** P1
**Infrastructure Dep:** `PRICE_ORACLE_ADDRESS` env var must point to the deployed PriceOracle contract
**Test Required:** Unit test for `isOracleHealthy()`

---

### MC-B3-10: ethers v5 subpath imports in v6 project

**Files:**
- `backend/apps/src/shared/infrastructure/fhenix-strategy.service.ts`
- `backend/apps/src/event-indexer/event-indexer.service.ts`
- `backend/apps/src/defi_strategies/application/simulators/borrow-simulator.ts`
- `backend/apps/src/defi_strategies/application/simulators/supply-simulator.ts`
- `backend/apps/src/ai-strategy-builder/application/gas-estimation.service.ts`

**Logic:** The codebase imports from `ethers/providers`, `ethers/utils`, `ethers/abi` — which are **ethers v5 subpath exports**. In ethers v6, all exports are from the root `'ethers'` module. These imports will either fail at runtime (module not found) or resolve to empty objects, causing the provider/contract interactions to silently break.

**Confirmed occurrences:**

| File | Wrong Import | v6 Fix |
|------|-------------|--------|
| `fhenix-strategy.service.ts` | `import { JsonRpcProvider } from 'ethers/providers'` | `import { JsonRpcProvider } from 'ethers'` |
| `fhenix-strategy.service.ts` | `import { formatUnits } from 'ethers/utils'` | `import { formatUnits } from 'ethers'` |
| `event-indexer.service.ts` | `import { JsonRpcProvider } from 'ethers/providers'` | `import { JsonRpcProvider } from 'ethers'` |
| `event-indexer.service.ts` | `import { Result } from 'ethers/abi'` | `import { Result } from 'ethers'` |
| `gas-estimation.service.ts` | `import { JsonRpcProvider } from 'ethers/providers'` | `import { JsonRpcProvider } from 'ethers'` |
| `borrow-simulator.ts` | `import { JsonRpcProvider, Contract } from 'ethers'` | Already correct ✓ (but check `ethers/providers` not used) |
| `supply-simulator.ts` | `import { JsonRpcProvider, Contract } from 'ethers'` | Already correct ✓ |

**Note:** The `borrow-simulator.ts` and `supply-simulator.ts` import from `'ethers'` directly (correct v6 syntax). The three files with subpath imports need fixing.

**Fix for `fhenix-strategy.service.ts`:**
```typescript
// Old:
import { Contract } from 'ethers';
import { JsonRpcProvider } from 'ethers/providers';
import { formatUnits } from 'ethers/utils';

// New:
import { Contract, JsonRpcProvider, formatUnits } from 'ethers';
```

**Fix for `event-indexer.service.ts`:**
```typescript
// Old:
import { Contract } from 'ethers';
import { JsonRpcProvider } from 'ethers/providers';
import { Result } from 'ethers/abi';

// New:
import { Contract, JsonRpcProvider, Result } from 'ethers';
```

**Fix for `gas-estimation.service.ts`:**
```typescript
// Old:
import { JsonRpcProvider } from 'ethers/providers';

// New:
import { JsonRpcProvider } from 'ethers';
```

**Priority:** P1
**Infrastructure Dep:** None (pure import fix)
**Test Required:** Build must pass; unit tests for all affected services

---

### MC-B3-11: Event indexer wiring gaps — COFHE_RPC vs FHENIX_RPC mismatch

**File:** `backend/apps/src/event-indexer/event-indexer.service.ts`
**File:** `backend/apps/.env.development`
**Logic:** The `EventIndexerService` reads `COFHE_RPC` from config. But in `.env.development`, the RPC is set as `FHENIX_RPC`. The `.env.development.example` also uses `FHENIX_RPC`. The indexer also requires `STRATEGY_VAULT_ADDRESS` and `LENDING_POOL_ADDRESS`, but the `.env.development` uses `VAULT_ADDRESS` and `POOL_ADDRESS`.

**Env var mapping issues:**

| Code reads | .env.development has | Match? |
|-----------|---------------------|--------|
| `COFHE_RPC` | `FHENIX_RPC` | ❌ Wrong name |
| `STRATEGY_VAULT_ADDRESS` | `VAULT_ADDRESS` | ❌ Wrong name |
| `LENDING_POOL_ADDRESS` | `POOL_ADDRESS` | ❌ Wrong name |
| `PRICE_ORACLE_ADDRESS` | (not set) | ❌ Missing |
| `STRATEGY_REGISTRY_ADDRESS` | `REGISTRY_ADDRESS` | ❌ Wrong name |

**Fix:** Either rename the env vars in `.env.development` to match what the code expects, or add config alias mapping in `app.module.ts`:

```typescript
// Option: Add a custom config mapping
// In app.module.ts, ConfigModule.forRoot already loads .env files.
// Use @nestjs/config's validationSchema or raw mapping:

// Option A: Rename .env.development keys
// COFHE_RPC=https://sepolia-rollup.arbitrum.io/rpc
// STRATEGY_VAULT_ADDRESS=0x261c4b5a66C24Dd1974E7ea470e76154dff062F5
// LENDING_POOL_ADDRESS=0xb4F6b792219e3d6Cd3f3B8088285e52a64CCcb44
// PRICE_ORACLE_ADDRESS=0x6793a71fefA499d9A345Bd4Ab15eae8bb27F065C
// STRATEGY_REGISTRY_ADDRESS=0xcdFB608e7f45f6e6cCA27e504ce6b8aDe64701B9

// Option B: Keep aliases and use a config wrapper
// In supabase.service.ts or a dedicated config service
```

**Recommendation:** Rename `.env.development` vars to match the code constants for consistency. Add a `scripts/verify-env-vars.js` check for all required vars.

**Priority:** P1
**Infrastructure Dep:** Railway env vars must match the corrected names
**Test Required:** Unit test for ConfigService key access

---

### MC-B3-12: Static APY fallback in simulators

**Files:**
- `backend/apps/src/defi_strategies/application/simulators/supply-simulator.ts` (line 87–88)
- `backend/apps/src/defi_strategies/application/simulators/borrow-simulator.ts` (line 111–112)

**Logic:** Both `SupplySimulator` and `BorrowSimulator` attempt on-chain reads from `StrategyRegistry.getStrategyParams()` but fall back to static APY values (5.0% supply, 6.0% borrow) when:
1. `STRATEGY_REGISTRY_ADDRESS` is not configured
2. The RPC call fails
3. `COFHE_RPC` is not set

The fallback should use live pool state when possible (e.g., query LendingPool for current supply/borrow rates).

**Current fallback:**
```typescript
// SupplySimulator
private async getSupplyApy(strategyId: bigint): Promise<number> {
    if (!this.strategyRegistry) {
      this.logger.warn('StrategyRegistry not configured, using fallback APY');
      return 5.0;  // Hardcoded
    }
    // ... on-chain read ...
    return 5.0;  // Hardcoded fallback
}

// BorrowSimulator
private async getInterestRate(strategyId: bigint): Promise<number> {
    if (!this.strategyRegistry) {
      this.logger.warn('StrategyRegistry not configured, using fallback APY');
      return 6.0;  // Hardcoded
    }
    // ... on-chain read ...
    return 6.0;  // Hardcoded fallback
}
```

**Fix:** Add a secondary fallback that reads from the env-var static rates (`SUPPLY_APY_BPS`, `BORROW_APY_BPS`) before using hardcoded values:

```typescript
// SupplySimulator.getSupplyApy — use configurable env fallback
private getFallbackSupplyApy(): number {
    const apyBps = this.configService.get<number>('SUPPLY_APY_BPS', 650);
    return apyBps / 100; // Convert basis points to percentage → 6.5%
}

// BorrowSimulator.getInterestRate — use configurable env fallback
private getFallbackBorrowApy(): number {
    const apyBps = this.configService.get<number>('BORROW_APY_BPS', 550);
    return apyBps / 100; // Convert basis points to percentage → 5.5%
}
```

**Priority:** P1
**Infrastructure Dep:** `SUPPLY_APY_BPS`, `BORROW_APY_BPS` must be set in all env configs
**Test Required:** Unit test for fallback values from ConfigService

---

## P2 — Infrastructure

---

### MC-B3-13: Backend Supabase migrations status

**File:** `backend/apps/migrations/`
**Logic:** The project has a basic migration infrastructure with one migration file (`001_event_indexing_tables.sql`) and a Node.js runner (`run-migration.js`). However:

1. **schema.sql is the authoritative schema** but it's out of sync with migrations and backend code
2. **No migration tracking** — there's no `_migrations` table to track which migrations have been applied
3. **The runner uses `supabase.rpc('exec_sql')`** which requires the `exec_sql` function to be enabled (dangerous for production — should use `supabase.sql` raw client or direct SQL execution)
4. **schema.sql is missing** tables that the code relies on (`defi_action_required` — see MC-B3-05)

**Current migration state:**

| Migration | Status | Description |
|-----------|--------|-------------|
| `001_event_indexing_tables.sql` | ✅ Exists | Creates `on_chain_events` and `event_indexer_state` tables |
| (no more) | ❌ Missing | `defi_action_required` table — used by defi_modules |

**Required changes:**

1. **Create migration `002_defi_action_required.sql`:**
```sql
-- MC-B3-05: Add defi_action_required table
CREATE TABLE IF NOT EXISTS defi_action_required (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES defi_module_actions(id) ON DELETE CASCADE,
  module_id UUID REFERENCES defi_modules(id) ON DELETE CASCADE,
  action_required_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_action_required_action_id
  ON defi_action_required(action_id);
```

2. **Fix the migration runner** to use direct SQL execution instead of `rpc('exec_sql')`:
```javascript
// run-migration.js — use raw SQL via REST
const { error } = await supabase.from('_sql').select('*').single();
// OR better: use supabase.auth.admin.sql() if available
// OR safest: output the SQL and let the user run it manually
```

3. **Add a `_migrations` tracking table** in a `000_base.sql` migration:
```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

4. **Update `schema.sql`** to include all tables referenced in code:
   - `defi_action_required` (from defi_modules domain)
   - `on_chain_events` and `event_indexer_state` (from event-indexer)
   - Sync column definitions with `database.types.ts`

**Priority:** P2
**Infrastructure Dep:** Supabase project — migrations must be applied manually or via CI/CD
**Test Required:** N/A (infrastructure documentation)

---

## Summary Table

| ID | Finding | Priority | Files Changed | Strategy |
|----|---------|----------|---------------|----------|
| MC-B3-01 | Auth not applied | P0 | `app.module.ts`, `jwt-auth.guard.ts` (new), `public.decorator.ts` (new) | Global `JwtAuthGuard` + `@Public()` decorator |
| MC-B3-02 | RewardsService generic Error | P0 | `rewards.service.ts` | Replace `Error` with `NotImplementedException` |
| MC-B3-03 | Missing GET /defi-strategies/:id | P0 | `defi_strategies.controller.ts`, `defi_strategies.service.ts` | Add `@Get(':id')` + `getById()` |
| MC-B3-04 | Missing GET /defi-token endpoints | P0 | `defi_token.controller.ts` | Add `@Get()`, `@Get(':id')`, `@Get('asset/:assetId')` |
| MC-B3-05 | defi_action_required table missing | P0 | `schema.sql` (new migration) | Add `CREATE TABLE` + index |
| MC-B3-06 | Simulation endpoint unhooked | P0 | `defi_strategies.controller.ts`, dto (new), module providers | Add `POST /defi-strategies/simulate` |
| MC-B3-07 | checkEvmBinding hardcoded true | P0 | `user.service.ts` | Implement real binding check |
| MC-B3-08 | Railway Supabase env vars missing | P1 | `.env.production.example`, `.env.development.example` | Document Railway env vars |
| MC-B3-09 | Static exchange rate fallback | P1 | `fhenix-strategy.service.ts`, `app.controller.ts` | Add oracle health to `/health` |
| MC-B3-10 | ethers v5 subpath imports | P1 | `fhenix-strategy.service.ts`, `event-indexer.service.ts`, `gas-estimation.service.ts` | Fix to v6 syntax |
| MC-B3-11 | Event indexer: COFHE_RPC vs FHENIX_RPC | P1 | `.env.development`, `event-indexer.service.ts` | Align env var names |
| MC-B3-12 | Static APY in simulators | P1 | `supply-simulator.ts`, `borrow-simulator.ts` | Use configurable env fallbacks |
| MC-B3-13 | Migration infrastructure | P2 | `migrations/`, `schema.sql` | Add tracking table, migration runner fix, schema sync |

---

## Execution Order

```
Phase 1 — P0 (fix immediately)
  1. MC-B3-05: Create defi_action_required migration (unblocks endpoints)
  2. MC-B3-01: Apply JwtAuthGuard globally
  3. MC-B3-02: Fix RewardsService exception
  4. MC-B3-03: Add GET /defi-strategies/:id
  5. MC-B3-04: Add GET /defi-token endpoints
  6. MC-B3-06: Wire simulation endpoint
  7. MC-B3-07: Fix checkEvmBinding

Phase 2 — P1 (functional gaps)
  8. MC-B3-10: Fix ethers v5→v6 imports
  9. MC-B3-11: Align env var names
  10. MC-B3-12: Configure APY fallbacks
  11. MC-B3-09: Add oracle health check
  12. MC-B3-08: Document Railway env vars

Phase 3 — P2 (infrastructure)
  13. MC-B3-13: Migration infrastructure
```

---

## Verification Checklist

After implementation, verify:

- [ ] `GET /health` returns 200 without auth token (public)
- [ ] All other endpoints return 401 without Bearer token
- [ ] `POST /defi-strategies/simulate` returns simulation results
- [ ] `GET /defi-strategies/:id` returns a single strategy
- [ ] `GET /defi-token`, `GET /defi-token/:id`, `GET /defi-token/asset/:assetId` return token data
- [ ] `POST /defi-modules/actions/required` and GET work without DB error
- [ ] `RewardsService.calculateAPY()` throws `NotImplementedException`
- [ ] `checkEvmBinding()` returns honest result (not hardcoded `true`)
- [ ] Build passes with zero errors (`npm run build`)
- [ ] All unit tests pass (`npm run test`)
