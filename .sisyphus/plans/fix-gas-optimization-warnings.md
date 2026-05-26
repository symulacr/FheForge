# Plan: Fix Solhint Gas Optimization Warnings

## Summary
- **Total warnings:** 95 (0 errors, 95 gas warnings)
- **Rule categories:** `gas-named-return-values` (88 warnings), `gas-length-in-loops` (7 warnings)
- **Strategy:** Fix all by making real code changes — no suppressions, no rule-disabling

---

## How These Warnings Were Enabled

`gas-named-return-values`, `gas-length-in-loops`, and related gas-consumption rules are bundled in solhint 6.2.1 under `lib/rules/gas-consumption/` but are **not part of `solhint:recommended`**. They must be explicitly enabled in `.solhint.json`:

Add to `contracts/.solhint.json` rules section:
```json
"gas-named-return-values": "warn",
"gas-length-in-loops": "warn",
"gas-small-strings": "warn",
"gas-increment-by-one": "warn",
"gas-strict-inequalities": "warn",
"gas-indexed-events": "warn",
"gas-struct-packing": "warn",
"gas-multitoken1155": "warn",
"gas-calldata-parameters": "warn"
```

---

## Rule 1: `gas-named-return-values` — 88 warnings

### What the rule means
Solhint flags functions with return types where the return variable is unnamed: `returns (uint256)` instead of `returns (uint256 result)`. Named returns save gas by eliminating the need to allocate a local variable before the implicit `return`.

### Fix pattern
Change `returns (Type)` → `returns (Type varName)` and add `varName = ...` where the function previously used `return value;`.

---

### File: `contracts/contracts/WETH9.sol` — 4 warnings

**Line 38:** `function totalSupply() public view returns (uint256)`
```diff
-    function totalSupply() public view returns (uint256) {
-        return address(this).balance;
+    function totalSupply() public view returns (uint256 totalSupply_) {
+        totalSupply_ = address(this).balance;
```

**Line 42:** `function approve(address guy, uint256 wad) public returns (bool)`
```diff
-    function approve(address guy, uint256 wad) public returns (bool) {
+    function approve(address guy, uint256 wad) public returns (bool approved) {
         allowance[msg.sender][guy] = wad;
         emit Approval(msg.sender, guy, wad);
-        return true;
+        approved = true;
```

**Line 48:** `function transfer(address dst, uint256 wad) public returns (bool)`
```diff
-    function transfer(address dst, uint256 wad) public returns (bool) {
+    function transfer(address dst, uint256 wad) public returns (bool transferred) {
```

**Line 52:** `function transferFrom(address src, address dst, uint256 wad) public returns (bool)`
```diff
-    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
+    function transferFrom(address src, address dst, uint256 wad) public returns (bool transferred) {
+        transferred = true;
     ...
-        return true;
```

---

### File: `contracts/contracts/TokenRegistry.sol` — 7 warnings

**Line 61:** `function getTokenCount() external view returns (uint256)`
```diff
-    function getTokenCount() external view returns (uint256) {
-        return tokenList.length;
+    function getTokenCount() external view returns (uint256 count) {
+        count = tokenList.length;
```

**Line 71:** `function getLendableTokens() external view returns (address[] memory)`
```diff
-    function getLendableTokens() external view returns (address[] memory) {
-        return _getTokensByFilter(TokenFilterType.Lendable);
+    function getLendableTokens() external view returns (address[] memory tokens) {
+        tokens = _getTokensByFilter(TokenFilterType.Lendable);
```

**Line 75:** `function getBorrowableTokens() external view returns (address[] memory)`
```diff
-    function getBorrowableTokens() external view returns (address[] memory) {
-        return _getTokensByFilter(TokenFilterType.Borrowable);
+    function getBorrowableTokens() external view returns (address[] memory tokens) {
+        tokens = _getTokensByFilter(TokenFilterType.Borrowable);
```

**Line 78:** `function getCollateralTokens() external view returns (address[] memory)`
```diff
-    function getCollateralTokens() external view returns (address[] memory) {
-        return _getTokensByFilter(TokenFilterType.Collateral);
+    function getCollateralTokens() external view returns (address[] memory tokens) {
+        tokens = _getTokensByFilter(TokenFilterType.Collateral);
```

