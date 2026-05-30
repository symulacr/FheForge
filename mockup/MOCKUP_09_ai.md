# MOCKUP 09 — Gemini AI Strategy Generation Module

## Sources Read

```
backend/apps/src/ai-strategy-builder/
├── ai-strategy-builder.module.ts          (34 lines)
├── application/
│   ├── gemini-ai.service.ts               (819 lines)
│   ├── ai-strategy-builder.service.ts     (142 lines)
│   ├── strategy-parser.service.ts         (555 lines)
│   ├── strategy-validator.service.ts      (351 lines)
│   ├── strategy-constraints.service.ts    (309 lines)
│   ├── strategy-templates.service.ts      (316 lines)
│   └── gas-estimation.service.ts          (49 lines)
└── interfaces/
    ├── ai-strategy-builder.controller.ts         (37 lines)
    ├── ai-strategy-builder-advanced.controller.ts (41 lines)
    └── dtos/
        ├── build-strategy.dto.ts               (49 lines)
        ├── build-strategy-response.dto.ts       (86 lines)
        ├── strategy-step-response.dto.ts        (45 lines)
        ├── analyze-risk.dto.ts                  (16 lines)
        └── optimize-strategy.dto.ts             (16 lines)
```

Dependencies (imported modules): `DefiModulesModule`, `DefiTokenModule`, `StrategiesModule`.

---

## API Surface

### `POST /ai-strategy-builder/build`
- Rate limited: **5 requests per 60s**
- Throttle applied at controller class level (`@Throttle`)

#### Request Body (`BuildStrategyDto`)
| Field | Type | Required | Constraints |
|---|---|---|---|
| `userIntent` | string | yes | minLength 5 |
| `additionalContext` | string | no | optional |
| `tokenAmount` | number | no | min 0 |

#### Response Body (`BuildStrategyResponseDto`)
```typescript
{
  steps: StrategyStepResponseDto[],
  validation: { isValid: boolean, errors: string[], warnings: string[] },
  metadata: { totalSteps, estimatedGas, riskLevel, aiGenerated: true },
  aiAnalysis?: { riskFactors: string[], recommendations: string[] }
}
```

Each `StrategyStepResponseDto`:
```typescript
{
  step: number,        // sequential, 1-indexed
  type: string,        // "SWAP" | "SUPPLY" | "BORROW" | "CLAIM_REWARDS"
  agent: string,       // always "COFHE"
  tokenIn?: { assetId, symbol, amount },
  tokenOut?: { assetId, symbol, amount }
}
```

### `POST /ai-strategy-builder/advanced/analyze-risk`
- Takes `{ steps: StrategyStepResponseDto[] }`
- Returns `{ riskLevel, riskFactors, recommendations }`

### `POST /ai-strategy-builder/advanced/optimize`
- Takes `{ steps: StrategyStepResponseDto[] }`
- Returns `{ optimizedSteps, optimizations[] }`

---

## Pipeline Architecture

```
User Intent
    │
    ▼
StrategyParserService.parseNaturalLanguage()
    ├── structured steps (numbered "1. Supply...2. Borrow..." etc) → parseStructuredSteps()
    ├── AI-powered (free-form intent)     → GeminiAiService.generateStrategySteps()
    └── fallback (on any error)           → fallbackParsing() → simple supply or custom
    │
    ▼
StrategyValidatorService.validateSteps(steps)
    ├── Per-step: required fields, operation type, token pair (via DefiPairsService.estimateDefiPair)
    ├── Sequential: sequence rules (SWAP⮕SUPPLY/SWAP, SUPPLY⮕BORROW, BORROW⮕SWAP/SUPPLY)
    ├── Overall: borrow without supply, borrow count >10 warning, >20 steps warning
    └── Flow: borrow/supply ratio balance
    │
    ▼
GeminiAiService.analyzeStrategyRisk(steps)    ← AI risk analysis (on BORROW steps)
    │
    ▼
AiStrategyBuilderService.calculateStrategyMetadata()
    ├── riskLevel: AI analysis → factor count heuristic → fallback (borrow ratio)
    └── estimatedGas: sum of GasEstimationService.estimateGasForStep per step
```

---

## Gemini AI Integration (`GeminiAiService`)

### Model
- `gemini-3-flash-preview` (hardcoded)
- API key from `GEMINI_API_KEY` env var
- Wraps `@google/generative-ai` SDK

### Strategy Generation Flow

1. **Intent classification**: `isMaximizeYieldRequest()` checks keywords → bypasses AI, uses templates
2. **Token extraction**: regex from intent and additionalContext for WETH/USDC/USDT
3. **Loop count extraction**: regex from intent (e.g. "3 loops", "2x")
4. **Initial swap detection**: if user specifies a different initial token than first-step token, auto-prepends a SWAP step
5. **Constraints assembly**: `StrategyConstraintsService` queries `DefiPairsService` for available swap pairs, supply, borrow operations
6. **Prompt construction**: `buildConstrainedPrompt()` — two variants:
   - **Structured mode** (user provides numbered steps): translation prompt with business rules
   - **Free-form mode**: full strategy generation prompt with available operations, loop logic, validation checklist
