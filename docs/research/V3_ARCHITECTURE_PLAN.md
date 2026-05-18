# FheForge V3 Architecture Plan — Clean FHE Integration + Repetition Elimination

## ACTUAL ARCHITECTURE (Current — Wave17)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FheForge (Current)                          │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ LendingPool   │  │ StrategyVault│  │ StrategyReg  │             │
│  │ ──────────── │  │ ──────────── │  │ ──────────── │             │
│  │ ReentrancyG  │  │ ReentrancyG  │  │ ReentrancyG  │             │
│  │ Pausable     │  │ Pausable     │  │ Pausable     │             │
│  │ SafeERC20    │  │ SafeERC20    │  │              │             │
│  │ SafeCast     │  │              │  │              │             │
│  │              │  │              │  │              │             │
│  │ OWNER immut  │  │ OWNER immut  │  │ OWNER immut  │             │
│  │ _ZERO immut  │  │ _ZERO immut  │  │ _ZERO immut  │             │
│  │ onlyOwner()  │  │ onlyOwner()  │  │ onlyOwner()  │             │
│  │ _onlyOwner() │  │ _onlyOwner() │  │ _onlyOwner() │             │
│  │ pause()      │  │ pause()      │  │ pause()      │             │
│  │ unpause()    │  │ unpause()    │  │ unpause()    │             │
│  │ event Paused │  │ event Paused │  │ event Paused │             │
│  │ ZeroAddress  │  │ ZeroAddress  │  │ ZeroAddress  │             │
│  │ ZeroAmount   │  │ ZeroAmount   │  │ ZeroAmount   │             │
│  │ OnlyOwner    │  │ OnlyOwner    │  │ OnlyOwner    │             │
│  │ TokenMismatch│  │ TokenMismatch│  │              │             │
│  │              │  │              │  │              │             │
│  │ supplyBal[]  │  │ positions[]  │  │ strategies[] │             │
│  │ borrowBal[]  │  │  .collateral │  │ encryptedTvls│             │
│  │ totalPlainB  │  │  .debt       │  │ idByHash     │             │
│  │ liquidReserve│  │ positionMeta │  │ proposeVault │             │
│  │ indices[]    │  │  6 mappings  │  │ acceptVault  │             │
│  │              │  │              │  │ pendingVault │             │
│  │ supply()     │  │ openPos(In)  │  │ incrTvl(In)  │             │
│  │ supplyEth()  │  │ openPos(e)   │  │ incrTvl(e)   │             │
│  │ repay()      │  │ addColl(In)  │  │ decrTvl(In)  │             │
│  │ withdraw()   │  │ addColl(e)   │  │ decrTvl(e)   │             │
│  │ checkLtv()   │  │ closePos()   │  │              │             │
│  │ borrowOracle │  │ emergencyWd │  │              │             │
│  │              │  │              │  │              │             │
│  │ ─── Composer path (onlyComposer) ───│              │             │
│  │ supplyToLend │  │              │  │              │             │
│  │ borrowFromL  │  │              │  │              │             │
│  │ repayBorrow  │  │              │  │              │             │
│  │              │  │              │  │              │             │
│  │ ─── Decrypt/Reveal (partial) ───│              │             │
│  │ requestEmerg │  │              │  │ getEncTvl()  │             │
│  │ emergWdProof │  │ getCollateral│  │              │             │
│  │ requestLiqChk│  │              │  │              │             │
│  │ liquidateWdPf│  │              │  │              │             │
│  │              │  │              │  │              │             │
│  │ ─── NO shield/unshield ────────│              │             │
│  │ ─── NO getSupplyBalance ───────│              │             │
│  │ ─── NO getBorrowBalance ───────│              │             │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ Composer      │  │ SwapRouter   │  │ PriceOracle   │             │
│  │ ──────────── │  │ ──────────── │  │ ──────────── │             │
│  │ ReentrancyG  │  │ Pausable     │  │ SafeCast     │             │
│  │ Pausable     │  │ SafeERC20    │  │ Pyth SDK     │             │
│  │ SafeERC20    │  │              │  │              │             │
│  │              │  │ OWNER immut  │  │ OWNER immut  │             │
│  │ OWNER immut  │  │ onlyOwner()  │  │ onlyOwner()  │             │
│  │ NotOwner() ←│  │ _onlyOwner() │  │ _onlyOwner() │             │
│  │ onlyOwner()  │  │ pause()      │  │ ZeroAddress  │             │
│  │ _onlyOwner() │  │ unpause()    │  │ ZeroAmount   │             │
│  │ pause()      │  │ ZeroAddress  │  │ OnlyOwner    │             │
│  │ unpause()    │  │ ZeroAmount   │  │ BPS_DEN=1e4  │             │
│  │ ZeroAddress  │  │ OnlyOwner    │  │ WAD=1e18     │             │
│  │              │  │              │  │              │             │
│  │ ─── Inline interfaces ──────── │  │              │             │
│  │ IRegistry    │  │ proposeExec  │  │ priceId[]    │             │
│  │ IStrategyV   │  │ acceptExec   │  │ fallbackP[]  │             │
│  │ ILendingPool │  │ pendingExec  │  │ hasFallback  │             │
│  │ ISwapRouter  │  │              │  │ staleness    │             │
│  │              │  │ intents[]    │  │ isStale()    │             │
│  │ openLevStrat │  │ nonces[]     │  │ _isPythStale│             │
│  │ rebalance()  │  │              │  │ getPriceUsd  │             │
│  │ sweepToken() │  │ submitIntent │  │ _normalizeP  │             │
│  │              │  │ executeIntent│  │ getPriceFB   │             │
│  │ _openVault ←─── BUG: passes   │  │ convertToUsd │             │
│  │   InEuint128│  │ InEuint128   │  │ convertFrom  │             │
│  │   instead of │  │ instead of   │  │              │             │
│  │   euint128   │  │ euint128     │  │ ─── Duplicated───         │
│  │              │  │              │  │ isStale logic│             │
│  └──────────────┘  └──────────────┘  │ Pyth validn  │             │
│                                      │ BPS_DEN/WAD  │             │
│  ┌──────────────────┐               └──────────────┘             │
│  │ SharedStrategyMeta│                                             │
│  │ ──────────────── │  ← Only used by Vault                       │
│  │ grantPositionAcl │  ← Pool does same inline (11×)              │
│  │ grantUpdatedHdl  │                                             │
│  └──────────────────┘                                             │
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ FHERC20 Reference (NOT integrated — external library) │         │
│  │ shield(ERC20→euint64)  unshield(euint64→claim)        │         │
│  │ claimUnshielded(proof→ERC20)  FHERC20WrapperClaim     │         │
│  │ FHESafeMath.tryIncrease/tryDecrease → (ebool, euint)  │         │
│  │ FHERC20Utils.checkOnTransferReceived                  │         │
│  │ Indicator system (7984.0000 base)                     │         │
│  └──────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

