# Plan: Fix solhint import-path-config Warnings

**Status**: Implemented & Verified (0 warnings, 284/284 forge tests pass)

---

## Root Cause

solhint's `import-path-check` rule searches for import paths in a list of default directories (`process.cwd()`, `process.cwd() + '/contracts'`, `process.cwd() + '/src'`, `process.cwd() + '/node_modules'`, etc.). Foundry uses remappings (defined in `foundry.toml` and `remappings.txt`) to translate import prefixes like `@openzeppelin/` to physical paths like `node_modules/@openzeppelin/`.

In this project:
- **solhint runs from workspace root** (`/home/eya/archives/refactor/refactor-FheForge-work`)
- **`node_modules/` is at `contracts/node_modules/`**, not at workspace root
- Default search paths don't include `contracts/node_modules/`
- Result: solhint can't resolve any `@openzeppelin/`, `@fhenixprotocol/`, `@pythnetwork/`, `@cofhe/` imports

## Warning Inventory

**Total: 58 warnings, all `import-path-check`**.
0 warnings for `compiler-version`, `no-global-import`, `no-unused-import`, `no-unused-vars`, `one-contract-per-file`.

### Warnings by import target

| Import prefix | Warning count | Root cause |
|---|---|---|
| `@openzeppelin/contracts/...` | 29 | `contracts/node_modules/` not in solhint search paths |
| `@fhenixprotocol/cofhe-contracts/...` | 17 | same |
| `@pythnetwork/pyth-sdk-solidity/...` | 4 | same |
| `@cofhe/mock-contracts/...` | 1 | path translation in remapping (`/contracts/` appended) |

## Fix Summary

**2 files changed** (1 config, 1 source):

| # | File | Change type | Warnings fixed |
|---|---|---|---|
| 1 | `.solhint.json` | Add `import-path-check` rule config with `contracts/node_modules` search path | 57 |
| 2 | `contracts/test-foundry/FheForgeComposer.t.sol` | Convert `@cofhe/mock-contracts/` import to relative path | 1 |

---

## Fix 1: `.solhint.json` — Configure import-path-check search paths

**File**: `/.solhint.json`

**Change**: Add the `import-path-check` rule with `contracts/node_modules` as an extra search path.

**Before**:
```json
{
  "extends": "solhint:recommended"
}
```

**After**:
```json
{
  "extends": "solhint:recommended",
  "rules": {
    "import-path-check": ["warn", ["contracts/node_modules"]]
  }
}
```

**How it works**: solhint's `import-path-check` rule constructor concatenates the configured paths with default locations. Adding `"contracts/node_modules"` makes solhint search for imports at `<workspace>/contracts/node_modules/<import-path>`, which resolves all `@openzeppelin/`, `@fhenixprotocol/`, and `@pythnetwork/` imports correctly.

**Warnings fixed (57)**:

**`contracts/contracts/SwapRouter.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`

**`contracts/contracts/StrategyVault.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`
- Line 6: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`

**`contracts/contracts/StrategyRegistry.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/StrategyExecutor.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`
- Line 6: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/PriceOracle.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/utils/math/SafeCast.sol"`
- Line 5: `import ... from "@pythnetwork/pyth-sdk-solidity/IPyth.sol"`
- Line 6: `import ... from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol"`

**`contracts/contracts/MockERC20.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/token/ERC20/ERC20.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/access/Ownable.sol"`

**`contracts/contracts/LendingPool.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`
- Line 6: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`
- Line 10: `import ... from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol"`

**`contracts/contracts/IStrategyRegistry.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/FheForgeComposer.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`
- Line 6: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`

**`contracts/contracts/FheForgeBase.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/ExecutorContract.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/access/Ownable.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`
- Line 6: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`

**`contracts/contracts/mocks/VaultMock.sol`:**
- Line 5: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/mocks/SimplePythMock.sol`:**
- Line 4: `import ... from "@pythnetwork/pyth-sdk-solidity/IPyth.sol"`
- Line 5: `import ... from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol"`

**`contracts/contracts/mocks/PoolMock.sol`:**
- Line 5: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/libraries/SharedStrategyMeta.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/libraries/FHESafeMath128.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/interfaces/IStrategyVault.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/interfaces/ILendingPool.sol`:**
- Line 4: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/contracts/governance/FheForgeTimelock.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/governance/TimelockController.sol"`