**Line 82:** `function _getTokensByFilter(TokenFilterType filterType) private view returns (address[] memory)`
```diff
     function _getTokensByFilter(
         TokenFilterType filterType
-    ) private view returns (address[] memory) {
+    ) private view returns (address[] memory result) {
         uint256 count;
         for (uint256 i = 0; i < tokenList.length; ) {
             if (_matchesFilter(tokenList[i], filterType)) ++count;
@@ -91,7 +91,6 @@
             }
         }
-        address[] memory result = new address[](count);
+        result = new address[](count);
```

**Line 108:** `function _matchesFilter(address tokenAddr, TokenFilterType filterType) private view returns (bool)`
```diff
     function _matchesFilter(
         address tokenAddr,
         TokenFilterType filterType
-    ) private view returns (bool) {
+    ) private view returns (bool matches) {
         TokenInfo storage info = tokens[tokenAddr];
-        if (!info.enabled) return false;
-        if (filterType == TokenFilterType.Lendable) return info.isLendable;
-        if (filterType == TokenFilterType.Borrowable) return info.isBorrowable;
-        if (filterType == TokenFilterType.Collateral) return info.isCollateral;
-        return false;
+        if (!info.enabled) return matches;
+        if (filterType == TokenFilterType.Lendable) matches = info.isLendable;
+        else if (filterType == TokenFilterType.Borrowable) matches = info.isBorrowable;
+        else if (filterType == TokenFilterType.Collateral) matches = info.isCollateral;
```

**Line 120:** `function isTokenEnabled(address token) external view returns (bool)`
```diff
-    function isTokenEnabled(address token) external view returns (bool) {
-        return tokens[token].enabled;
+    function isTokenEnabled(address token) external view returns (bool enabled) {
+        enabled = tokens[token].enabled;
```

---

### File: `contracts/contracts/StrategyVault.sol` — 3 warnings

**Line 220:** `function getCollateral(bytes32 positionId) external returns (euint128)`
```diff
-    function getCollateral(bytes32 positionId) external returns (euint128) {
+    function getCollateral(bytes32 positionId) external returns (euint128 coll) {
-        euint128 coll = _ensureInitialized(positions[_msgSender()][positionId].collateral);
+        coll = _ensureInitialized(positions[_msgSender()][positionId].collateral);
```

**Line 235:** `function getDepositedAmount(bytes32 positionId) external view returns (uint256)`
```diff
-    function getDepositedAmount(bytes32 positionId) external view returns (uint256) {
-        return positionDepositedAmount[positionId];
+    function getDepositedAmount(bytes32 positionId) external view returns (uint256 amount) {
+        amount = positionDepositedAmount[positionId];
```

**Line 239:** `function getUserPositions(address user) external view returns (bytes32[] memory)`
```diff
-    function getUserPositions(address user) external view returns (bytes32[] memory) {
-        return userPositionIds[user];
+    function getUserPositions(address user) external view returns (bytes32[] memory ids) {
+        ids = userPositionIds[user];
```

---

### File: `contracts/contracts/StrategyRegistry.sol` — 1 warning

**Line 187:** `function getEncryptedTvl(uint256 strategyId) external returns (euint128)`
```diff
-    function getEncryptedTvl(uint256 strategyId) external returns (euint128) {
+    function getEncryptedTvl(uint256 strategyId) external returns (euint128 v) {
-        euint128 v = _ensureInitialized(encryptedTvls[strategyId]);
+        v = _ensureInitialized(encryptedTvls[strategyId]);
```

---

### File: `contracts/contracts/PriceOracle.sol` — 3 warnings

**Line 202:** `function isStale(address token) external view returns (bool)`
```diff
-    function isStale(address token) external view returns (bool) {
+    function isStale(address token) external view returns (bool stale) {
+        ...
+        stale = age > stalenessThreshold;
-        return age > stalenessThreshold;
```

**Line 246:** `function _isPythStale(bytes32 id, address token) internal view returns (bool)`
```diff
-    function _isPythStale(bytes32 id, address token) internal view returns (bool) {
+    function _isPythStale(bytes32 id, address token) internal view returns (bool stale) {
+        ...
+        stale = age > stalenessThreshold;
-        return age > stalenessThreshold;
```