**Current problems visible in diagram:**
- 5× `onlyOwner/_onlyOwner/OWNER` boilerplate
- 4× `pause/unpause/Paused/Unpaused` with shadowed OZ events
- 3× `_ZERO` init
- 2× `BPS_DEN` + `WAD`
- 2× timelocked rotation (propose/accept)
- 11× inline `allowThis+allow` in Pool (Vault uses SharedMeta)
- 5× `isInitialized?add:incoming` in Pool
- 10× InEuint128/euint128 duplicate overloads (Vault+Registry)
- 4× inline interfaces in Composer (divergence risk)
- Composer bug: passes InEuint128 to Vault (should be euint128)
- Pool: NO getSupplyBalance/getBorrowBalance getters
- Pool: NO shield/unshield — supply just does transferFrom+encrypted store
- No FHERC20 integration — no proper shield/unshield lifecycle

---

## TARGET ARCHITECTURE (After V3 Refactor)

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FheForge V3 (Target)                         │
│                                                                     │
│  ┌────────────────────────────────────────────────────┐            │
│  │           FheForgeBase (abstract contract)         │            │
│  │ ──────────────────────────────────────────────────│            │
│  │ ReentrancyGuard, Pausable                         │            │
│  │ address public immutable OWNER                    │            │
│  │ euint128 internal immutable _ZERO                 │            │
│  │ modifier onlyOwner()                              │            │
│  │ function _onlyOwner() internal view               │            │
│  │ function pause() external onlyOwner               │            │
│  │ function unpause() external onlyOwner             │            │
│  │ ─── No custom Paused/Unpaused events (use OZ) ────│            │
│  │ ─── Shared errors ─────────────────────────────── │            │
│  │ error ZeroAddress()                               │            │
│  │ error ZeroAmount()                                │            │
│  │ error OnlyOwner()                                 │            │
│  │ error TokenMismatch()                             │            │
│  │ error EthTransferFailed()                         │            │
│  │ ─── Shared constants ──────────────────────────── │            │
│  │ uint256 public constant BPS_DEN = 1e4             │            │
│  │ uint256 public constant WAD = 1e18                │            │
│  │ ─── FHE helpers ───────────────────────────────── │            │
│  │ function _grantAcl(euint128 h, address user)       │            │
│  │     → FHE.allowThis(h); FHE.allow(h, user)        │            │
│  │ function _initBalance(euint128 s, euint128 i)      │            │
│  │     → euint128 (isInitialized?add:incoming)       │            │
│  │ function _safeSub(euint128 bal, euint128 amt)      │            │
│  │     → FHE.sub(bal, FHE.min(amt, bal))             │            │
│  │ function _safeDecrease(euint128 bal, euint128 amt) │            │
│  │     → (ebool ok, euint128 result) via FHESafeMath │            │
│  └────────────────────────────────────────────────────┘            │
│           ▲            ▲           ▲           ▲                   │
│           │            │           │           │                   │
│  ┌────────┴──┐  ┌─────┴─────┐ ┌──┴───────┐ ┌┴──────────┐        │
│  │LendingPool │  │StrategyV  │ │StrategyR │ │SwapRouter  │        │
│  │───────────│  │───────────│ │───────────│ │───────────│        │
│  │FheForgeBase│  │FheForgeBase│ │FheForgeBase│ │FheForgeBase│        │
│  │SafeERC20   │  │SafeERC20   │ │           │ │SafeERC20   │        │
│  │SafeCast    │  │SharedMeta  │ │SharedMeta │ │            │        │
│  │            │  │            │ │           │ │            │        │
│  │supplyBal[] │  │positions[] │ │strategies │ │TimelockedR│        │
│  │borrowBal[] │  │ .collateral│ │encTvls    │ │ Rotation  │        │
│  │totalPlainB │  │ .debt      │ │idByHash   │ │ mixin     │        │
│  │liquidReserv│  │positionMeta│ │           │ │intents[]  │        │
│  │indices[]   │  │            │ │           │ │nonces[]   │        │
│  │            │  │            │ │           │ │            │        │
│  │── SHIELD ──│  │            │ │           │ │            │        │
│  │shield(token│  │            │ │           │ │            │        │
│  │  ,amt,enc) │  │            │ │           │ │            │        │
│  │  →lock ERC │  │            │ │           │ │            │        │
│  │  →+encBal  │  │            │ │           │ │            │        │
│  │            │  │            │ │           │ │            │        │
│  │── UNSHIELD─│  │            │ │           │ │            │        │
│  │requestUnsh │  │            │ │           │ │            │        │
│  │  →allowPub │  │            │ │           │ │            │        │
│  │unshieldWith│  │            │ │           │ │            │        │
│  │  Proof()   │  │            │ │           │ │            │        │
│  │  →verify   │  │            │ │           │ │            │        │
│  │  →zero enc │  │            │ │           │ │            │        │
│  │  →unlock   │  │            │ │           │ │            │        │
│  │            │  │            │ │           │ │            │        │
│  │── GETTERS ─│  │            │ │           │ │            │        │
│  │getSupplyBal│  │getCollateral│ │getEncTvl  │ │            │        │
│  │  →allowSnd │  │ →allowSnd  │ │ →allowSnd │ │            │        │
│  │getBorrowBal│  │getPositionIds│ │           │ │            │        │
│  │  →allowSnd │  │            │ │           │ │            │        │
│  │            │  │            │ │           │ │            │        │
│  │── Composer ─│  │            │ │           │ │            │        │
│  │supplyToLend│  │openPos(e128│ │incrTvl(e) │ │            │        │
│  │borrowFromL │  │ only)      │ │decrTvl(e) │ │            │        │
│  │repayBorrow │  │addColl(e128│ │ (InEuint128│ │            │        │
│  │ (euint128  │  │  only)     │ │  removed) │ │            │        │
│  │  handles)  │  │closePos()  │ │           │ │            │        │
│  │            │  │emergencyWd │ │           │ │            │        │
│  │── Decrypt ─│  │            │ │           │ │            │        │
│  │requestLiqCh│  │            │ │           │ │            │        │
│  │liquidatePf │  │            │ │           │ │            │        │
│  │requestEmerg│  │            │ │           │ │            │        │
│  │emergWdProof│  │            │ │           │ │            │        │
│  └────────────┘  └────────────┘ └───────────┘ └────────────┘        │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │ Composer      │  │ PriceOracle   │                                │
│  │ ──────────── │  │ ──────────── │                                │
│  │ FheForgeBase │  │ FheForgeBase │                                │
│  │ SafeERC20    │  │ SafeCast     │                                │
│  │              │  │ Pyth SDK     │                                │
│  │              │  │              │                                │
│  │ ─── Shared ──│  │              │                                │
│  │ interfaces/  │  │ getPrice()   │                                │
│  │  ILendingPool│  │  → calls    │                                │
│  │  IStrategyV  │  │  _normalize │                                │
│  │  IRegistry   │  │  (deduped)  │                                │
│  │  ISwapRouter │  │ isStale()   │                                │
│  │  IWETH9      │  │  → calls    │                                │
│  │ (imported,   │  │  _isPythStale│                                │
│  │  not inline) │  │  (deduped)  │                                │
│  │              │  │              │                                │
│  │ openLevStrat │  │ fallbackP[] │                                │
│  │ rebalance()  │  │ staleness   │                                │
│  │ sweepToken() │  │ convertToUsd│                                │
│  │              │  │ convertFrom │                                │
│  │ _openVault ──│  │              │                                │
│  │   PASSES     │  └──────────────┘                                │
│  │   euint128 ✓ │                                                   │
│  └──────────────┘                                                   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐                       │
│  │ SharedStrategyMeta│  │ TimelockedRotation│                       │
│  │ (extended)        │  │ (abstract mixin)  │                       │
│  │ ──────────────── │  │ ──────────────── │                       │
│  │ grantPositionAcl │  │ propose(address)  │                       │
│  │ grantUpdatedHdl  │  │ accept()         │                       │
│  │ grantAcl(h,user) │  │ pendingX          │                       │
│  │ initBalance(s,i) │  │ pendingXEarliest  │                       │
│  │ safeSub(b,a)     │  │ X_ROTATION_DELAY  │                       │
│  │ safeDecrease(b,a)│  │ NoPendingX error  │                       │
│  └──────────────────┘  │ TimelockNotElapsed│                       │
│                         └──────────────────┘                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ contracts/interfaces/                                 │         │
│  │   ILendingPool.sol    (shared, not Composer-inline)  │         │
│  │   IStrategyVault.sol  (shared)                       │         │
│  │   IStrategyRegistry.sol (already exists)              │         │
│  │   ISwapRouter.sol     (shared)                       │         │
│  │   IWETH9.sol          (shared)                       │         │
│  └──────────────────────────────────────────────────────┘         │
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ FHE Data Flow (V3 — proper shield/unshield/getters)   │         │
│  │                                                        │         │
│  │  USER ──encryptInputs──→ InEuint128 ──setAccount──→ tx│         │
│  │    │                                                   │         │
│  │    ├── shield(token, amount, InEuint128)               │         │
│  │    │     Pool: FHE.asEuint128(enc) → euint128         │         │
│  │    │     Pool: +encryptedSupplyBalance                 │         │
│  │    │     Pool: _grantAcl(newBal, user)                 │         │
│  │    │     Pool: ERC20.lock(amount) into liquidReserve  │         │
│  │    │                                                   │         │
│  │    ├── getSupplyBalance(token) → euint128             │         │
│  │    │     Pool: FHE.allow(bal, msg.sender)              │         │
│  │    │     Pool: FHE.allowSender(bal)                    │         │
│  │    │     User: decryptForView(bal) → plaintext        │         │
│  │    │                                                   │         │
│  │    ├── requestUnshield(token)                          │         │
│  │    │     Pool: FHE.allowPublic(supplyBal)              │         │
│  │    │                                                   │         │
│  │    ├── unshieldWithProof(token, proof, sig)            │         │
│  │    │     Pool: FHE.verifyDecryptResult(bal, proof, sig)│         │
│  │    │     Pool: supplyBal = _ZERO                       │         │
│  │    │     Pool: ERC20.unlock(proof) → user              │         │
│  │    │                                                   │         │
│  │    └── COMPOSER PATH (cross-contract)                  │         │
│  │          Composer: FHE.asEuint128(enc) → euint128     │         │
│  │          Composer: FHE.allowTransient(h, pool)         │         │
│  │          Composer: POOL.supplyToLending(t,a,h,u)      │         │
│  │          Pool: receives euint128 (already authorized)  │         │
│  │          Pool: NO FHE.asEuint128 on received handles   │         │
│  └──────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## PHASE PLAN — V3 Refactor (8 phases)

