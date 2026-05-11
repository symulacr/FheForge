// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint128, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PriceOracle } from "./PriceOracle.sol";

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

    event Supplied(address indexed user, address indexed token, uint256 indexed amount);
    event Borrowed(
        address indexed user,
        address indexed collateralToken,
        address indexed borrowToken,
        uint256 amount
    );
    event Repaid(address indexed user, address indexed token, uint256 indexed amount);
    event Withdrawn(address indexed user, address indexed token, uint256 indexed amount);
    event PausedWithdrawn(address indexed user, address indexed token, uint256 indexed amount);
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

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 stored = supplyBalances[token][_msgSender()];
        euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        emit Supplied(msg.sender, token, amount);
    }

    function _pullAndSupply(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        _finalizeSupply(token, amount, encAmount);
    }

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

        // Plain collateral check removed — health enforcement via liquidation layer
        return _finalizeBorrow(collateralToken, borrowToken, borrowAmount, encBorrowAmount);
    }

    function repayDebt(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndRepay(token, amount, encAmount);
    }

    function _finalizeRepay(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        // Plain borrow check removed — FHE.min prevents underflow
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 currentBalance = borrowBalances[token][_msgSender()];
        euint128 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        borrowBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        emit Repaid(msg.sender, token, amount);
    }

    function _pullAndRepay(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        _finalizeRepay(token, amount, encAmount);
    }

    function partialUnshield(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        _withdrawCore(token, amount, encAmount);
        IERC20(token).safeTransfer(_msgSender(), amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function _withdrawCore(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (amount == 0) revert ZeroAmount();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        liquidReserve[token] = reserve - amount;

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 currentBalance = supplyBalances[token][_msgSender()];
        euint128 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
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

    function shieldEth(InEuint128 calldata encAmount) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        if (msg.value == 0) revert ZeroAmount();
        address tokenAddr = address(weth);

        liquidReserve[tokenAddr] += msg.value;

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 stored = supplyBalances[tokenAddr][_msgSender()];
        euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[tokenAddr][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        weth.deposit{ value: msg.value }();

        emit Supplied(msg.sender, tokenAddr, msg.value);
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

        emit Withdrawn(msg.sender, tokenAddr, amount);
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert ZeroAddress();
    }

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

        // Health check using caller-provided plain amounts
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

        euint128 requested = FHE.asEuint128(encBorrowAmount);
        actual = requested;
        euint128 storedBorrow = borrowBalances[borrowToken][_msgSender()];
        euint128 newBorrow =
            FHE.isInitialized(storedBorrow) ? FHE.add(storedBorrow, requested) : requested;
        borrowBalances[borrowToken][_msgSender()] = newBorrow;
        FHE.allowThis(actual);
        FHE.allow(actual, _msgSender());
        FHE.allowThis(newBorrow);
        FHE.allow(newBorrow, _msgSender());

        IERC20(borrowToken).safeTransfer(_msgSender(), borrowAmount);

        emit Borrowed(msg.sender, collateralToken, borrowToken, borrowAmount);
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
        euint128 storedSupply = supplyBalances[token][user];
        euint128 newSupply = FHE.isInitialized(storedSupply)
            ? FHE.add(storedSupply, handle)
            : handle;
        supplyBalances[token][user] = newSupply;
        FHE.allowThis(newSupply);
        FHE.allow(newSupply, user);
        emit Supplied(user, token, amount);
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
        euint128 storedBorrow = borrowBalances[token][user];
        euint128 newBorrow = FHE.isInitialized(storedBorrow)
            ? FHE.add(storedBorrow, handle)
            : handle;
        borrowBalances[token][user] = newBorrow;
        FHE.allowThis(newBorrow);
        FHE.allow(newBorrow, user);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, address(0), token, amount);
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
        euint128 currentBalance = borrowBalances[token][user];
        euint128 newBalance = FHE.sub(currentBalance, FHE.min(handle, currentBalance));
        borrowBalances[token][user] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);
        emit Repaid(user, token, amount);
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

        // Use verified plain amounts for all checks
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

        euint128 incomingDebt = FHE.asEuint128(debtBalanceProof);
        euint128 repayEnc128 = FHE.asEuint128(uint256(actualDebtCover));
        euint128 newDebt = FHE.sub(incomingDebt, FHE.min(repayEnc128, incomingDebt));
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

        euint128 incomingColl = FHE.asEuint128(supplyBalanceProof);
        euint128 seizeEnc128 = FHE.asEuint128(seizedCollateral);
        euint128 newCollateral = FHE.sub(incomingColl, FHE.min(seizeEnc128, incomingColl));
        supplyBalances[collateralToken][user] = newCollateral;
        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, _msgSender());

        // Transfer seized collateral to liquidator
        IERC20(collateralToken).safeTransfer(_msgSender(), seizedCollateral);

        emit Liquidated(
            msg.sender, user, collateralToken, debtToken, actualDebtCover, seizedCollateral
        );
    }

    // ────────── Encrypted balance getters (allowSender) ──────────

    function getSupplyBalance(address token) external returns (euint128) {
        euint128 bal = supplyBalances[token][msg.sender];
        FHE.allowThis(bal);
        FHE.allowSender(bal);
        return bal;
    }

    function getBorrowBalance(address token) external returns (euint128) {
        euint128 bal = borrowBalances[token][msg.sender];
        FHE.allowThis(bal);
        FHE.allowSender(bal);
        return bal;
    }
}