**Line 343:** `function isSupported(address token) external view returns (bool)`
```diff
-    function isSupported(address token) external view returns (bool) {
-        return priceId[token] != bytes32(0);
+    function isSupported(address token) external view returns (bool supported) {
+        supported = priceId[token] != bytes32(0);
```

---

### File: `contracts/contracts/MockERC20.sol` — 1 warning

**Line 18:** `function decimals() public view override returns (uint8)`
```diff
-    function decimals() public view override returns (uint8) {
-        return _decimals;
+    function decimals() public view override returns (uint8 tokenDecimals) {
+        tokenDecimals = _decimals;
```

---

### File: `contracts/contracts/LendingPool.sol` — 5 warnings

**Line 523:** `function getSupplyBalance(address token) external payable returns (euint128)`
```diff
-    function getSupplyBalance(address token) external payable returns (euint128) {
+    function getSupplyBalance(address token) external payable returns (euint128 bal) {
-        euint128 bal = _ensureInitialized(supplyBalances[token][msg.sender]);
+        bal = _ensureInitialized(supplyBalances[token][msg.sender]);
```

**Line 529:** `function getBorrowBalance(address token) external payable returns (euint128)`
```diff
-    function getBorrowBalance(address token) external payable returns (euint128) {
+    function getBorrowBalance(address token) external payable returns (euint128 bal) {
-        euint128 bal = _ensureInitialized(borrowBalances[token][msg.sender]);
+        bal = _ensureInitialized(borrowBalances[token][msg.sender]);
```

**Line 544:** `function maxFlashLoan(address token) external view returns (uint256)`
```diff
-    function maxFlashLoan(address token) external view returns (uint256) {
+    function maxFlashLoan(address token) external view returns (uint256 maxLoan) {
         uint256 reserve = liquidReserve[token];
         uint256 borrowed = totalPlainBorrow[token];
-        if (reserve < borrowed) return 0;
+        if (reserve < borrowed) return maxLoan;
         unchecked {
-            return reserve - borrowed;
+            maxLoan = reserve - borrowed;
         }
```

**Line 553:** `function flashFee(address token, uint256 amount) external view returns (uint256)`
```diff
-    function flashFee(address token, uint256 amount) external view returns (uint256) {
+    function flashFee(address token, uint256 amount) external view returns (uint256 fee) {
         if (liquidReserve[token] == 0 && totalPlainBorrow[token] == 0)
             revert FlashLoanUnsupportedToken();
-        return (amount * FLASH_FEE_BPS) / 10000;
+        fee = (amount * FLASH_FEE_BPS) / 10000;
```

**Line 559:** `function flashLoan(...) external payable nonReentrant whenNotPaused returns (bool)`
```diff
     function flashLoan(
         address receiver,
         address token,
         uint256 amount,
         bytes calldata params
-    ) external payable nonReentrant whenNotPaused returns (bool) {
+    ) external payable nonReentrant whenNotPaused returns (bool flashSuccess) {
         ...
-        return true;
+        flashSuccess = true;
```

---

### File: `contracts/contracts/FheForgeComposer.sol` — 3 warnings

**Line 90:** `function _resolveStrategyId(OpenStrategyParams calldata p) internal returns (uint256)`
```diff
-    function _resolveStrategyId(OpenStrategyParams calldata p) internal returns (uint256) {
+    function _resolveStrategyId(OpenStrategyParams calldata p) internal returns (uint256 id) {
         if (p.strategyId == 0) {
-            return
-                REGISTRY.registerStrategy(p.strategyName, p.workflowHash, p.apyTarget, p.loopCount);
+            id = REGISTRY.registerStrategy(p.strategyName, p.workflowHash, p.apyTarget, p.loopCount);
+        } else {
+            id = p.strategyId;
         }
-        return p.strategyId;
```

**Line 98:** `function _openVaultPosition(...) internal returns (bytes32)`
```diff
     function _openVaultPosition(...)
+    ) internal returns (bytes32 positionId) {
-    ) internal returns (bytes32) {
-        if (p.collateralAmount == 0) return bytes32(0);
+        if (p.collateralAmount == 0) return positionId;
         ...
-        return VAULT.openPosition(...);
+        positionId = VAULT.openPosition(...);
```