### Phase V3-0: Fix bugs + add missing getters (immediate, no arch change)

**Scope**: LendingPool, FheForgeComposer
**Risk**: LOW — additive + bug fix

| # | Change | File | Detail |
|---|--------|------|--------|
| V3-0a | Fix Composer→Vault InEuint128 bug | Composer.sol | `_openVaultPosition`: pass `incomingColl` (euint128) not `e.collateral` (InEuint128) to Vault.openPosition |
| V3-0b | Add Pool getSupplyBalance | LendingPool.sol | `getSupplyBalance(token) → euint128` with `allow+allowSender` |
| V3-0c | Add Pool getBorrowBalance | LendingPool.sol | `getBorrowBalance(token) → euint128` with `allow+allowSender` |
| V3-0d | Remove Vault InEuint128 openPosition overload | StrategyVault.sol | Keep only `openPosition(token,amount,euint128,strategyId,user)` |
| V3-0e | Remove Vault InEuint128 addCollateral overload | StrategyVault.sol | Keep only `addCollateral(positionId,token,amount,euint128,user)` |
| V3-0f | Remove Registry InEuint128 overloads | StrategyRegistry.sol | Keep only `incrementTvl(id,euint128)` and `decrementTvl(id,euint128)` |
| V3-0g | Remove custom Paused/Unpaused events | All 4 contracts | Rely on OZ `Pausable` events which include `address account` |