7. **Retry logic**: up to 3 retries with exponential backoff on 429 rate limits
8. **Response parsing**: extracts JSON from ` ```json ``` ` block, or raw JSON, or `JSON.parse(text)`
9. **Post-processing**: `filterDeadTypes()` removes non-valid operations, `addInitialSwapIfNeeded()` prepends swap

### Error Handling (exception hierarchy)
- `GeminiRateLimitException` — 429 status
- `GeminiAuthException` — 401 status
- `GeminiQuotaException` — 403/quota exceeded
- `GeminiParsingException` — empty/invalid JSON response
- `GeminiApiException` — timeout, generic errors

All extend `GeminiApiException` base (from `../../common/exceptions/gemini-api.exception`).

### Maximize-Yield Optimization

`generateMaximizeYieldStrategy()` bypasses AI and instead:
1. Extracts risk level from intent
2. Calls `getMaxLoopsForRisk(riskLevel)` → LOW:0, MEDIUM:3, HIGH:10
3. Picks highest APY template matching risk level and max loops
4. Adapts template to the user's input token and amount
5. Appends initial swap if needed

### Risk Analysis (`analyzeStrategyRisk`)
Prompt asks Gemini to evaluate: borrow count, token volatility, liquidation risk, contract risk, slippage. Falls back to a heuristic (borrow-step count based) on AI failure.

### Strategy Optimization (`optimizeStrategy`)
Prompt asks Gemini to reduce gas, improve capital efficiency, reduce liquidation risk, optimize LTV ratios. Falls back to identity (returns input unchanged) on failure.

---

## Strategy Parser (`StrategyParserService`)

### Input routing
1. **Structured steps** (`isStructuredStepsFormat`): matches `/\d+\.\s*(supply|lend|borrow|swap)/i` with ≥2 numbered items → regex-based `parseStructuredSteps()`
2. **AI-powered**: delegates to `GeminiAiService.generateStrategySteps()` for free-form English
3. **Fallback**: on any error (AI failure, parse failure, etc.) → `fallbackParsing()`:
   - `isCustomStrategy()`: checks for keyword presence (swap/supply/borrow/diversify/arbitrage/trade)
   - If custom: builds steps with simple keyword→operation mapping
   - Otherwise: single SUPPLY step

### Structured Steps Parser
Regex extracts step lines matching `\d+\.\s*[^,\d]+`. Each step classified as SUPPLY/LEND, BORROW, or SWAP/EXCHANGE. Maintains `currentTokenAmounts` ledger to track available tokens across steps. Extracts token amounts, percentages, LTV.

### Swap Rate Config
- `SWAP_RATE_WETH_USDC` (default 2500)
- `SWAP_RATE_USDC_WETH` (default 0.0004)
From config service. Used only in structured-swap and custom parsing paths (not in AI-generated steps — those are pure Gemini output).

---

## Validation (`StrategyValidatorService`)

### Per-step checks
- Required fields `type`, `agent` present
- Operation type is one of `[SWAP, SUPPLY, BORROW, CLAIM_REWARDS]`
- Token pair validation via `DefiPairsService.estimateDefiPair()` for SWAP, SUPPLY, BORROW
- Amount > 0 for tokenIn/tokenOut

### Sequence constraints
```
SWAP → SUPPLY, SWAP
SUPPLY → BORROW
BORROW → SWAP, SUPPLY
```
Violations are **warnings** at sequence level, **errors** at flow level.

### Overall strategy rules
- Cannot BORROW without a prior SUPPLY
- More than 10 BORROW steps → warning
- More than 20 total steps → warning
- More BORROW than SUPPLY → warning (unbalanced)
- Token amount discrepancy >50% between adjacent steps → warning

---

## Constraints (`StrategyConstraintsService`)

### Supported tokens
Hardcoded to **WETH, USDC, USDT** only. Token IDs from config (`TOKEN_WETH_ID`, `TOKEN_USDC_ID`, `TOKEN_USDT_ID`). Asset IDs from env (`TOKEN_WETH`, `TOKEN_USDC`, `TOKEN_USDT`).

### Available operations
Queries `DefiPairsService.getAvailablePairsForToken(tokenId)` which returns `{ asInput, asOutput }`. Maps:
- `asInput` pairs → SWAP operations (tokenIn→tokenOut)
- `asOutput` pairs → BORROW operations (tokenIn→tokenOut)
- Always adds a SUPPLY operation for the input token