**Line 142:** `function _submitSwap(...) internal returns (bytes32)`
```diff
     function _submitSwap(...)
-    ) internal returns (bytes32) {
+    ) internal returns (bytes32 intentId) {
         if (p.swapTokenOut == address(0)) {
             if (p.borrowToken != address(0)) {
                 ...
             }
-            return bytes32(0);
+            return intentId;
         }
-        return ROUTER.submitSwapIntent(...);
+        intentId = ROUTER.submitSwapIntent(...);
```

---

### File: `contracts/contracts/FheForgeBase.sol` — 7 warnings

**Line 57:** `function paused() public view returns (bool)`
```diff
-    function paused() public view returns (bool) {
-        return _poolGuard & _PAUSED != 0;
+    function paused() public view returns (bool isPaused) {
+        isPaused = _poolGuard & _PAUSED != 0;
```

**Line 72:** `function _msgSender() internal view returns (address)`
```diff
-    function _msgSender() internal view returns (address) {
-        return msg.sender;
+    function _msgSender() internal view returns (address sender) {
+        sender = msg.sender;
```

**Line 112:** `function owner() public view returns (address)`
```diff
-    function owner() public view returns (address) {
-        return _owner;
+    function owner() public view returns (address contractOwner) {
+        contractOwner = _owner;
```

**Line 138:** `function _ensureInitialized(euint128 handle) internal view returns (euint128)`
```diff
-    function _ensureInitialized(euint128 handle) internal view returns (euint128) {
-        return FHE.isInitialized(handle) ? handle : _ZERO;
+    function _ensureInitialized(euint128 handle) internal view returns (euint128 result) {
+        result = FHE.isInitialized(handle) ? handle : _ZERO;
```

**Line 147:** `function _safeIncrease(...) internal returns (euint128)`
```diff
     function _safeIncrease(...)
-    ) internal returns (euint128) {
+    ) internal returns (euint128 newBalance) {
-        (, euint128 newBalance) = FHESafeMath128.tryIncrease(stored, delta);
+        (, newBalance) = FHESafeMath128.tryIncrease(stored, delta);
```

**Line 157:** `function _safeDecrease(...) internal returns (euint128)`
```diff
     function _safeDecrease(...)
-    ) internal returns (euint128) {
+    ) internal returns (euint128 newBalance) {
-        (, euint128 newBalance) = FHESafeMath128.tryDecrease(stored, delta);
+        (, newBalance) = FHESafeMath128.tryDecrease(stored, delta);
```

**Line 167:** `function _verifyEquality(euint128 incoming, uint256 claimedPlain) internal returns (euint128)`
```diff
-    function _verifyEquality(euint128 incoming, uint256 claimedPlain) internal returns (euint128) {
+    function _verifyEquality(euint128 incoming, uint256 claimedPlain) internal returns (euint128 result) {
         _validateCiphertext(incoming);
         euint128 claimedEnc = FHE.asEuint128(claimedPlain);
         ebool match_ = FHE.eq(incoming, claimedEnc);
-        euint128 result = FHE.select(match_, incoming, _ZERO);
+        result = FHE.select(match_, incoming, _ZERO);
```

---

### File: `contracts/contracts/mocks/VaultMock.sol` — 5 warnings

**Line 21:** `function openPosition(...) external view returns (bytes32)`
```diff
-    function openPosition(...) external view returns (bytes32) {
-        return positionId;
+    function openPosition(...) external view returns (bytes32 id) {
+        id = positionId;
```

**Line 43:** `function getCollateral(bytes32) external pure returns (euint128)`
```diff
-    function getCollateral(bytes32) external pure returns (euint128) {
+    function getCollateral(bytes32) external pure returns (euint128 collateral) {
```

**Line 47:** `function getUserPositions(address) external pure returns (bytes32[] memory)`
```diff
-    function getUserPositions(address) external pure returns (bytes32[] memory) {
+    function getUserPositions(address) external pure returns (bytes32[] memory positions) {
```

**Line 51:** `function getPositionMeta(bytes32) external pure returns (uint256, uint256)`
```diff
-    function getPositionMeta(bytes32) external pure returns (uint256, uint256) {
+    function getPositionMeta(bytes32) external pure returns (uint256 strategyId, uint256 createdAt) {
```