**Verification**: compile + audit-quick all 10 PASS

---

### Phase V3-1: Extract shared abstractions

**Scope**: New files + refactor all 6 contracts
**Risk**: MEDIUM — structural but behavior-preserving

| # | Change | File | Detail |
|---|--------|------|--------|
| V3-1a | Create `FheForgeBase.sol` | contracts/contracts/ | Abstract: OWNER, onlyOwner, _onlyOwner, _ZERO init, pause/unpause (no custom events), shared errors (ZeroAddress, ZeroAmount, OnlyOwner, TokenMismatch, EthTransferFailed), shared constants (BPS_DEN, WAD), _grantAcl, _initBalance, _safeSub |
| V3-1b | Create `TimelockedRotation.sol` | contracts/contracts/libraries/ | Abstract mixin: proposeX/acceptX, pending+pendingEarliest state, delay immutable, NoPending/TimelockNotElapsed errors |
| V3-1c | Extend `SharedStrategyMeta.sol` | existing file | Add `grantAcl(handle, user)`, `initBalance(stored, incoming)`, `safeDecrease(balance, amount)` |
| V3-1d | Create `contracts/interfaces/` | new dir | Extract ILendingPool, IStrategyVault, ISwapRouter, IWETH9 from Composer inline defs |
| V3-1e | Refactor Pool → inherits FheForgeBase | LendingPool.sol | Remove duplicated OWNER, onlyOwner, _ZERO, pause/unpause, errors, constants. Use _grantAcl, _initBalance, _safeSub |
| V3-1f | Refactor Vault → inherits FheForgeBase | StrategyVault.sol | Same removal. Use SharedMeta for ACL |
| V3-1g | Refactor Registry → inherits FheForgeBase + TimelockedRotation | StrategyRegistry.sol | Same + extract vault rotation to mixin |
| V3-1h | Refactor Router → inherits FheForgeBase + TimelockedRotation | SwapRouter.sol | Same + extract executor rotation to mixin |
| V3-1i | Refactor Oracle → inherits FheForgeBase | PriceOracle.sol | Remove duplicated OWNER, onlyOwner, errors, BPS_DEN, WAD |
| V3-1j | Refactor Composer → inherits FheForgeBase | FheForgeComposer.sol | Remove duplicated OWNER, onlyOwner, pause/unpause. Import shared interfaces. Fix NotOwner→OnlyOwner |
| V3-1k | Deduplicate Oracle isStale/_isPythStale | PriceOracle.sol | `isStale` calls `_isPythStale` |
| V3-1l | Deduplicate Oracle getPriceUsd/_normalizePythPrice | PriceOracle.sol | `getPriceUsd` calls `_normalizePythPrice` |

