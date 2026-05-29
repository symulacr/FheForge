# ADR-004: Multi-Source Price Oracle

- **Status**: Accepted
- **Date**: 2026-05-28

## Context

FheForge requires accurate, manipulation-resistant price data for its encrypted lending and liquidation operations. The PriceOracle must serve prices for multiple tokens to support:

- **LTV checks in LendingPool**: `borrowWithOracle()` and `checkLtvAndBorrow()` use oracle prices to compute collateral value and ensure borrow amounts stay within the loan-to-value ratio.
- **Liquidation triggers**: `isLiquidatable()` compares a position's collateral value (in USD) against its debt value to determine if liquidation is permitted.
- **Swap routing**: SwapRouter may reference oracle prices for min-out validation and slippage checks.
- **USD conversion**: `convertToUsd()` converts encrypted amounts to a common USD basis for cross-token comparison.

A single-source oracle (e.g., only Pyth or only Chainlink) introduces a single point of failure. If the source goes down, returns stale data, or is manipulated, all LTV checks and liquidations are affected. The oracle design must support source diversity, per-token configuration, and staleness protection.

CoFHE's FHE comparison operations (`FHE.lte`) work only on `euint128` handles, not on raw `uint256` prices. This means USD values must be computed on encrypted amounts before comparison, not after.

## Decision

We implement a **PriceOracle** contract with per-token `SourceConfig` that supports Pyth, Chainlink, or custom oracle sources selected by a `SourceType` enum. Each token has an independent staleness threshold and collateral factor.

### SourceConfig Structure

Each registered token has a dedicated source configuration:

```solidity
enum SourceType { PYTH, CHAINLINK, CUSTOM }

struct SourceConfig {
    SourceType sourceType;      // Which oracle provider to use
    address addr;               // Oracle contract address (Pyth oracle, Chainlink aggregator, or custom)
    bytes32 priceId;            // Price feed identifier (Pyth price ID or Chainlink feed ID)
    uint256 stalenessThreshold; // Max age of price data in seconds before reverting
}
```

| Field | Pyth | Chainlink | Custom |
|---|---|---|---|
| `sourceType` | `SourceType.PYTH` | `SourceType.CHAINLINK` | `SourceType.CUSTOM` |
| `addr` | Pyth oracle contract address | Chainlink aggregator address | Custom oracle contract address |
| `priceId` | Pyth price feed ID (bytes32) | Chainlink feed ID (bytes32) | Custom feed identifier |
| `stalenessThreshold` | Max age in seconds | Max age in seconds | Max age in seconds |

### Token Registration

Tokens are registered with their price source via governance:

```solidity
function setSource(address token, SourceConfig calldata config) external onlyOwner;
```

This replaces any previous source configuration for the token. The `registeredTokens` array tracks all registered token addresses for enumeration.

### Price Retrieval Functions

The oracle provides several read paths:

- **`getPriceUsd(address token)`**: Returns the current USD price for a single token as a `uint256` with 8 decimals. Reverts if the price is stale (older than `stalenessThreshold`).
- **`getPriceWithFallback(address token, address fallbackToken)`**: Returns the price from the primary source, falling back to the price of `fallbackToken` if the primary is stale. Enables paired asset handling (e.g., use USDC price as fallback for USDT).
- **`convertToUsd(address token, uint256 amount)`**: Multiplies the token amount by its USD price, returning the USD equivalent as `uint256` with 8 decimals. Used by LendingPool for collateral valuation.
- **`isLiquidatable(address token, euint128 encryptedCollateral, euint128 encryptedDebt)`**: Converts encrypted collateral and debt to USD using oracle prices, then compares via `FHE.lte` to determine if the position is underwater.

The `isLiquidatable` function follows this encrypted flow:

```solidity
function isLiquidatable(
    address token,
    euint128 encCollateral,
    euint128 encDebt
) external view returns (ebool) {
    (uint256 price, uint8 decimals) = _getPriceWithDecimals(token);
    // Compute collateral USD value: encCollateral * price / 10**decimals
    euint128 collUsd = FHE.div(FHE.mul(encCollateral, FHE.asEuint128(price)), FHE.asEuint128(10 ** decimals));
    // Compute debt USD value
    euint128 debtUsd = FHE.div(FHE.mul(encDebt, FHE.asEuint128(price)), FHE.asEuint128(10 ** decimals));
    // Compare: is debt > collateral?
    return FHE.lt(debtUsd, collUsd);  // false = liquidatable
}
```