**Line 55:** `function getDepositedAmount(bytes32) external pure returns (uint256)`
```diff
-    function getDepositedAmount(bytes32) external pure returns (uint256) {
+    function getDepositedAmount(bytes32) external pure returns (uint256 amount) {
```

---

### File: `contracts/contracts/mocks/SimplePythMock.sol` — 7 warnings

**Line 66:** `function parsePriceFeedUpdates(...) external payable returns (PythStructs.PriceFeed[] memory)`
```diff
     function parsePriceFeedUpdates(...)
-    ) external payable returns (PythStructs.PriceFeed[] memory) {
+    ) external payable returns (PythStructs.PriceFeed[] memory feeds) {
```

**Line 75:** `function parsePriceFeedUpdatesWithConfig(...) external payable returns (PythStructs.PriceFeed[] memory, uint64[] memory)`
```diff
     function parsePriceFeedUpdatesWithConfig(...)
-    ) external payable returns (PythStructs.PriceFeed[] memory, uint64[] memory) {
+    ) external payable returns (PythStructs.PriceFeed[] memory feeds, uint64[] memory configs) {
```

**Line 87:** `function parsePriceFeedUpdatesUnique(...) external payable returns (PythStructs.PriceFeed[] memory)`
```diff
     function parsePriceFeedUpdatesUnique(...)
-    ) external payable returns (PythStructs.PriceFeed[] memory) {
+    ) external payable returns (PythStructs.PriceFeed[] memory feeds) {
```

**Line 96:** `function parseTwapPriceFeedUpdates(...) external payable returns (PythStructs.TwapPriceFeed[] memory)`
```diff
     function parseTwapPriceFeedUpdates(...)
-    ) external payable returns (PythStructs.TwapPriceFeed[] memory) {
+    ) external payable returns (PythStructs.TwapPriceFeed[] memory twapFeeds) {
```

**Line 104:** `function priceFeedExists(bytes32) external pure returns (bool)`
```diff
-    function priceFeedExists(bytes32) external pure returns (bool) {
-        return true;
+    function priceFeedExists(bytes32) external pure returns (bool exists) {
+        exists = true;
```

**Line 108:** `function queryPriceFeed(bytes32) external pure returns (PythStructs.PriceFeed memory)`
```diff
-    function queryPriceFeed(bytes32) external pure returns (PythStructs.PriceFeed memory) {
+    function queryPriceFeed(bytes32) external pure returns (PythStructs.PriceFeed memory feed) {
```

**Line 112:** `function getValidTimePeriod() external pure returns (uint256)`
```diff
-    function getValidTimePeriod() external pure returns (uint256) {
-        return 0;
+    function getValidTimePeriod() external pure returns (uint256 period) {
+        period = 0;
```

---

### File: `contracts/contracts/mocks/RouterMock.sol` — 3 warnings

**Line 20:** `function submitSwapIntent(...) external view returns (bytes32)`
```diff
-    function submitSwapIntent(...) external view returns (bytes32) {
-        return intentId;
+    function submitSwapIntent(...) external view returns (bytes32 id) {
+        id = intentId;
```

**Line 34:** `function swapViaUniswapV3Single(...) external pure returns (uint256)`
```diff
-    function swapViaUniswapV3Single(...) external pure returns (uint256) {
+    function swapViaUniswapV3Single(...) external pure returns (uint256 amountOut) {
```

**Line 44:** `function swapViaUniswapV3MultiHop(...) external pure returns (uint256)`
```diff
-    function swapViaUniswapV3MultiHop(...) external pure returns (uint256) {
+    function swapViaUniswapV3MultiHop(...) external pure returns (uint256 amountOut) {
```

---

### File: `contracts/contracts/mocks/PoolMock.sol` — 6 warnings

**Line 39:** `function getSupplyBalance(address) external pure returns (euint128)`
```diff
-    function getSupplyBalance(address) external pure returns (euint128) {
+    function getSupplyBalance(address) external pure returns (euint128 supply) {
```

**Line 43:** `function getBorrowBalance(address) external pure returns (euint128)`
```diff
-    function getBorrowBalance(address) external pure returns (euint128) {
+    function getBorrowBalance(address) external pure returns (euint128 borrow) {
```

**Line 47:** `function getPlainSupplyBalance(address, address) external pure returns (uint256)`
```diff
-    function getPlainSupplyBalance(address, address) external pure returns (uint256) {
-        return 0;
+    function getPlainSupplyBalance(address, address) external pure returns (uint256 supply) {
+        supply = 0;
```