**Verification**: compile + audit-quick + type-check UI

---

### Phase V3-2: Shield/Unshield lifecycle

**Scope**: LendingPool (core FHE token flow)
**Risk**: HIGH — new user-facing functions, changes supply/withdraw semantics
**Model**: FHERC20ERC20Wrapper pattern (shield/unshield/claimUnshielded)

| # | Change | File | Detail |
|---|--------|------|--------|
| V3-2a | Add `shield(token, amount, InEuint128)` | LendingPool.sol | Lock ERC20 from user → +encryptedSupplyBalance. Equivalent to current `supply` but with explicit "shield" naming. Renames supply→shield for clarity |
| V3-2b | Add `requestUnshield(token)` | LendingPool.sol | `FHE.allowPublic(supplyBalances[token][msg.sender])` — marks for decryption. Emit `UnshieldRequested` |
| V3-2c | Add `unshieldWithProof(token, proof, sig)` | LendingPool.sol | `FHE.verifyDecryptResult(bal, proof, sig)` → verify → set supplyBal to _ZERO → `ERC20.safeTransfer(user, proof)`. Emit `Unshielded` |
| V3-2d | Keep `supply` as alias for `shield` | LendingPool.sol | Backwards compat — supply just calls shield |
| V3-2e | Keep `withdraw` for partial unshield | LendingPool.sol | Withdraw remains: encrypted subtract + plain transfer. For full position exit, use unshieldWithProof |
| V3-2f | Composer cross-contract: `supplyToLending` stays | LendingPool.sol | Composer uses supplyToLending (euint128 handle path), not shield |

