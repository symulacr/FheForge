// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint64, euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
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

contract LendingPool is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    mapping(address => mapping(address => euint64)) private supplyBalances;
    mapping(address => mapping(address => euint64)) private borrowBalances;
    mapping(address => mapping(address => uint256)) private plainSupplyBalances;
    mapping(address => mapping(address => uint256)) private plainBorrowBalances;
    mapping(address => uint256) public totalPlainBorrow;
    mapping(address => uint256) public liquidReserve;

    euint64 private immutable _ZERO;
    address public immutable OWNER;
    address public composer;

    uint256 public constant BPS_DEN = 1e4;

    uint16 public constant LIQUIDATION_BONUS_BPS = 500;

    uint16 public constant LIQUIDATION_CLOSE_FACTOR_BPS = 5000;

    PriceOracle public oracle;
    IWETH9 public weth;

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
    error NotComposer();
    error Euint64Overflow();

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
        euint64 z = FHE.asEuint64(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    // ────────── User-facing supply / borrow / repay / withdraw ──────────

    function supply(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndSupply(token, amount, encAmount);
    }

    function supplyWithPermit2(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        _doPermit2Pull(token, amount, permit, signature);
        _finalizeSupply(token, amount, encAmount);
    }

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
            _msgSender(),
            signature
        );
    }

    function _finalizeSupply(address token, uint256 amount, InEuint64 calldata encAmount) internal {
        plainSupplyBalances[token][_msgSender()] += amount;
        liquidReserve[token] += amount;

        euint64 incoming = FHE.asEuint64(encAmount);
        euint64 stored = supplyBalances[token][_msgSender()];
        euint64 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        emit Supplied(msg.sender, token, amount);
    }

    function _pullAndSupply(address token, uint256 amount, InEuint64 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // C-12: Guard against euint64 overflow (max ~18.4 tokens at 18 decimals)
        if (amount > type(uint64).max) revert Euint64Overflow();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        _finalizeSupply(token, amount, encAmount);
    }

    function checkLtvAndBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint64 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external nonReentrant whenNotPaused returns (euint64 actual) {
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (ltvDen == 0) revert LtvDenominatorZero();
        if (ltvNum == 0) revert LtvNumeratorZero();
        if (ltvNum > ltvDen) revert LtvExceedsHundredPercent();

        uint256 supplied = plainSupplyBalances[collateralToken][_msgSender()];
        if (supplied == 0) revert InsufficientCollateral();
        if (borrowAmount * ltvDen > supplied * ltvNum) revert InsufficientCollateral();

        uint256 existingBorrow = plainBorrowBalances[borrowToken][_msgSender()];
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
        InEuint64 calldata encAmount
    ) external nonReentrant whenNotPaused {
        _pullAndRepay(token, amount, encAmount);
    }

    function repayWithPermit2(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        _doPermit2Pull(token, amount, permit, signature);
        _finalizeRepay(token, amount, encAmount);
    }

    function _finalizeRepay(address token, uint256 amount, InEuint64 calldata encAmount) internal {
        if (amount > plainBorrowBalances[token][_msgSender()]) revert ExceedsBorrowBalance();

        plainBorrowBalances[token][_msgSender()] -= amount;
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;

        euint64 incoming = FHE.asEuint64(encAmount);
        euint64 currentBalance = borrowBalances[token][_msgSender()];
        euint64 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        borrowBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        emit Repaid(msg.sender, token, amount);
    }

    function _pullAndRepay(address token, uint256 amount, InEuint64 calldata encAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // C-12: Guard against euint64 overflow
        if (amount > type(uint64).max) revert Euint64Overflow();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        _finalizeRepay(token, amount, encAmount);
    }

    function withdraw(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        _withdrawCore(token, amount, encAmount);
        IERC20(token).safeTransfer(_msgSender(), amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function _withdrawCore(address token, uint256 amount, InEuint64 calldata encAmount) internal {
        if (amount == 0) revert ZeroAmount();

        mapping(address => uint256) storage plainSupply = plainSupplyBalances[token];
        uint256 currentSupply = plainSupply[_msgSender()];
        if (amount > currentSupply) revert ExceedsSupplyBalance();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        uint256 ownBorrow = plainBorrowBalances[token][_msgSender()];
        if (ownBorrow > 0 && currentSupply - amount < ownBorrow) {
            revert UnhealthyAfterWithdraw();
        }

        plainSupply[_msgSender()] = currentSupply - amount;
        liquidReserve[token] = reserve - amount;

        euint64 incoming = FHE.asEuint64(encAmount);
        euint64 currentBalance = supplyBalances[token][_msgSender()];
        euint64 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        supplyBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());
    }

    function _withdrawCore(address token, uint256 amount, euint64 encAmount) internal {
        if (amount == 0) revert ZeroAmount();

        mapping(address => uint256) storage plainSupply = plainSupplyBalances[token];
        uint256 currentSupply = plainSupply[_msgSender()];
        if (amount > currentSupply) revert ExceedsSupplyBalance();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        uint256 ownBorrow = plainBorrowBalances[token][_msgSender()];
        if (ownBorrow > 0 && currentSupply - amount < ownBorrow) {
            revert UnhealthyAfterWithdraw();
        }

        plainSupply[_msgSender()] = currentSupply - amount;
        liquidReserve[token] = reserve - amount;

        euint64 incoming = encAmount;
        euint64 currentBalance = supplyBalances[token][_msgSender()];
        euint64 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        supplyBalances[token][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());
    }

    function emergencyWithdraw(address token) external nonReentrant whenPaused {
        if (token == address(0)) revert ZeroAddress();
        uint256 amount = plainSupplyBalances[token][_msgSender()];
        if (amount == 0) revert ZeroAmount();

        uint256 reserve = liquidReserve[token];
        if (reserve < amount || reserve - amount < totalPlainBorrow[token]) {
            revert InsufficientReserve();
        }

        plainSupplyBalances[token][_msgSender()] = 0;
        liquidReserve[token] = reserve - amount;

        supplyBalances[token][_msgSender()] = _ZERO;
        borrowBalances[token][_msgSender()] = _ZERO;

        IERC20(token).safeTransfer(_msgSender(), amount);
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

    function supplyEth(InEuint64 calldata encAmount) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        if (msg.value == 0) revert ZeroAmount();
        // C-12: Guard against euint64 overflow
        if (msg.value > type(uint64).max) revert Euint64Overflow();
        address tokenAddr = address(weth);

        plainSupplyBalances[tokenAddr][_msgSender()] += msg.value;
        liquidReserve[tokenAddr] += msg.value;

        euint64 incoming = FHE.asEuint64(encAmount);
        euint64 stored = supplyBalances[tokenAddr][_msgSender()];
        euint64 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[tokenAddr][_msgSender()] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, _msgSender());

        weth.deposit{ value: msg.value }();

        emit Supplied(msg.sender, tokenAddr, msg.value);
    }

    function withdrawEth(
        uint256 amount,
        InEuint64 calldata encAmount
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
        uint256 borrowAmount,
        InEuint64 calldata encBorrowAmount
    ) external nonReentrant whenNotPaused returns (euint64 actual) {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (plainSupplyBalances[collateralToken][_msgSender()] == 0)
            revert InsufficientCollateral();

        uint256 existingBorrow = plainBorrowBalances[borrowToken][_msgSender()];
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

    function _finalizeBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint64 calldata encBorrowAmount,
        uint256 existingBorrow
    ) internal returns (euint64 actual) {
        if (liquidReserve[borrowToken] < borrowAmount) revert InsufficientReserve();
        // C-12: Guard against euint64 overflow
        if (borrowAmount > type(uint64).max) revert Euint64Overflow();

        plainBorrowBalances[borrowToken][_msgSender()] = existingBorrow + borrowAmount;
        totalPlainBorrow[borrowToken] += borrowAmount;
        liquidReserve[borrowToken] -= borrowAmount;

        euint64 requested = FHE.asEuint64(encBorrowAmount);
        actual = requested;
        euint64 storedBorrow = borrowBalances[borrowToken][_msgSender()];
        euint64 newBorrow =
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
        uint256 borrowAmount,
        uint256 existingBorrow
    ) internal view {
        uint16 ltvBps = oracle.collateralFactorBps(collateralToken);
        if (ltvBps == 0) revert LtvNumeratorZero();
        uint256 collateralUsd = oracle.convertToUsd(
            collateralToken,
            plainSupplyBalances[collateralToken][_msgSender()]
        );

        uint256 totalDebtUsd = oracle.convertToUsd(borrowToken, borrowAmount + existingBorrow);
        if (collateralUsd * ltvBps < totalDebtUsd * BPS_DEN) revert InsufficientCollateral();
    }

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

        IERC20(debtToken).safeTransferFrom(_msgSender(), address(this), debtToCover);
        IERC20(collateralToken).safeTransfer(_msgSender(), seizeAmount);

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
        euint64 dCovEnc = FHE.asEuint64(debtToCover.toUint128());
        euint64 prevDebt = borrowBalances[debtToken][user];
        euint64 newBorrowEnc = FHE.sub(prevDebt, FHE.min(dCovEnc, prevDebt));
        borrowBalances[debtToken][user] = newBorrowEnc;
        FHE.allowThis(newBorrowEnc);
        FHE.allow(newBorrowEnc, user);
        FHE.allowTransient(newBorrowEnc, _msgSender());

        euint64 sEnc = FHE.asEuint64(seizeAmount.toUint128());
        euint64 prevSupply = supplyBalances[collateralToken][user];
        euint64 newSupplyEnc = FHE.sub(prevSupply, FHE.min(sEnc, prevSupply));
        supplyBalances[collateralToken][user] = newSupplyEnc;
        FHE.allowThis(newSupplyEnc);
        FHE.allow(newSupplyEnc, user);
        FHE.allowTransient(newSupplyEnc, _msgSender());
    }

    // ────────── Cross-contract: Pool-composed supply / borrow (ACL on user) ──────────

    function supplyToLending(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0)) revert ZeroAddress();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // C-12: Guard against euint64 overflow
        if (amount > type(uint64).max) revert Euint64Overflow();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);

        plainSupplyBalances[token][user] += amount;
        liquidReserve[token] += amount;

        euint64 incoming = FHE.asEuint64(encAmount);
        euint64 stored = supplyBalances[token][user];
        euint64 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[token][user] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);

        emit Supplied(user, token, amount);
    }

    function supplyToLending(
        address token,
        uint256 amount,
        euint64 encAmount,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0)) revert ZeroAddress();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);

        plainSupplyBalances[token][user] += amount;
        liquidReserve[token] += amount;

        euint64 incoming = encAmount;
        euint64 stored = supplyBalances[token][user];
        euint64 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
        supplyBalances[token][user] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);

        emit Supplied(user, token, amount);
    }

    function borrowFromLending(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0)) revert ZeroAddress();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (liquidReserve[token] < amount) revert InsufficientReserve();
        // C-12: Guard against euint64 overflow
        if (amount > type(uint64).max) revert Euint64Overflow();

        plainBorrowBalances[token][user] += amount;
        totalPlainBorrow[token] += amount;
        liquidReserve[token] -= amount;

        euint64 requested = FHE.asEuint64(encAmount);
        euint64 storedBorrow = borrowBalances[token][user];
        euint64 newBorrow =
            FHE.isInitialized(storedBorrow) ? FHE.add(storedBorrow, requested) : requested;
        borrowBalances[token][user] = newBorrow;
        FHE.allowThis(newBorrow);
        FHE.allow(newBorrow, user);

        IERC20(token).safeTransfer(_msgSender(), amount);

        emit Borrowed(user, address(0), token, amount);
    }

    function borrowFromLending(
        address token,
        uint256 amount,
        euint64 encAmount,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0)) revert ZeroAddress();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (liquidReserve[token] < amount) revert InsufficientReserve();

        plainBorrowBalances[token][user] += amount;
        totalPlainBorrow[token] += amount;
        liquidReserve[token] -= amount;

        euint64 requested = encAmount;
        euint64 storedBorrow = borrowBalances[token][user];
        euint64 newBorrow =
            FHE.isInitialized(storedBorrow) ? FHE.add(storedBorrow, requested) : requested;
        borrowBalances[token][user] = newBorrow;
        FHE.allowThis(newBorrow);
        FHE.allow(newBorrow, user);

        IERC20(token).safeTransfer(_msgSender(), amount);

        emit Borrowed(user, address(0), token, amount);
    }

    function repayBorrow(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0)) revert ZeroAddress();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > plainBorrowBalances[token][user]) revert ExceedsBorrowBalance();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);

        plainBorrowBalances[token][user] -= amount;
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;

        euint64 incoming = FHE.asEuint64(encAmount);
        euint64 currentBalance = borrowBalances[token][user];
        euint64 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        borrowBalances[token][user] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);

        emit Repaid(user, token, amount);
    }

    function repayBorrow(
        address token,
        uint256 amount,
        euint64 encAmount,
        address user
    ) external nonReentrant whenNotPaused onlyComposer {
        if (token == address(0)) revert ZeroAddress();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > plainBorrowBalances[token][user]) revert ExceedsBorrowBalance();
        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);

        plainBorrowBalances[token][user] -= amount;
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;

        euint64 incoming = encAmount;
        euint64 currentBalance = borrowBalances[token][user];
        euint64 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));
        borrowBalances[token][user] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);

        emit Repaid(user, token, amount);
    }

    // ────────── Read functions ──────────

    function getSupplyBalance(address token) external nonReentrant returns (euint64) {
        euint64 stored = supplyBalances[token][_msgSender()];
        if (FHE.isInitialized(stored)) {
            FHE.allow(stored, _msgSender());
            FHE.allowSender(stored);
            return stored;
        }
        FHE.allow(_ZERO, _msgSender());
        return _ZERO;
    }

    function getBorrowBalance(address token) external nonReentrant returns (euint64) {
        euint64 stored = borrowBalances[token][_msgSender()];
        if (FHE.isInitialized(stored)) {
            FHE.allow(stored, _msgSender());
            FHE.allowSender(stored);
            return stored;
        }
        FHE.allow(_ZERO, _msgSender());
        return _ZERO;
    }

    function getPlainSupplyBalance(address token) external view returns (uint256) {
        return plainSupplyBalances[token][_msgSender()];
    }

    function getPlainBorrowBalance(address token) external view returns (uint256) {
        return plainBorrowBalances[token][_msgSender()];
    }
}