**Line 51:** `function getPlainBorrowBalance(address, address) external pure returns (uint256)`
```diff
-    function getPlainBorrowBalance(address, address) external pure returns (uint256) {
-        return 0;
+    function getPlainBorrowBalance(address, address) external pure returns (uint256 borrow) {
+        borrow = 0;
```

**Line 63:** `function borrowWithLtvCheck(...) external pure returns (euint128)`
```diff
     function borrowWithLtvCheck(...)
-    ) external pure returns (euint128) {
+    ) external pure returns (euint128 actual) {
```

**Line 74:** `function borrowWithOracle(...) external pure returns (euint128)`
```diff
     function borrowWithOracle(...)
-    ) external pure returns (euint128) {
+    ) external pure returns (euint128 actual) {
```

---

### File: `contracts/contracts/libraries/TimelockedRotation.sol` — 1 warning

**Line 30:** `function _acceptRole() internal returns (address)`
```diff
-    function _acceptRole() internal returns (address) {
+    function _acceptRole() internal returns (address newAddr) {
-        address newAddr = pendingRole;
+        newAddr = pendingRole;
```

---

### File: `contracts/contracts/libraries/SharedStrategyMeta.sol` — 2 warnings

**Line 35:** `function safeIncrease(...) internal returns (euint128)`
```diff
     function safeIncrease(...)
-    ) internal returns (euint128) {
+    ) internal returns (euint128 newBalance) {
```

**Line 48:** `function safeDecrease(...) internal returns (euint128)`
```diff
     function safeDecrease(...)
-    ) internal returns (euint128) {
+    ) internal returns (euint128 newBalance) {
```

---

### File: `contracts/contracts/interfaces/IWETH9.sol` — 2 warnings

**Line 7:** `function balanceOf(address) external view returns (uint256)`
```diff
-    function balanceOf(address) external view returns (uint256);
+    function balanceOf(address) external view returns (uint256 balance);
```

**Line 8:** `function transfer(address, uint256) external returns (bool)`
```diff
-    function transfer(address, uint256) external returns (bool);
+    function transfer(address, uint256) external returns (bool success);
```

---

### File: `contracts/contracts/interfaces/IStrategyVault.sol` — 4 warnings

**Line 7:** `function openPosition(...) external returns (bytes32)`
```diff
-    ) external returns (bytes32);
+    ) external returns (bytes32 positionId);
```

**Line 30:** `function getCollateral(bytes32 positionId) external returns (euint128)`
```diff
-    function getCollateral(bytes32 positionId) external returns (euint128);
+    function getCollateral(bytes32 positionId) external returns (euint128 collateral);
```

**Line 31:** `function getUserPositions(address user) external view returns (bytes32[] memory)`
```diff
-    function getUserPositions(address user) external view returns (bytes32[] memory);
+    function getUserPositions(address user) external view returns (bytes32[] memory positions);
```

**Line 35:** `function getDepositedAmount(bytes32 positionId) external view returns (uint256)`
```diff
-    function getDepositedAmount(bytes32 positionId) external view returns (uint256);
+    function getDepositedAmount(bytes32 positionId) external view returns (uint256 amount);
```

---

### File: `contracts/contracts/interfaces/IRegistry.sol` — 1 warning

**Line 12:** `function strategyCount() external view returns (uint256)`
```diff
-    function strategyCount() external view returns (uint256);
+    function strategyCount() external view returns (uint256 count);
```

---

### File: `contracts/contracts/interfaces/ILendingPool.sol` — 4 warnings

**Line 10:** `function borrowWithLtvCheck(...) external returns (euint128)`
```diff
-    ) external returns (euint128);
+    ) external returns (euint128 actual);
```

**Line 18:** `function borrowWithOracle(...) external returns (euint128)`
```diff
-    ) external returns (euint128);
+    ) external returns (euint128 actual);
```

**Line 51:** `function getSupplyBalance(address token) external returns (euint128)`
```diff
-    function getSupplyBalance(address token) external returns (euint128);
+    function getSupplyBalance(address token) external returns (euint128 supply);
```