**CoFHE pattern alignment**:
- **Shield** = deposit plain ERC20 → mint encrypted balance (FHERC20 `_mint` pattern)
- **Unshield** = burn encrypted balance → withdraw plain ERC20 (FHERC20 `_burn` + `allowPublic` + `verifyDecryptResult` + claim pattern)
- **Getters** = `allowSender` for `decryptForView` (not `allowPublic`)

**Verification**: compile + deploy Wave18 + test shield/unshield flow on-chain

---

### Phase V3-3: Borrow reveal flow

**Scope**: LendingPool borrow + emergency
**Risk**: MEDIUM

| # | Change | File | Detail |
|---|--------|------|--------|
| V3-3a | Add `requestBorrowReveal(token)` | LendingPool.sol | `FHE.allowPublic(borrowBalances[token][msg.sender])` — for user to see own debt |
| V3-3b | Add `repayWithProof(token, proof, sig, amount)` | LendingPool.sol | After reveal, user repays exact proven amount. `verifyDecryptResult` → encrypted sub |
| V3-3c | Emergency: keep `emergencyWithdrawWithProof` | LendingPool.sol | Already done in P5 ✓ |
| V3-3d | Liquidation: keep `liquidateWithProof` | LendingPool.sol | Already done in P5 ✓ |

