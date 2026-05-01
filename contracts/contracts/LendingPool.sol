// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
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

interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

/// @title  LendingPool
/// @notice Confidential supply / borrow / repay / withdraw with FHE-encrypted
///         per-user balances mirrored by plaintext balances for transfer gating.
contract LendingPool is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    mapping(address => mapping(address => euint128)) private supplyBalances;
    mapping(address => mapping(address => euint128)) private borrowBalances;
    mapping(address => mapping(address => uint256)) private plainSupplyBalances;
    mapping(address => mapping(address => uint256)) private plainBorrowBalances;
    mapping(address => uint256) public totalPlainBorrow;
    mapping(address => uint256) public liquidReserve;

    euint128 private immutable _ZERO;
    address public immutable OWNER;

    uint256 public constant BPS_DEN = 1e4;
    /// @notice Liquidation bonus paid to liquidators (5% of seized collateral).
    uint16 public constant LIQUIDATION_BONUS_BPS = 500;
    /// @notice Max fraction of a borrow that can be liquidated in one call (50%).
    uint16 public constant LIQUIDATION_CLOSE_FACTOR_BPS = 5000;

    PriceOracle public oracle;
    IWETH9 public weth;

    /// @notice Uniswap Permit2 canonical singleton.
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    error LtvNumeratorZero();
    error LtvDenominatorZero();
    error LtvExceedsHundredPercent();
    error ExceedsBorrowBalance();
    error ExceedsSupplyBalance();
    error InsufficientCollateral();
    error InsufficientReserve();
    error UnhealthyAfterWithdraw();
    error ZeroAddress();
    error ZeroAmount();
    error EthTransferFailed();
    error OnlyOwner();
    error OracleNotSet();
    error WethNotSet();
    error PositionHealthy();
    error LiquidationTooLarge();
    error TokenMismatch();

    event Supplied(address indexed user, address indexed token, uint256 indexed amount);
    event Borrowed(
        address indexed user,
        address indexed collateralToken,
        address indexed borrowToken,
        uint256 amount
    );
    event Repaid(address indexed user, address indexed token, uint256 indexed amount);
    event Withdrawn(address indexed user, address indexed token, uint256 indexed amount);
    event EmergencyWithdrawn(address indexed user, address indexed token, uint256 indexed amount);
    event Paused();
    event Unpaused();
    event OracleSet(address indexed oracle);
    event OracleDisabled();
    event WethSet(address indexed weth);
    event WethDisabled();
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

    constructor() {
        OWNER = msg.sender;
        euint128 z = FHE.asEuint128(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    /// @notice Supply tokens; caller must have approved this contract.
    function supply(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndSupply(token, amount, encAmount);
    }

    /// @notice Supply via Permit2 — caller signs an EIP-712 PermitTransferFrom
    ///         off-chain after a one-time `IERC20.approve(PERMIT2, MAX)`.
    function supplyWithPermit2(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        _doPermit2Pull(token, amount, permit, signature);
        _finalizeSupply(token, amount, encAmount);
    }

    /// @dev Shared Permit2 pull — extracted to deduplicate `supplyWithPermit2`
    ///      and `repayWithPermit2` (their pre-call paths were 94% identical).
    function _doPermit2Pull(
        address token,
        uint256 amount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (permit.permitted.token != token) revert TokenMismatch();
        if (permit.permitted.amount != amount) revert ZeroAmount();
        IPermit2(PERMIT2).permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
            msg.sender,
            signature
        );
    }

    function _finalizeSupply(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) internal {
        plainSupplyBalances[token][msg.sender] += amount;
        liquidReserve[token] += amount;

        // Lazy-init: when the user has never supplied this token, the slot
        // is uninitialized and `FHE.add(uninit, incoming)` costs ~50k gas
        // for an add-with-zero. Skip the add and store the incoming handle
        // directly. ~200g cost per repeat user vs ~49.8k saved on first.
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 stored = supplyBalances[token][msg.sender];
        euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[token][msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allowSender(newBalance);

        emit Supplied(msg.sender, token, amount);
    }

    function _pullAndSupply(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _finalizeSupply(token, amount, encAmount);
    }

    /// @notice Borrow `borrowAmount` of `borrowToken` against supplied
    ///         `collateralToken` if `borrowAmount * ltvDen <= supply * ltvNum`.
    /// @return actual Encrypted handle of the amount actually borrowed.
    function checkLtvAndBorrow(
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

        uint256 supplied = plainSupplyBalances[collateralToken][msg.sender];
        if (supplied == 0) revert InsufficientCollateral();
        if (borrowAmount * ltvDen > supplied * ltvNum) revert InsufficientCollateral();

        uint256 existingBorrow = plainBorrowBalances[borrowToken][msg.sender];
        return
            _finalizeBorrow(
                collateralToken,
                borrowToken,
                borrowAmount,
                encBorrowAmount,
                existingBorrow
            );
    }

    function repay(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndRepay(token, amount, encAmount);
    }

    /// @notice Repay via Permit2.
    function repayWithPermit2(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        _doPermit2Pull(token, amount, permit, signature);
        _finalizeRepay(token, amount, encAmount);
    }

    function _finalizeRepay(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (amount > plainBorrowBalances[token][msg.sender]) revert ExceedsBorrowBalance();

        plainBorrowBalances[token][msg.sender] -= amount;
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 currentBalance = borrowBalances[token][msg.sender];
        euint128 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        borrowBalances[token][msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allowSender(newBalance);

        emit Repaid(msg.sender, token, amount);
    }

    function _pullAndRepay(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _finalizeRepay(token, amount, encAmount);
    }

    /// @notice Withdraw supplied tokens; reverts if the post-withdraw reserve
    ///         can no longer cover all outstanding borrows, or if the caller
    ///         has an outstanding borrow in this token that would become
    ///         under-collateralised.
    function withdraw(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        _withdrawCore(token, amount, encAmount);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @dev Shared core for `withdraw` and `withdrawEth` — extracted to
    ///      deduplicate the 21-line plain-mirror + reserve + FHE update
    ///      sequence (76% similarity in pre-refactor analyzer). Caller is
    ///      responsible for the post-withdrawal token / ETH transfer and
    ///      `Withdrawn` event emission.
    function _withdrawCore(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (amount == 0) revert ZeroAmount();
        // Cache hot mapping reads once — saves repeated keccak256(key, slot).
        mapping(address => uint256) storage plainSupply = plainSupplyBalances[token];
        uint256 currentSupply = plainSupply[msg.sender];
        if (amount > currentSupply) revert ExceedsSupplyBalance();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        uint256 ownBorrow = plainBorrowBalances[token][msg.sender];
        if (ownBorrow > 0 && currentSupply - amount < ownBorrow) {
            revert UnhealthyAfterWithdraw();
        }

        plainSupply[msg.sender] = currentSupply - amount;
        liquidReserve[token] = reserve - amount;

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 currentBalance = supplyBalances[token][msg.sender];
        euint128 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        supplyBalances[token][msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allowSender(newBalance);
    }

    /// @notice When paused, callers may pull their full plaintext supply
    ///         without touching encrypted state — for FHE-backend outages.
    function emergencyWithdraw(address token) external nonReentrant whenPaused {
        if (token == address(0)) revert ZeroAddress();
        uint256 amount = plainSupplyBalances[token][msg.sender];
        if (amount == 0) revert ZeroAmount();

        // Cache `liquidReserve[token]` once — saves 2 keccak hashes per call.
        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        plainSupplyBalances[token][msg.sender] = 0;
        liquidReserve[token] = reserve - amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit EmergencyWithdrawn(msg.sender, token, amount);
    }

    function pause() external onlyOwner {
        _pause();
        emit Paused();
    }

    function unpause() external onlyOwner {
        _unpause();
        emit Unpaused();
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        oracle = PriceOracle(newOracle);
        emit OracleSet(newOracle);
    }

    /// @notice Disable oracle-gated paths. Distinct from `setOracle(0)` which
    ///         is a hazard guard; this is the explicit kill-switch.
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

    /// @notice Supply native ETH; the pool wraps it to WETH internally.
    function supplyEth(InEuint128 calldata encAmount) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        if (msg.value == 0) revert ZeroAmount();
        address tokenAddr = address(weth);

        plainSupplyBalances[tokenAddr][msg.sender] += msg.value;
        liquidReserve[tokenAddr] += msg.value;

        // Lazy-init — see `_finalizeSupply`. Same first-call savings apply
        // here because supplyEth and supply share the encrypted slot.
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 stored = supplyBalances[tokenAddr][msg.sender];
        euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[tokenAddr][msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allowSender(newBalance);

        weth.deposit{ value: msg.value }();

        emit Supplied(msg.sender, tokenAddr, msg.value);
    }

    /// @notice Withdraw supplied tokens as native ETH; pool unwraps WETH.
    function withdrawEth(
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        address tokenAddr = address(weth);
        _withdrawCore(tokenAddr, amount, encAmount);

        weth.withdraw(amount);
        (bool ok, ) = msg.sender.call{ value: amount }("");
        if (!ok) revert EthTransferFailed();

        emit Withdrawn(msg.sender, tokenAddr, amount);
    }

    /// @dev Only accept ETH from the configured WETH contract during withdraw.
    receive() external payable {
        if (msg.sender != address(weth)) revert ZeroAddress();
    }

    /// @notice Borrow gated by the oracle's per-token collateral factor in
    ///         USD-normalised units. Recommended path; `checkLtvAndBorrow`
    ///         remains for callers who want to specify an explicit ratio.
    function borrowWithOracle(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount
    ) external nonReentrant whenNotPaused returns (euint128 actual) {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (plainSupplyBalances[collateralToken][msg.sender] == 0) revert InsufficientCollateral();

        uint256 existingBorrow = plainBorrowBalances[borrowToken][msg.sender];
        _requireOracleHealthy(collateralToken, borrowToken, borrowAmount, existingBorrow);

        return
            _finalizeBorrow(
                collateralToken,
                borrowToken,
                borrowAmount,
                encBorrowAmount,
                existingBorrow
            );
    }

    /// @dev Shared post-LTV-check finalization for `checkLtvAndBorrow` and
    ///      `borrowWithOracle` (72% similar, 18 lines shared in the
    ///      pre-refactor analyzer). Caller is responsible for token /
    ///      amount input validation, the supplied>0 check, and the
    ///      LTV gate (caller-supplied ratio vs oracle USD-debt). Both
    ///      callers cache `existingBorrow` once and pass it in to avoid
    ///      a second SLOAD inside the helper.
    function _finalizeBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount,
        uint256 existingBorrow
    ) internal returns (euint128 actual) {
        if (liquidReserve[borrowToken] < borrowAmount) revert InsufficientReserve();

        plainBorrowBalances[borrowToken][msg.sender] = existingBorrow + borrowAmount;
        totalPlainBorrow[borrowToken] += borrowAmount;
        liquidReserve[borrowToken] -= borrowAmount;

        // Lazy-init — first-time borrowers of this token have an
        // uninitialized `borrowBalances` slot; `FHE.add(uninit, x)` costs
        // ~50k. Skip the add and store the requested handle directly.
        // ~200g cost per repeat user vs ~49.8k saved on first.
        euint128 requested = FHE.asEuint128(encBorrowAmount);
        actual = requested;
        euint128 storedBorrow = borrowBalances[borrowToken][msg.sender];
        euint128 newBorrow =
            FHE.isInitialized(storedBorrow) ? FHE.add(storedBorrow, requested) : requested;
        borrowBalances[borrowToken][msg.sender] = newBorrow;
        FHE.allowThis(actual);
        FHE.allowSender(actual);
        FHE.allowThis(newBorrow);
        FHE.allowSender(newBorrow);

        IERC20(borrowToken).safeTransfer(msg.sender, borrowAmount);

        emit Borrowed(msg.sender, collateralToken, borrowToken, borrowAmount);
    }

    function _requireOracleHealthy(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        uint256 existingBorrow
    ) internal view {
        uint16 ltvBps = oracle.collateralFactorBps(collateralToken);
        if (ltvBps == 0) revert LtvNumeratorZero();
        uint256 collateralUsd = oracle.convertToUsd(
            collateralToken,
            plainSupplyBalances[collateralToken][msg.sender]
        );
        // Single oracle call for total debt — `convertToUsd` is linear in
        // amount (`(amt * priceWad) / 10**dec`), so summing inputs first
        // is equivalent up to a single floor-div remainder (≤ 1 unit of
        // usdWad = 1e-18 USD). The bias direction is conservative: the
        // combined value is ≥ the separate-sum, so it can only ever be
        // MORE restrictive on the LTV gate, never less. Saves ~5,400 gas
        // per call (one fewer Pyth fetch + STATICCALL).
        uint256 totalDebtUsd = oracle.convertToUsd(borrowToken, borrowAmount + existingBorrow);
        if (collateralUsd * ltvBps < totalDebtUsd * BPS_DEN) revert InsufficientCollateral();
    }

    /// @notice Liquidate part of an unhealthy position. The caller repays
    ///         `debtToCover` of the user's debt and receives the equivalent
    ///         collateral plus a `LIQUIDATION_BONUS_BPS` bonus, capped at the
    ///         user's available supply and `LIQUIDATION_CLOSE_FACTOR_BPS`.
    function liquidate(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover
    ) external nonReentrant whenNotPaused {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (user == address(0)) revert ZeroAddress();
        if (collateralToken == address(0) || debtToken == address(0)) revert ZeroAddress();
        if (debtToCover == 0) revert ZeroAmount();
        if (collateralToken == debtToken) revert TokenMismatch();

        _requireLiquidatable(user, collateralToken, debtToken, debtToCover);
        uint256 seizeAmount = _seizeAmount(user, collateralToken, debtToken, debtToCover);

        plainBorrowBalances[debtToken][user] -= debtToCover;
        totalPlainBorrow[debtToken] -= debtToCover;
        liquidReserve[debtToken] += debtToCover;
        plainSupplyBalances[collateralToken][user] -= seizeAmount;
        liquidReserve[collateralToken] -= seizeAmount;

        IERC20(debtToken).safeTransferFrom(msg.sender, address(this), debtToCover);
        IERC20(collateralToken).safeTransfer(msg.sender, seizeAmount);

        _writeLiquidationHandles(user, collateralToken, debtToken, debtToCover, seizeAmount);

        emit Liquidated(msg.sender, user, collateralToken, debtToken, debtToCover, seizeAmount);
    }

    function _requireLiquidatable(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover
    ) internal view {
        uint256 userDebt = plainBorrowBalances[debtToken][user];
        uint256 maxClose = (userDebt * LIQUIDATION_CLOSE_FACTOR_BPS) / BPS_DEN;
        if (debtToCover > maxClose) revert LiquidationTooLarge();
        if (debtToCover > userDebt) revert ExceedsBorrowBalance();

        uint16 liqBps = oracle.liquidationThresholdBps(collateralToken);
        if (liqBps == 0) revert LtvNumeratorZero();
        uint256 collateralUsd = oracle.convertToUsd(
            collateralToken,
            plainSupplyBalances[collateralToken][user]
        );
        uint256 debtUsd = oracle.convertToUsd(debtToken, userDebt);
        if (!(collateralUsd * liqBps < debtUsd * BPS_DEN)) revert PositionHealthy();
    }

    function _seizeAmount(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover
    ) internal view returns (uint256 seizeAmount) {
        uint256 debtToCoverUsd = oracle.convertToUsd(debtToken, debtToCover);
        uint256 seizeUsd = (debtToCoverUsd * (BPS_DEN + LIQUIDATION_BONUS_BPS)) / BPS_DEN;
        seizeAmount = oracle.convertFromUsd(collateralToken, seizeUsd);
        uint256 userSupply = plainSupplyBalances[collateralToken][user];
        if (seizeAmount > userSupply) seizeAmount = userSupply;
    }

    function _writeLiquidationHandles(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover,
        uint256 seizeAmount
    ) internal {
        euint128 dCovEnc = FHE.asEuint128(debtToCover.toUint128());
        euint128 prevDebt = borrowBalances[debtToken][user];
        euint128 newBorrowEnc = FHE.sub(prevDebt, FHE.min(dCovEnc, prevDebt));
        borrowBalances[debtToken][user] = newBorrowEnc;
        FHE.allowThis(newBorrowEnc);
        FHE.allowSender(newBorrowEnc);

        euint128 sEnc = FHE.asEuint128(seizeAmount.toUint128());
        euint128 prevSupply = supplyBalances[collateralToken][user];
        euint128 newSupplyEnc = FHE.sub(prevSupply, FHE.min(sEnc, prevSupply));
        supplyBalances[collateralToken][user] = newSupplyEnc;
        FHE.allowThis(newSupplyEnc);
        FHE.allowSender(newSupplyEnc);
    }

    function getSupplyBalance(address token) external nonReentrant returns (euint128) {
        // Cache the storage handle to save 2 keccak256(key, slot) hashes.
        euint128 stored = supplyBalances[token][msg.sender];
        if (FHE.isInitialized(stored)) {
            FHE.allowSender(stored);
            return stored;
        }
        return _ZERO;
    }

    function getBorrowBalance(address token) external nonReentrant returns (euint128) {
        // Cache the storage handle to save 2 keccak256(key, slot) hashes.
        euint128 stored = borrowBalances[token][msg.sender];
        if (FHE.isInitialized(stored)) {
            FHE.allowSender(stored);
            return stored;
        }
        return _ZERO;
    }

    function getPlainSupplyBalance(address token) external view returns (uint256) {
        return plainSupplyBalances[token][msg.sender];
    }

    function getPlainBorrowBalance(address token) external view returns (uint256) {
        return plainBorrowBalances[token][msg.sender];
    }
}