### Leverage/risk constraint extraction
Regex-based from intent + additionalContext:
- "conservative"/"safe"/"low risk" → maxLeverage=2, riskLevel=LOW
- "aggressive"/"maximum"/"high risk" → maxLeverage=10, riskLevel=HIGH
- "moderate" → maxLeverage=5, riskLevel=MEDIUM
- Default: maxLeverage=3, riskLevel=MEDIUM

---

## Templates (`StrategyTemplatesService`)

5 hardcoded templates:

| ID | Name | APY | Risk | Loops |
|---|---|---|---|---|
| `simple-supply-usdc` | Simple USDC Supply | 5.2% | LOW | 0 |
| `usdc-weth-leverage-2x` | USDC-WETH Leverage 2x | 12.8% | MEDIUM | 2 |
| `usdc-weth-leverage-3x` | USDC-WETH Leverage 3x | 18.5% | MEDIUM | 3 |
| `usdt-weth-leverage-2x` | USDT-WETH Leverage 2x | 15.3% | MEDIUM | 2 |
| `aggressive-leverage-5x` | Aggressive Leverage 5x | 28.7% | HIGH | 5 |

`adaptTemplateToToken()` deep-clones the template's steps, swaps the first `tokenIn` symbol/assetId/amount to match the user's input token. Only rewrites the **first** step — all subsequent steps keep their original token symbols.

---

## Gas Estimation (`GasEstimationService`)

Hardcoded gas limits per operation type:
| Operation | Gas |
|---|---|
| SWAP | 150000 |
| SUPPLY | 100000 |
| BORROW | 120000 |
| CLAIM_REWARDS | 80000 |

If `COFHE_RPC` env var is set, queries live `gasPrice` from provider and computes `gasPrice * gasLimit`. Falls back to just gas limit number (not ether-denominated) if provider unavailable.

---

## Business Rules Summary

1. Only **WETH, USDC, USDT** tokens are supported
2. Only agent `"COFHE"` is used
3. Step types: **SWAP, SUPPLY, BORROW, CLAIM_REWARDS**
4. Sequence rules: `SWAP→{SUPPLY,SWAP}`, `SUPPLY→{BORROW}`, `BORROW→{SWAP,SUPPLY}`
5. SWAP cannot directly precede BORROW
6. SUPPLY cannot directly precede SWAP
7. BORROW must have a prior SUPPLY step
8. Initial token swap auto-prepends if user's starting token ≠ first-step token
9. Maximize-yield requests bypass AI and use template selection
10. Risk analysis calls AI (falls back to BORROW-count heuristic)

---

## Prompts (Gemini)

### Free-form strategy prompt (~1800 chars)
Injects: user intent, input token + assetId, initial token, loop count, additional context, max leverage, risk level, available operations list, supported tokens list, sequence business rules, loop logic examples, step JSON format, final validation checklist.

### Structured strategy prompt (~1300 chars)
Injects: user's numbered steps, input token, initial token, swap info, constraints, translation rules (lend→SUPPLY, etc.), sequence rules, step JSON format.

### Risk analysis prompt (~500 chars)
Injects: strategy steps JSON, asks for borrowing count, token volatility, liquidation risk, contract risk, slippage. Returns `{ riskLevel, riskFactors, recommendations }`.

### Optimization prompt (~500 chars)
Injects: current strategy steps JSON, optimization goals (gas, capital efficiency, LTV, liquidation risk). Returns `{ optimizedSteps, optimizations[] }`.

---

## Key Observations

- **Token universe is locked to WETH/USDC/USDT** — no path to add new tokens without code changes
- **Template adaptation is buggy**: `adaptTemplateToToken` only replaces the FIRST step's tokenIn; subsequent steps keep hardcoded USDC/WETH from the template, producing invalid strategies for mismatched tokens (e.g. USDT template adapted to WETH will have step 3 with USDT hardcoded)
- **Duplicate token extraction logic** lives in both `GeminiAiService` and `StrategyParserService` (identical regex patterns)
- **Gas fallback** on provider failure returns raw integer (gas limit), not ether-denominated cost — response field says "estimated gas" but unit is inconsistent (ether when provider works, raw gas when fallback)
- **No rate limit info surfaced to user** — Gemini returns 429, service throws `GeminiRateLimitException`, but the NestJS controller has no corresponding exception filter — the 429 won't be an HTTP 429, it'll likely be a 500 or the generic NestJS error
- **Risk analysis is called at least once, sometimes twice** per `buildStrategy` call (once in `generateRiskAnalysis`, potentially again in `calculateStrategyMetadata` if the first returned undefined). Wasteful.
- **Maximize-yield template path skips all constraints and validation** — no retry, no fallback, no validation feedback to user if template adaptation produces garbage
- **`extractInputTokenFromIntent` regex shares exact same implementation** (copy-paste) in `GeminiAiService` and `StrategyParserService`