---

### Phase V3-4: Remove remaining InEuint128 overloads

**Scope**: All contracts
**Risk**: LOW — dead code removal

Already done in V3-0d/e/f for Vault+Registry. After V3-1j, Composer uses shared interfaces that only declare euint128 variants.

**Verification**: search for `InEuint128` across contracts — only `supply`, `shield`, `repay` user-facing functions should have it (where user sends encrypted input). All cross-contract paths use euint128.

---

### Phase V3-5: FHESafeMath integration

**Scope**: LendingPool + StrategyVault
**Risk**: MEDIUM — changes overflow handling

Port `FHESafeMath.tryIncrease/tryDecrease` from FHERC20 reference to FheForge:
- `_safeDecrease(euint128 balance, euint128 amount) → (ebool ok, euint128 result)` — detects underflow
- Use in `withdraw`, `repay`, `closePosition` — currently use `FHE.min(amount, balance)` which silently caps (doesn't flag underflow)
- With `tryDecrease`: get `ebool ok` → `FHE.select(ok, newBal, oldBal)` — safe fallback without reverting

**Verification**: compile + unit test underflow scenarios

---

### Phase V3-6: Interest accrual with encrypted index (P3 completion)

**Scope**: LendingPool
**Risk**: HIGH — core lending math

Current P3 has plain indices. For full FHE:
- `accrueInterest` updates plain indices (protocol-level, OK to keep plain)
- Per-user balance = `supplyShares * currentIndex / userSnapshotIndex`
- No scalar multiply needed — `FHE.mul(encShares, FHE.asEuint128(currentIndex))` then `FHE.div(result, FHE.asEuint128(userSnapshot))`
- Or simpler: shares-based like ERC-4626 (P7b from V2 plan)

**Defer**: This phase is complex. Ship V3-0 through V3-5 first.

---

### Phase V3-7: Frontend alignment

**Scope**: UI hooks
**Risk**: LOW

| # | Change | File |
|---|--------|------|
| V3-7a | Add `useShield`/`useUnshield` hooks | ui/hooks/ |
| V3-7b | Add `getSupplyBalance`/`getBorrowBalance` with decryptForView | ui/hooks/use-lending-actions.ts |
| V3-7c | Add `requestBorrowReveal` + `repayWithProof` | ui/hooks/use-lending-actions.ts |
| V3-7d | Remove `requestEmergencyBalance` from normal flow (only for paused state) | ui/hooks/ |
| V3-7e | ABIs synced after Wave18 deploy | ui/abis/ |

---

### Phase V3-8: Deploy + full integration test

**Scope**: All contracts
**Risk**: LOW (if prior phases verified)

1. Deploy Wave18 with all V3-0 through V3-5 changes
2. Verify on Arbiscan + Sourcify
3. Run audit-quick (10 tests)
4. Test full shield→supply→borrow→repay→unshield lifecycle on-chain
5. Test Composer cross-contract flow with real encryptInputs+setAccount
6. Test emergency unshield (paused state)
7. Test liquidation with proof
8. Sync ABIs to ui/abis/
9. Update HANDOFF.md
10. Commit with Lore protocol

---

## EXECUTION ORDER

```
V3-0 (bug fixes + getters)     → compile + audit-quick
V3-1 (shared abstractions)     → compile + audit-quick + tsc
V3-2 (shield/unshield)         → compile + deploy Wave18 + on-chain test
V3-3 (borrow reveal)           → compile + deploy + test
V3-4 (remove InEuint128 overloads) → compile (already done in V3-0)
V3-5 (FHESafeMath)             → compile + test
V3-6 (interest with enc index) → DEFER (complex, ship after V3-5)
V3-7 (frontend alignment)      → tsc + manual UI test
V3-8 (deploy + full test)      → final verification
```

## Repetition Elimination Impact

| Repetition | Before | After | Phase |
|---|---|---|---|
| R1. Shared errors | 6× defined | 1× in FheForgeBase | V3-1 |
| R2. onlyOwner/_onlyOwner | 5× copy-paste | 1× in FheForgeBase | V3-1 |
| R3. OWNER immutable | 6× declared | 1× in FheForgeBase | V3-1 |
| R4. pause/unpause boilerplate | 4× copy-paste | 1× in FheForgeBase | V3-1 |
| R5. Timelocked rotation | 2× copy-paste | 1× TimelockedRotation mixin | V3-1 |
| R6. _ZERO init | 3× copy-paste | 1× in FheForgeBase | V3-1 |
| R7. BPS_DEN + WAD | 2× each | 1× in FheForgeBase | V3-1 |
| R8. using SafeERC20 | 4× | stays (per-contract using required) | n/a |
| R9. allowThis+allow (×15) | 11× inline in Pool | via _grantAcl + SharedMeta | V3-1 |
| R10. isInitialized?add:incoming (×5) | 5× inline in Pool | 1× _initBalance in FheForgeBase | V3-1 |
| R11. User/Composer function pairs | duplicated FHE math | shared _initBalance + _safeSub | V3-1 |
| R12. InEuint128/euint128 overloads (×10) | 4 funcs × 2 bodies | 1 body each | V3-0 |
| R13. Composer inline interfaces | 4 inline | 4 imported from interfaces/ | V3-1 |
| R14. IWETH9 local | 1× in Pool | 1× in interfaces/IWETH9.sol | V3-1 |
| R15. SharedStrategyMeta underused | Pool doesn't use | Pool uses extended version | V3-1 |
| R16. Oracle Pyth validation ×2 | inline + internal | getPriceUsd → _normalizePythPrice | V3-1 |
| R17. Oracle isStale ×2 | inline + internal | isStale → _isPythStale | V3-1 |
| R18. allowSender inconsistency | Pool no getters | Pool has getters with allowSender | V3-0 |
| R19. Re-encryption in liquidation ×2 | inline ×2 | _applySeize helper | V3-5 |
| R20. Redundant Paused/Unpaused events | 4× custom | 0× (use OZ events) | V3-0 |

**20/20 addressed** (was 3/20).

## Net Line Impact (estimated)

| | Before | After | Delta |
|---|---|---|---|
| FheForgeBase.sol | 0 | ~80 | +80 |
| TimelockedRotation.sol | 0 | ~35 | +35 |
| interfaces/ (4 files) | 0 | ~80 | +80 |
| SharedStrategyMeta.sol | 24 | ~45 | +21 |
| LendingPool.sol | 547 | ~420 | -127 |
| StrategyVault.sol | 330 | ~250 | -80 |
| StrategyRegistry.sol | 330 | ~240 | -90 |
| SwapRouter.sol | 188 | ~130 | -58 |
| PriceOracle.sol | 301 | ~260 | -41 |
| FheForgeComposer.sol | 388 | ~310 | -78 |
| **Total** | **2,081** | **~1,830** | **-251** |