**Line 52:** `function getBorrowBalance(address token) external returns (euint128)`
```diff
-    function getBorrowBalance(address token) external returns (euint128);
+    function getBorrowBalance(address token) external returns (euint128 borrow);
```

---

### File: `contracts/contracts/governance/FheForgeGovernor.sol` — 5 warnings

**Line 39:** `function state(uint256 proposalId) public view override(...) returns (ProposalState)`
```diff
     function state(
         uint256 proposalId
-    ) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
+    ) public view override(Governor, GovernorTimelockControl) returns (ProposalState proposalState) {
```

**Line 46:** `function proposalNeedsQueuing(uint256 proposalId) public view override(...) returns (bool)`
```diff
     function proposalNeedsQueuing(
         uint256 proposalId
-    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
+    ) public view override(Governor, GovernorTimelockControl) returns (bool needsQueuing) {
```

**Line 53:** `function _queueOperations(...) internal override(...) returns (uint48)`
```diff
     function _queueOperations(...)
-    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
+    ) internal override(Governor, GovernorTimelockControl) returns (uint48 queuedUntil) {
```

**Line 85:** `function _executor() internal view override(...) returns (address)`
```diff
     function _executor()
         internal
         view
         override(Governor, GovernorTimelockControl)
-        returns (address)
+        returns (address executorAddress)
```

**Line 95:** `function proposalThreshold() public pure override(...) returns (uint256)`
```diff
     function proposalThreshold()
         public
         pure
         override(Governor, GovernorSettings)
-        returns (uint256)
+        returns (uint256 threshold)
```

---

### File: `contracts/test-foundry/TokenRegistry.t.sol` — 1 warning

**Line 34:** `function _makeTokenInfo(...) internal pure returns (TokenRegistry.TokenInfo memory)`
```diff
     function _makeTokenInfo(...)
-    ) internal pure returns (TokenRegistry.TokenInfo memory) {
+    ) internal pure returns (TokenRegistry.TokenInfo memory info) {
```

---

### File: `contracts/test-foundry/TestHelper.sol` — 1 warning

**Line 44:** `function ownableRevertData(address caller) internal pure returns (bytes memory)`
```diff
-    function ownableRevertData(address caller) internal pure returns (bytes memory) {
-        return abi.encodeWithSelector(bytes4(0x118cdaa7), caller);
+    function ownableRevertData(address caller) internal pure returns (bytes memory revertData) {
+        revertData = abi.encodeWithSelector(bytes4(0x118cdaa7), caller);
```

---

### File: `contracts/test-foundry/PriceOracleHarness.sol` — 2 warnings

**Line 14:** `function exposedNormalizePythPrice(PythStructs.Price calldata p) external pure returns (uint256)`
```diff
     function exposedNormalizePythPrice(
         PythStructs.Price calldata p
-    ) external pure returns (uint256) {
+    ) external pure returns (uint256 price) {
```

**Line 20:** `function exposedIsPythStale(bytes32 id, address token) external view returns (bool)`
```diff
-    function exposedIsPythStale(bytes32 id, address token) external view returns (bool) {
+    function exposedIsPythStale(bytes32 id, address token) external view returns (bool stale) {
```

---

### File: `contracts/test-foundry/MockLendingPool.sol` — 4 warnings

**Line 66:** `function borrowWithLtvCheck(...) external returns (euint128)`
```diff
-    ) external returns (euint128) {
+    ) external returns (euint128 actual) {
```

**Line 77:** `function borrowWithOracle(...) external returns (euint128)`
```diff
-    ) external returns (euint128) {
+    ) external returns (euint128 actual) {
```

**Line 124:** `function getSupplyBalance(address) external returns (euint128)`
```diff
-    function getSupplyBalance(address) external returns (euint128) {
+    function getSupplyBalance(address) external returns (euint128 supply) {
```

**Line 128:** `function getBorrowBalance(address) external returns (euint128)`
```diff
-    function getBorrowBalance(address) external returns (euint128) {
+    function getBorrowBalance(address) external returns (euint128 borrow) {
```

---

### File: `contracts/test-foundry/KeyHelper.sol` — 3 warnings

**Line 11:** `function deriveKey(uint256 index) internal pure returns (uint256)`
```diff
-    function deriveKey(uint256 index) internal pure returns (uint256) {
-        return uint256(keccak256(abi.encode(index)));
+    function deriveKey(uint256 index) internal pure returns (uint256 key) {
+        key = uint256(keccak256(abi.encode(index)));
```

