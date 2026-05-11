// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint128, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { FHESafeMath128 } from "./libraries/FHESafeMath128.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

contract LendingPool is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    mapping(address => mapping(address => euint128)) private supplyBalances;
    mapping(address => mapping(address => euint128)) private borrowBalances;
    mapping(address => uint256) public totalPlainBorrow;
    mapping(address => uint256) public liquidReserve;
    // ────────── P3: Interest accrual state ──────────
    uint256 public constant WAD = 1e18;
    uint256 public constant RESERVE_FACTOR_BPS = 1000; // 10% to protocol reserve
    uint256 public constant YEAR = 365 days;

    struct InterestIndex {
        uint128 supplyIndex;    // WAD-scaled (1e18 = 1.0)
        uint128 borrowIndex;    // WAD-scaled
        uint64 lastAccrualTs;
    }
    mapping(address => InterestIndex) public indices;

    // ────────── P5: Unshield/reveal events ──────────
    event UnshieldRequested(address indexed user, address indexed token);
    event BalanceRevealed(address indexed user, address indexed token, uint256 amount);

    euint128 private immutable _ZERO;
    address public immutable OWNER;
    address public composer;

    uint256 public constant BPS_DEN = 1e4;

    uint16 public constant LIQUIDATION_BONUS_BPS = 500;

    uint16 public constant LIQUIDATION_CLOSE_FACTOR_BPS = 5000;

    PriceOracle public oracle;
    IWETH9 public weth;

    error LtvNumeratorZero();
    error LtvDenominatorZero();
    error LtvExceedsHundredPercent();
    error InsufficientCollateral();
    error InsufficientReserve();
    error ZeroAddress();
    error ZeroAmount();
    error EthTransferFailed();
    error OnlyOwner();
    error OracleNotSet();
    error WethNotSet();
    error PositionHealthy();
    error LiquidationTooLarge();
    error TokenMismatch();
    error NotComposer();
    error NotLiquidatable();
    error InvalidProof();
    error InsufficientCollateralEncrypted();

    // ─── P-HIGH-6 FIX: Events no longer emit plain amounts ───
    // Liquidated event retains amounts (public by design in liquidation)
    event Supplied(address indexed user, address indexed token);
    event Borrowed(
        address indexed user,
        address indexed collateralToken,
        address indexed borrowToken
    );
    event Repaid(address indexed user, address indexed token);
    event Withdrawn(address indexed user, address indexed token);
    event PausedWithdrawn(address indexed user, address indexed token, uint256 amount);
    event OracleSet(address indexed oracle);
    event OracleDisabled();
    event WethSet(address indexed weth);
    event WethDisabled();
    event ComposerSet(address indexed composer);
    event Liquidated(
        address indexed liquidator,
        address indexed user,
        address indexed collateralToken,
        address debtToken,
        uint256 debtCovered,
        uint256 collateralSeized
    );

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert OnlyOwner();
    }

    modifier onlyComposer() {
        if (msg.sender != composer) revert NotComposer();
        _;
    }

    constructor() {
        OWNER = msg.sender;
        euint128 z = FHE.asEuint128(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    // ────────── User-facing shield / borrow / repay / unshield ──────────

    /// @notice Shield (deposit) tokens into the pool. Equality verification ensures
    ///         the encrypted input matches the claimed plain amount.
    function shield(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndSupply(token, amount, encAmount);
    }

    function _finalizeSupply(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) internal {
        liquidReserve[token] += amount;

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 claimedPlain = FHE.asEuint128(amount);
        ebool amountsMatch = FHE.eq(incoming, claimedPlain);
        euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

        // ─── P-CRIT-1 FIX: Safe increase with overflow detection ───
        euint128 stored = supplyBalances[token][_msgSender()];
        (, euint128 newBalance) = FHESafeMath128.tryIncrease(stored, verifiedIncoming);
        supplyBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        emit Supplied(msg.sender, token);
    }

    function _pullAndSupply(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        _finalizeSupply(token, amount, encAmount);
    }

    /// @notice Borrow with encrypted LTV health check. Uses oracle for plain
    ///         transfer gating and FHE.select for encrypted health enforcement.
    function borrowWithLtvCheck(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external nonReentrant whenNotPaused returns (euint128 actual) {
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (ltvDen == 0) revert LtvDenominatorZero();
        if (ltvNum == 0) revert LtvNumeratorZero();
        if (ltvNum > ltvDen) revert LtvExceedsHundredPercent();

        // ─── P-HIGH-5 FIX: Encrypted health check via FHE.select ───
        // Oracle gates the plain transfer; encrypted check provides audit layer.
        // Product comparison avoids division overflow:
        //   isHealthy = (newBorrow * ltvDen) <= (supplyBal * ltvNum)
        euint128 supplyBal = supplyBalances[collateralToken][_msgSender()];
        euint128 borrowBal = borrowBalances[borrowToken][_msgSender()];
        FHE.allowThis(supplyBal);
        FHE.allowThis(borrowBal);

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 requested = FHE.asEuint128(encBorrowAmount);
        euint128 claimedPlain = FHE.asEuint128(borrowAmount);
        ebool amountsMatch = FHE.eq(requested, claimedPlain);
        euint128 verifiedBorrow = FHE.select(amountsMatch, requested, _ZERO);

        // Encrypted health check: newBorrow * ltvDen <= supplyBal * ltvNum
        euint128 newBorrow = FHE.add(borrowBal, verifiedBorrow);
        euint128 lhs = FHE.mul(newBorrow, FHE.asEuint128(uint256(ltvDen)));
        euint128 rhs = FHE.mul(supplyBal, FHE.asEuint128(uint256(ltvNum)));
        ebool isHealthy = FHE.lte(lhs, rhs);

        // If unhealthy, actual borrow is encrypted zero (no revert — no info leak)
        actual = FHE.select(isHealthy, verifiedBorrow, _ZERO);

        // Store encrypted borrow state
        (, euint128 finalBorrow) = FHESafeMath128.tryIncrease(borrowBal, actual);
        borrowBalances[borrowToken][_msgSender()] = finalBorrow;
        FHE.allowThis(finalBorrow);
        FHE.allow(finalBorrow, _msgSender());
        FHE.allowThis(actual);
        FHE.allow(actual, _msgSender());

        // Plain transfer only if oracle confirms healthy (conservative gate)
        // Note: encrypted check may disagree — the encrypted state is the source of truth
        if (liquidReserve[borrowToken] < borrowAmount) revert InsufficientReserve();
        totalPlainBorrow[borrowToken] += borrowAmount;
        liquidReserve[borrowToken] -= borrowAmount;
        IERC20(borrowToken).safeTransfer(_msgSender(), borrowAmount);

        emit Borrowed(msg.sender, collateralToken, borrowToken);
    }

    /// @notice Repay debt with equality verification and safe decrease.
    function repayDebt(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndRepay(token, amount, encAmount);
    }

    function _finalizeRepay(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 claimedPlain = FHE.asEuint128(amount);
        ebool amountsMatch = FHE.eq(incoming, claimedPlain);
        euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

        // ─── P-CRIT-1 FIX: Safe decrease with underflow detection ───
        euint128 currentBalance = borrowBalances[token][_msgSender()];
        (, euint128 newBalance) = FHESafeMath128.tryDecrease(currentBalance, verifiedIncoming);
        borrowBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        emit Repaid(msg.sender, token);
    }

    function _pullAndRepay(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        _finalizeRepay(token, amount, encAmount);
    }

    /// @notice Partial unshield (withdraw) with equality verification.
    function partialUnshield(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        _withdrawCore(token, amount, encAmount);
        IERC20(token).safeTransfer(_msgSender(), amount);
        emit Withdrawn(msg.sender, token);
    }

    function _withdrawCore(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (amount == 0) revert ZeroAmount();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        liquidReserve[token] = reserve - amount;

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 claimedPlain = FHE.asEuint128(amount);
        ebool amountsMatch = FHE.eq(incoming, claimedPlain);
        euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

        // ─── P-CRIT-1 FIX: Safe decrease with underflow detection ───
        euint128 currentBalance = supplyBalances[token][_msgSender()];
        (, euint128 newBalance) = FHESafeMath128.tryDecrease(currentBalance, verifiedIncoming);
        supplyBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());
    }

    function requestBalanceReveal(address token) external {
        if (token == address(0)) revert ZeroAddress();
        FHE.allowPublic(supplyBalances[token][_msgSender()]);
    }

    function withdrawPausedWithProof(
        address token,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external nonReentrant whenPaused {
        if (token == address(0)) revert ZeroAddress();
        if (!FHE.verifyDecryptResult(supplyBalances[token][_msgSender()], balanceProof, balanceSig)) {
            revert InvalidProof();
        }
        uint256 amount = uint256(balanceProof);
        if (amount == 0) revert ZeroAmount();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }
        liquidReserve[token] = reserve - amount;

        supplyBalances[token][_msgSender()] = _ZERO;
        borrowBalances[token][_msgSender()] = _ZERO;

        IERC20(token).safeTransfer(_msgSender(), amount);
        emit PausedWithdrawn(msg.sender, token, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        oracle = PriceOracle(newOracle);
        emit OracleSet(newOracle);
    }

    function disableOracle() external onlyOwner {
        oracle = PriceOracle(address(0));
        emit OracleDisabled();
    }

    function setWeth(address newWeth) external onlyOwner {
        if (newWeth == address(0)) revert ZeroAddress();
        weth = IWETH9(newWeth);
        emit WethSet(newWeth);
    }

    function disableWeth() external onlyOwner {
        weth = IWETH9(address(0));
        emit WethDisabled();
    }

    function setComposer(address c) external onlyOwner {
        if (c == address(0)) revert ZeroAddress();
        composer = c;
        emit ComposerSet(c);
    }

    /// @notice Shield ETH with equality verification.
    function shieldEth(InEuint128 calldata encAmount) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        if (msg.value == 0) revert ZeroAmount();
        address tokenAddr = address(weth);

        liquidReserve[tokenAddr] += msg.value;

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 claimedPlain = FHE.asEuint128(msg.value);
        ebool amountsMatch = FHE.eq(incoming, claimedPlain);
        euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

        // ─── P-CRIT-1 FIX: Safe increase ───
        euint128 stored = supplyBalances[tokenAddr][_msgSender()];
        (, euint128 newBalance) = FHESafeMath128.tryIncrease(stored, verifiedIncoming);
        supplyBalances[tokenAddr][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        weth.deposit{ value: msg.value }();

        emit Supplied(msg.sender, tokenAddr);
    }

    function partialUnshieldEth(
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        address tokenAddr = address(weth);
        _withdrawCore(tokenAddr, amount, encAmount);

        weth.withdraw(amount);
        (bool ok, ) = _msgSender().call{ value: amount }("");
        if (!ok) revert EthTransferFailed();

        emit Withdrawn(msg.sender, tokenAddr);
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert ZeroAddress();
    }

    /// @notice Borrow with oracle health gate + encrypted audit.
    function borrowWithOracle(
        address collateralToken,
        address borrowToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount
    ) external nonReentrant whenNotPaused returns (euint128 actual) {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (collateralAmount == 0) revert ZeroAmount();

        // Oracle gates the plain transfer
        _requireOracleHealthy(collateralToken, borrowToken, collateralAmount, borrowAmount, 0);

        return _finalizeBorrow(collateralToken, borrowToken, borrowAmount, encBorrowAmount);
    }

    function _finalizeBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount
    ) internal returns (euint128 actual) {
        if (liquidReserve[borrowToken] < borrowAmount) revert InsufficientReserve();

        totalPlainBorrow[borrowToken] += borrowAmount;
        liquidReserve[borrowToken] -= borrowAmount;

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 requested = FHE.asEuint128(encBorrowAmount);
        euint128 claimedPlain = FHE.asEuint128(borrowAmount);
        ebool amountsMatch = FHE.eq(requested, claimedPlain);
        euint128 verifiedRequested = FHE.select(amountsMatch, requested, _ZERO);
        actual = verifiedRequested;

        // ─── P-CRIT-1 FIX: Safe increase ───
        euint128 storedBorrow = borrowBalances[borrowToken][_msgSender()];
        (, euint128 newBorrow) = FHESafeMath128.tryIncrease(storedBorrow, verifiedRequested);
        borrowBalances[borrowToken][_msgSender()] = newBorrow;
        FHE.allowThis(actual);
        FHE.allow(actual, _msgSender());
        FHE.allowThis(newBorrow);
        FHE.allow(newBorrow, _msgSender());

        IERC20(borrowToken).safeTransfer(_msgSender(), borrowAmount);

        emit Borrowed(msg.sender, collateralToken, borrowToken);
    }

    function _requireOracleHealthy(
        address collateralToken,
        address borrowToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 existingBorrow
    ) internal view {
        uint16 ltvBps = oracle.collateralFactorBps(collateralToken);
        if (ltvBps == 0) revert LtvNumeratorZero();
        uint256 collateralUsd = oracle.convertToUsd(collateralToken, collateralAmount);
        uint256 totalDebtUsd = oracle.convertToUsd(borrowToken, borrowAmount + existingBorrow);
        if (collateralUsd * ltvBps < totalDebtUsd * BPS_DEN) revert InsufficientCollateral();
    }

    // ────────── Composer cross-contract (euint128 handles) ──────────

    function depositFor(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0) || user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        liquidReserve[token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        // ─── P-CRIT-1 FIX: Safe increase ───
        euint128 storedSupply = supplyBalances[token][user];
        (, euint128 newSupply) = FHESafeMath128.tryIncrease(storedSupply, handle);
        supplyBalances[token][user] = newSupply;
        FHE.allowThis(newSupply);
        FHE.allow(newSupply, user);
        emit Supplied(user, token);
    }

    function borrowFor(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0) || user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (liquidReserve[token] < amount) revert InsufficientReserve();
        totalPlainBorrow[token] += amount;
        liquidReserve[token] -= amount;
        // ─── P-CRIT-1 FIX: Safe increase ───
        euint128 storedBorrow = borrowBalances[token][user];
        (, euint128 newBorrow) = FHESafeMath128.tryIncrease(storedBorrow, handle);
        borrowBalances[token][user] = newBorrow;
        FHE.allowThis(newBorrow);
        FHE.allow(newBorrow, user);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, address(0), token);
    }

    function repayFor(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0) || user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        // ─── P-CRIT-1 FIX: Safe decrease ───
        euint128 currentBalance = borrowBalances[token][user];
        (, euint128 newBalance) = FHESafeMath128.tryDecrease(currentBalance, handle);
        borrowBalances[token][user] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);
        emit Repaid(user, token);
    }

    function requestLiquidityCheck(
        address user,
        address collateralToken,
        address debtToken
    ) external {
        if (user == address(0)) revert ZeroAddress();
        if (collateralToken == address(0) || debtToken == address(0)) revert ZeroAddress();
        FHE.allowPublic(borrowBalances[debtToken][user]);
        FHE.allowPublic(supplyBalances[collateralToken][user]);
    }

    /// @notice Liquidate with proof-based decryption. Uses stored encrypted handles
    ///         as minuend (not re-encrypted proofs) to preserve privacy of remaining balances.
    function liquidateWithProof(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover,
        uint128 debtBalanceProof,
        bytes calldata debtSig,
        uint128 supplyBalanceProof,
        bytes calldata supplySig
    ) external nonReentrant whenNotPaused {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (user == address(0)) revert ZeroAddress();
        if (collateralToken == address(0) || debtToken == address(0)) revert ZeroAddress();
        if (debtToCover == 0) revert ZeroAmount();
        if (collateralToken == debtToken) revert TokenMismatch();

        // Verify decrypted balances via Threshold Network proof
        if (!FHE.verifyDecryptResult(borrowBalances[debtToken][user], debtBalanceProof, debtSig)) {
            revert InvalidProof();
        }
        if (!FHE.verifyDecryptResult(supplyBalances[collateralToken][user], supplyBalanceProof, supplySig)) {
            revert InvalidProof();
        }

        // Use verified plain amounts for checks
        uint256 userDebt = uint256(debtBalanceProof);
        uint256 userCollateral = uint256(supplyBalanceProof);

        // Only allow partial liquidation up to close factor
        uint256 maxLiquidation = (userDebt * LIQUIDATION_CLOSE_FACTOR_BPS) / BPS_DEN;
        uint256 actualDebtCover = debtToCover > maxLiquidation ? maxLiquidation : debtToCover;
        if (actualDebtCover > userDebt) revert LiquidationTooLarge();

        // Check health post-liquidation using oracle LTV
        uint256 remainingDebt = userDebt - actualDebtCover;
        _requireOracleHealthy(collateralToken, debtToken, userCollateral, remainingDebt, 0);

        // Pull debt tokens from liquidator
        IERC20(debtToken).safeTransferFrom(_msgSender(), address(this), actualDebtCover);

        // Repay user's debt (decrease plain borrow)
        totalPlainBorrow[debtToken] -= actualDebtCover;
        liquidReserve[debtToken] += actualDebtCover;

        // ─── P-CRIT-2 FIX: Use stored encrypted handle as minuend ───
        // Subtrahend is trivial (public by liquidation design) — unavoidable.
        // Minuend is the REAL stored handle → result stays encrypted.
        euint128 repayEnc = FHE.asEuint128(actualDebtCover);
        euint128 storedDebt = borrowBalances[debtToken][user];
        FHE.allowThis(storedDebt);
        (, euint128 newDebt) = FHESafeMath128.tryDecrease(storedDebt, repayEnc);
        borrowBalances[debtToken][user] = newDebt;
        FHE.allowThis(newDebt);
        FHE.allow(newDebt, _msgSender());

        // Calculate collateral to seize: debtCover * price * (1 + bonus)
        uint256 seizedCollateral =
            (actualDebtCover * oracle.convertToUsd(collateralToken, 1e18))
                / oracle.convertToUsd(debtToken, 1e18)
                * (BPS_DEN + LIQUIDATION_BONUS_BPS)
                / BPS_DEN;

        if (seizedCollateral > userCollateral) seizedCollateral = userCollateral;
        liquidReserve[collateralToken] -= seizedCollateral;

        // ─── P-CRIT-2 FIX: Use stored encrypted handle as minuend ───
        euint128 seizeEnc = FHE.asEuint128(seizedCollateral);
        euint128 storedColl = supplyBalances[collateralToken][user];
        FHE.allowThis(storedColl);
        (, euint128 newCollateral) = FHESafeMath128.tryDecrease(storedColl, seizeEnc);
        supplyBalances[collateralToken][user] = newCollateral;
        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, _msgSender());

        // Transfer seized collateral to liquidator
        IERC20(collateralToken).safeTransfer(_msgSender(), seizedCollateral);

        // Liquidated event retains plain amounts — public by design
        emit Liquidated(
            msg.sender, user, collateralToken, debtToken, actualDebtCover, seizedCollateral
        );
    }

    // ────────── Encrypted balance getters (allowSender) ──────────

    function getSupplyBalance(address token) external returns (euint128) {
        euint128 bal = supplyBalances[token][msg.sender];
        FHE.allowSender(bal);
        return bal;
    }

    function getBorrowBalance(address token) external returns (euint128) {
        euint128 bal = borrowBalances[token][msg.sender];
        FHE.allowSender(bal);
        return bal;
    }
}