### Collateral Factor

`collateralFactorBps` defines the maximum borrowable percentage of collateral value per token, stored in the LendingPool or a shared config:

| Token | Collateral Factor | Meaning |
|---|---|---|
| USDC | 8000 (80%) | Borrow up to 80% of USDC collateral value |
| wETH | 7500 (75%) | Borrow up to 75% of wETH collateral value |
| wBTC | 7000 (70%) | Borrow up to 70% of wBTC collateral value |

The LTV check in `borrowWithOracle()` computes:

```
collateralValueUsd = collateralAmount * oracle.getPriceUsd(collateralToken)
maxBorrowUsd = collateralValueUsd * collateralFactorBps / 10000
require(borrowAmountUsd <= maxBorrowUsd)
```

### Source Selection Logic

Each registered token's `SourceConfig` determines how prices are fetched:

```
getPriceUsd(token):
  config = sourceConfigs[token]

  if config.sourceType == PYTH:
    return PythOracle(config.addr).getPriceEpoch(config.priceId, stalenessThreshold)

  else if config.sourceType == CHAINLINK:
    (answer, updatedAt) = AggregatorV3(config.addr).latestRoundData()
    require(block.timestamp - updatedAt <= config.stalenessThreshold)
    return answer

  else if config.sourceType == CUSTOM:
    return ICustomOracle(config.addr).getPrice(config.priceId)
```

Price feeds are updated by a keeper or governance via `updatePriceFeeds()`, which iterates `registeredTokens` and fetches current prices.

## Consequences

### Positive

- **Oracle diversity**: Per-token source selection means each token can use the most reliable oracle for its market. USDC might use Chainlink while wBTC uses Pyth, depending on liquidity and feed freshness.
- **Staleness protection**: The `stalenessThreshold` prevents liquidations and borrows from using outdated prices. If a feed is stale, the operation reverts rather than using unsafe data.
- **Per-token risk configuration**: `collateralFactorBps` allows the protocol to set conservative factors for volatile tokens and higher factors for stablecoins, reducing systemic liquidation risk.
- **Encrypted liquidation check**: `isLiquidatable()` performs the LTV comparison entirely on encrypted handles using FHE operations. The oracle price is the only non-encrypted input, and it is computed on-chain from a trusted source.
- **Fallback support**: `getPriceWithFallback()` enables graceful degradation when a primary feed is temporarily unavailable, paired with a stablecoin fallback.

### Negative

- **Staleness reverts block operations**: If a price feed is stale, any function that depends on `getPriceUsd()` (borrow, liquidate, convert) will revert. This protects against stale data but can temporarily block protocol operations.
- **Oracle update costs**: Each `updatePriceFeeds()` call iterates all registered tokens and fetches fresh prices on-chain, incurring variable gas costs proportional to the number of registered tokens.
- **Unencrypted price data**: Oracle prices are `uint256`, not `euint128`. This means the price feed itself is public, which is a fundamental limitation of current oracle technology. Users can infer approximate position values from liquidation events and oracle prices.
- **Source failure propagation**: If the Pyth oracle or Chainlink aggregator for a token becomes unavailable, all LTV checks and liquidations for that token are blocked until the feed resumes or governance updates the source.

### Risks

- The `isLiquidatable` function uses `FHE.mul` and `FHE.div` on encrypted handles with public price inputs. If the oracle price is manipulated (e.g., via a flash loan attack on the underlying exchange), the encrypted comparison could incorrectly flag positions as liquidatable or non-liquidatable. Mitigation: staleness thresholds and using time-weighted or TWAP-style prices from the oracle source.
- Oracle price decimals must be handled carefully. The `_getPriceWithDecimals()` helper standardizes prices to 8 decimals internally, but inconsistencies between token decimals (6 for USDC, 18 for wETH) and oracle decimals (variable) require explicit conversion in `convertToUsd()`.
- Governance control of `setSource()` means a malicious or compromised owner could point a token's price feed to a manipulated source. This is acceptable for the buildathon phase but should graduate to a timelock or multisig for production.