**`contracts/contracts/governance/FheForgeGovernor.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/governance/Governor.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol"`
- Line 6: `import ... from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol"`
- Line 7: `import ... from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol"`
- Line 8: `import ... from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol"`
- Line 9: `import ... from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol"`
- Line 10: `import ... from "@openzeppelin/contracts/governance/utils/IVotes.sol"`
- Line 11: `import ... from "@openzeppelin/contracts/governance/TimelockController.sol"`

**`contracts/test-foundry/StrategyVault.t.sol`:**
- Line 8: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/test-foundry/StrategyRegistry.t.sol`:**
- Line 7: `import ... from "@fhenixprotocol/cofhe-contracts/ICofhe.sol"`
- Line 8: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/test-foundry/StrategyExecutor.t.sol`:**
- Line 8: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/test-foundry/PriceOracleHarness.sol`:**
- Line 5: `import ... from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol"`

**`contracts/test-foundry/PriceOracle.t.sol`:**
- Line 5: `import ... from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol"`

**`contracts/test-foundry/MockLendingPool.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"`
- Line 7: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

**`contracts/test-foundry/LendingPool.t.sol`:**
- Line 10: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`
- Line 11: `import ... from "@fhenixprotocol/cofhe-contracts/ICofhe.sol"`

**`contracts/test-foundry/FlashLoanReceiver.sol`:**
- Line 4: `import ... from "@openzeppelin/contracts/token/ERC20/IERC20.sol"`
- Line 5: `import ... from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol"`

**`contracts/test-foundry/FheForgeComposer.t.sol`:**
- Line 9: `import ... from "@fhenixprotocol/cofhe-contracts/FHE.sol"`

---

## Fix 2: `contracts/test-foundry/FheForgeComposer.t.sol` — Relative import for @cofhe

**File**: `contracts/test-foundry/FheForgeComposer.t.sol`, line 10

**Why this needs a different fix**: The Foundry remapping for `@cofhe/mock-contracts/` includes a path translation:
```
@cofhe/mock-contracts/=node_modules/@cofhe/mock-contracts/contracts/
```

This means `@cofhe/mock-contracts/MockTaskManager.sol` resolves to `node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol` (note the extra `/contracts/` directory). solhint can't discover this through path concatenation because the import prefix `@cofhe/mock-contracts/` needs to be stripped and replaced with a different path.

**Change**: Convert to relative path that both solhint and Foundry can resolve directly.

**Before**:
```solidity
import { MockTaskManager } from "@cofhe/mock-contracts/MockTaskManager.sol";
```

**After**:
```solidity
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
```

**Resolution verification**:
- From file: `contracts/test-foundry/FheForgeComposer.t.sol`
- Relative path `../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol`
- Resolves to: `contracts/node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol`
- File exists: ✓ (verified)

---

## Verification

After applying both fixes, verify with:

```bash
# 1. Check solhint target rules
npx solhint 'contracts/contracts/**/*.sol' 'contracts/test-foundry/**/*.sol' 2>/dev/null | grep -E 'import-path-check|compiler-version|no-global-import|no-unused-import|no-unused-vars|one-contract-per-file'
# Expected: 0 matches (empty output)

# 2. Full solhint output
npx solhint 'contracts/contracts/**/*.sol' 'contracts/test-foundry/**/*.sol' 2>/dev/null
# Expected: 0 errors, 0 of the target warnings

# 3. Forge build (no compilation errors)
cd contracts && forge build

# 4. Forge test (no regression)
cd contracts && forge test
# Expected: 284 passed, 0 failed
```

## Results (verified)

| Metric | Before | After |
|---|---|---|
| `import-path-check` warnings | 58 | 0 |
| `compiler-version` errors | 0 | 0 |
| `no-global-import` warnings | 0 | 0 |
| `no-unused-import` warnings | 0 | 0 |
| `no-unused-vars` warnings | 0 | 0 |
| `one-contract-per-file` warnings | 0 | 0 |
| forge tests | 284/284 pass | 284/284 pass |

## Excluded from scan

The following directories contain build artifacts or external dependencies and were deliberately excluded from solhint scanning (no changes needed):
- `contracts/out/` — Foundry build output
- `contracts/artifacts/` — Hardhat build output
- `contracts/hardhat/console.sol` — Hardhat dependency
- `contracts/node_modules/` — npm dependencies
- `contracts/lib/` — Foundry git dependencies