**Line 16:** `function deriveAddr(uint256 index) internal pure returns (address)`
```diff
-    function deriveAddr(uint256 index) internal pure returns (address) {
-        return vm.addr(deriveKey(index));
+    function deriveAddr(uint256 index) internal pure returns (address addr) {
+        addr = vm.addr(deriveKey(index));
```

**Line 21:** `function keyToAddr(uint256 pk) internal pure returns (address)`
```diff
-    function keyToAddr(uint256 pk) internal pure returns (address) {
-        return vm.addr(pk);
+    function keyToAddr(uint256 pk) internal pure returns (address addr) {
+        addr = vm.addr(pk);
```

---

### File: `contracts/test-foundry/FlashLoanReceiver.sol` — 1 warning

**Line 17:** `function onFlashLoan(...) external returns (bytes32)`
```diff
     function onFlashLoan(...)
-    ) external returns (bytes32) {
+    ) external returns (bytes32 result) {
```

---

### File: `contracts/test-foundry/FheForgeTestHelper.sol` — 1 warning

**Line 37:** `function getTaskManagerAddress() public pure returns (address)`
```diff
-    function getTaskManagerAddress() public pure returns (address) {
-        return TASK_MANAGER_ADDRESS;
+    function getTaskManagerAddress() public pure returns (address taskManager) {
+        taskManager = TASK_MANAGER_ADDRESS;
```

---

## Rule 2: `gas-length-in-loops` — 7 warnings

### What the rule means
Reading `.length` from storage every loop iteration is expensive. Cache it in a local variable before the loop.

### File: `contracts/contracts/TokenRegistry.sol` — 3 warnings

**Line 34:** `for (uint256 i = 0; i < tokenList.length; )`
```diff
+        uint256 tokenListLen = tokenList.length;
-        for (uint256 i = 0; i < tokenList.length; ) {
+        for (uint256 i = 0; i < tokenListLen; ) {
```

**Line 86:** `for (uint256 i = 0; i < tokenList.length; )`
```diff
+        uint256 tokenListLen = tokenList.length;
-        for (uint256 i = 0; i < tokenList.length; ) {
+        for (uint256 i = 0; i < tokenListLen; ) {
```

**Line 94:** `for (uint256 i = 0; i < tokenList.length; )`
```diff
+        uint256 tokenListLen = tokenList.length;
-        for (uint256 i = 0; i < tokenList.length; ) {
+        for (uint256 i = 0; i < tokenListLen; ) {
```

### File: `contracts/contracts/StrategyExecutor.sol` — 1 warning

**Line 68:** `for (uint256 i = startIdx; i < actions.length; )`
```diff
+        uint256 actionsLen = actions.length;
-        for (uint256 i = startIdx; i < actions.length; ) {
+        for (uint256 i = startIdx; i < actionsLen; ) {
```

### File: `contracts/contracts/PriceOracle.sol` — 2 warnings

**Line 106:** `for (uint256 i = 0; i < feeds.length; )`
```diff
+        uint256 feedsLen = feeds.length;
-        for (uint256 i = 0; i < feeds.length; ) {
+        for (uint256 i = 0; i < feedsLen; ) {
```

**Line 151:** `for (uint256 i = 0; i < registeredTokens.length; )`
```diff
+        uint256 tokensLen = registeredTokens.length;
-        for (uint256 i = 0; i < registeredTokens.length; ) {
+        for (uint256 i = 0; i < tokensLen; ) {
```

### File: `contracts/test-foundry/TokenRegistry.t.sol` — 1 warning

**Line 226:** `for (uint256 i; i < lendable.length; ++i)`
```diff
+        uint256 lendableLen = lendable.length;
-        for (uint256 i; i < lendable.length; ++i) {
+        for (uint256 i; i < lendableLen; ++i) {
```

I need to re-run more carefully.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="bash">
<｜｜DSML｜｜parameter name="command" string="true">cd /home/eya/archives/refactor/refactor-FheForge-work && npx solhint 'contracts/contracts/**/*.sol' 'contracts/test-foundry/**/*.sol' 2>/dev/null | grep -E 'gas-length-in-loops'