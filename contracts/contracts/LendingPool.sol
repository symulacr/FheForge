// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FHE, InEuint128, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PriceOracle } from "./PriceOracle.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { IWETH9 } from "./interfaces/IWETH9.sol";
import { IERC3156FlashBorrower } from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

contract LendingPool is FheForgeBase {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => euint128)) private supplyBalances;
    mapping(address => mapping(address => euint128)) private borrowBalances;
    mapping(address => uint256) public totalPlainBorrow;
    mapping(address => uint256) public liquidReserve;
    /// @dev Tracks last public reveal timestamp per (user, token) for cooldown gating.
    mapping(address => mapping(address => uint256)) public lastRevealTime;
    event UnshieldRequested(address indexed user, address indexed token);

    struct Commitment {
        euint128 encryptedAmount;
        uint256 timestamp;
        bool exists;
    }

    struct BorrowCommitParams {
        address collateralToken;
        address borrowToken;
        uint128 ltvNum;
        uint128 ltvDen;
    }

    uint256 public constant COMMIT_DEADLINE = 10 minutes;
    mapping(bytes32 => Commitment) private _commits;
    mapping(bytes32 => BorrowCommitParams) private _borrowParams;
    mapping(address => uint256) private _nonces;

    mapping(address => bool) public isComposer;

    uint16 public constant LIQUIDATION_BONUS_BPS = 500;
    uint16 public constant LIQUIDATION_CLOSE_FACTOR_BPS = 5000;
    uint256 public constant REVEAL_COOLDOWN = 1 hours;

    PriceOracle public oracle;
    IWETH9 public weth;

    error LtvNumeratorZero();
    error LtvDenominatorZero();
    error LtvExceedsHundredPercent();
    error InsufficientCollateral();
    error InsufficientReserve();
    error OracleNotSet();
    error WethNotSet();
    error LiquidationTooLarge();
    error NotComposer();
    error InvalidProof();
    error FlashLoanNotRepaid();
    error FlashLoanUnsupportedToken();
    error CannotSelfLiquidate();
    error NotAuthorized();
    error RevealCooldown();
    error CommitmentNotFound();
    error CommitmentExpired();
    error ValueMismatch();
    error VerificationFailed();

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
    event ShieldCommitted(address indexed user, address indexed token, bytes32 indexed commitId);
    event ShieldEthCommitted(address indexed user, bytes32 indexed commitId);
    event BorrowCommitted(
        address indexed user,
        address indexed collateralToken,
        address borrowToken,
        bytes32 indexed commitId
    );
    event RepayCommitted(address indexed user, address indexed token, bytes32 indexed commitId);
    event WithdrawCommitted(address indexed user, address indexed token, bytes32 indexed commitId);
    event WithdrawEthCommitted(address indexed user, bytes32 indexed commitId);
    event Liquidated(
        address indexed liquidator,
        address indexed user,
        address indexed collateralToken,
        address debtToken,
        uint256 debtCovered,
        uint256 collateralSeized
    );

    modifier onlyComposer() {
        _onlyComposer();
        _;
    }

    function _onlyComposer() private view {
        if (!isComposer[msg.sender]) revert NotComposer();
    }

    constructor() FheForgeBase() {}

    function _commit(euint128 encAmount) internal returns (bytes32 commitId) {
        _validateCiphertext(encAmount);
        commitId = keccak256(abi.encode(msg.sender, block.number, _nonces[msg.sender]++));
        _commits[commitId] = Commitment({
            encryptedAmount: encAmount,
            timestamp: block.timestamp,
            exists: true
        });
        FHE.allowPublic(encAmount);
    }

    function _reveal(
        bytes32 commitId,
        uint128 proof,
        bytes calldata sig
    ) internal returns (uint256 amount, euint128 handle) {
        Commitment storage c = _commits[commitId];
        if (!c.exists) revert CommitmentNotFound();
        if (block.timestamp > c.timestamp + COMMIT_DEADLINE) revert CommitmentExpired();
        handle = c.encryptedAmount;
        if (!FHE.verifyDecryptResult(handle, proof, sig)) revert InvalidProof();
        amount = uint256(proof);
        if (amount == 0) revert ZeroAmount();
        delete _commits[commitId];
    }

    function shield(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 verifiedIncoming = _verifyEquality(incoming, amount);
        if (euint128.unwrap(verifiedIncoming) == euint128.unwrap(_ZERO))
            revert VerificationFailed();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        liquidReserve[token] += amount;
        euint128 stored = supplyBalances[token][msg.sender];
        supplyBalances[token][msg.sender] = _safeIncrease(stored, verifiedIncoming, msg.sender);
        emit Supplied(msg.sender, token);
    }

    function borrowWithLtvCheck(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external payable nonReentrant whenNotPaused returns (euint128 actual) {
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (ltvDen == 0) revert LtvDenominatorZero();
        if (ltvNum == 0) revert LtvNumeratorZero();
        if (ltvNum > ltvDen) revert LtvExceedsHundredPercent();

        euint128 supplyBal = _ensureInitialized(supplyBalances[collateralToken][msg.sender]);
        euint128 borrowBal = _ensureInitialized(borrowBalances[borrowToken][msg.sender]);
        euint128 requested = FHE.asEuint128(encBorrowAmount);
        euint128 verifiedBorrow = _verifyEquality(requested, borrowAmount);
        if (euint128.unwrap(verifiedBorrow) == euint128.unwrap(_ZERO)) revert VerificationFailed();

        euint128 newBorrow = FHE.add(borrowBal, verifiedBorrow);
        euint128 lhs = FHE.mul(newBorrow, FHE.asEuint128(uint256(ltvDen)));
        euint128 rhs = FHE.mul(supplyBal, FHE.asEuint128(uint256(ltvNum)));
        ebool isHealthy = FHE.lte(lhs, rhs);

        actual = FHE.select(isHealthy, verifiedBorrow, _ZERO);
        FHE.allowThis(actual);

        borrowBalances[borrowToken][msg.sender] = _safeIncrease(borrowBal, actual, msg.sender);
        _grantAcl(actual, msg.sender);

        if (euint128.unwrap(actual) != euint128.unwrap(_ZERO)) {
            if (liquidReserve[borrowToken] < borrowAmount) revert InsufficientReserve();
            unchecked {
                totalPlainBorrow[borrowToken] += borrowAmount;
                liquidReserve[borrowToken] -= borrowAmount;
            }
            IERC20(borrowToken).safeTransfer(msg.sender, borrowAmount);
        }
        emit Borrowed(msg.sender, collateralToken, borrowToken);
    }

    function repayDebt(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 verifiedIncoming = _verifyEquality(incoming, amount);
        if (euint128.unwrap(verifiedIncoming) == euint128.unwrap(_ZERO))
            revert VerificationFailed();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;
        euint128 currentBalance = borrowBalances[token][msg.sender];
        borrowBalances[token][msg.sender] = _safeDecrease(
            currentBalance,
            verifiedIncoming,
            msg.sender
        );
        emit Repaid(msg.sender, token);
    }

    function partialUnshield(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        _withdrawCore(token, amount, encAmount);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token);
    }

    function _withdrawCore(address token, uint256 amount, InEuint128 calldata encAmount) internal {
        if (amount == 0) revert ZeroAmount();
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 verifiedIncoming = _verifyEquality(incoming, amount);
        if (euint128.unwrap(verifiedIncoming) == euint128.unwrap(_ZERO))
            revert VerificationFailed();
        uint256 reserve = liquidReserve[token];
        if (reserve < amount) revert InsufficientReserve();
        unchecked {
            if (reserve - amount < totalPlainBorrow[token]) {
                revert InsufficientReserve();
            }
            liquidReserve[token] = reserve - amount;
        }
        euint128 currentBalance = supplyBalances[token][msg.sender];
        supplyBalances[token][msg.sender] = _safeDecrease(
            currentBalance,
            verifiedIncoming,
            msg.sender
        );
    }

    function requestBalanceReveal(address token) external payable {
        if (token == address(0)) revert ZeroAddress();
        if (block.timestamp < lastRevealTime[msg.sender][token] + REVEAL_COOLDOWN)
            revert RevealCooldown();
        lastRevealTime[msg.sender][token] = block.timestamp;
        FHE.allowPublic(_ensureInitialized(supplyBalances[token][msg.sender]));
    }

    function requestUnshield(address token) external payable {
        if (token == address(0)) revert ZeroAddress();
        euint128 bal = _ensureInitialized(supplyBalances[token][msg.sender]);
        FHE.allowPublic(bal);
        emit UnshieldRequested(msg.sender, token);
    }

    function unshieldWithProof(
        address token,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        euint128 bal = _ensureInitialized(supplyBalances[token][msg.sender]);
        if (!FHE.verifyDecryptResult(bal, balanceProof, balanceSig)) {
            revert InvalidProof();
        }
        uint256 amount = uint256(balanceProof);
        if (amount == 0) revert ZeroAmount();
        uint256 reserve = liquidReserve[token];
        if (reserve < amount) revert InsufficientReserve();
        unchecked {
            if (reserve - amount < totalPlainBorrow[token]) {
                revert InsufficientReserve();
            }
            liquidReserve[token] = reserve - amount;
        }
        supplyBalances[token][msg.sender] = _ZERO;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token);
    }

    function requestBorrowReveal(address token) external payable {
        if (token == address(0)) revert ZeroAddress();
        if (block.timestamp < lastRevealTime[msg.sender][token] + REVEAL_COOLDOWN)
            revert RevealCooldown();
        lastRevealTime[msg.sender][token] = block.timestamp;
        FHE.allowPublic(_ensureInitialized(borrowBalances[token][msg.sender]));
    }

    function withdrawPausedWithProof(
        address token,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenPaused {
        if (token == address(0)) revert ZeroAddress();
        if (
            !FHE.verifyDecryptResult(
                _ensureInitialized(supplyBalances[token][msg.sender]),
                balanceProof,
                balanceSig
            )
        ) {
            revert InvalidProof();
        }
        uint256 amount = uint256(balanceProof);
        if (amount == 0) revert ZeroAmount();
        uint256 reserve = liquidReserve[token];
        if (reserve < amount) revert InsufficientReserve();
        unchecked {
            if (reserve - amount < totalPlainBorrow[token]) {
                revert InsufficientReserve();
            }
            liquidReserve[token] = reserve - amount;
        }
        // Emergency: zeros both supply and borrow for paused withdrawal
        supplyBalances[token][msg.sender] = _ZERO;
        borrowBalances[token][msg.sender] = _ZERO;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit PausedWithdrawn(msg.sender, token, amount);
    }

    function setOracle(address newOracle) external payable onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        oracle = PriceOracle(newOracle);
        emit OracleSet(newOracle);
    }

    function disableOracle() external payable onlyOwner {
        oracle = PriceOracle(address(0));
        emit OracleDisabled();
    }

    function setWeth(address newWeth) external payable onlyOwner {
        if (newWeth == address(0)) revert ZeroAddress();
        weth = IWETH9(newWeth);
        emit WethSet(newWeth);
    }

    function disableWeth() external payable onlyOwner {
        weth = IWETH9(address(0));
        emit WethDisabled();
    }

    function setComposer(address c, bool enabled) external payable onlyOwner {
        if (c == address(0)) revert ZeroAddress();
        isComposer[c] = enabled;
        emit ComposerSet(c);
    }

    function shieldEth(InEuint128 calldata encAmount) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        if (msg.value == 0) revert ZeroAmount();
        address tokenAddr = address(weth);
        liquidReserve[tokenAddr] += msg.value;
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 verifiedIncoming = _verifyEquality(incoming, msg.value);
        if (euint128.unwrap(verifiedIncoming) == euint128.unwrap(_ZERO))
            revert VerificationFailed();
        euint128 stored = supplyBalances[tokenAddr][msg.sender];
        supplyBalances[tokenAddr][msg.sender] = _safeIncrease(stored, verifiedIncoming, msg.sender);
        weth.deposit{ value: msg.value }();
        emit Supplied(msg.sender, tokenAddr);
    }

    function partialUnshieldEth(
        uint256 amount,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        address tokenAddr = address(weth);
        _withdrawCore(tokenAddr, amount, encAmount);
        weth.withdraw(amount);
        (bool ok, ) = msg.sender.call{ value: amount }("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(msg.sender, tokenAddr);
    }

    // ── Commit-Reveal: Shield ──────────────────────────────
    function shield(
        address token,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused returns (bytes32 commitId) {
        if (token == address(0)) revert ZeroAddress();
        euint128 incoming = FHE.asEuint128(encAmount);
        commitId = _commit(incoming);
        emit ShieldCommitted(msg.sender, token, commitId);
    }

    function executeShield(
        address token,
        bytes32 commitId,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        (uint256 amount, euint128 handle) = _reveal(commitId, balanceProof, balanceSig);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        liquidReserve[token] += amount;
        euint128 stored = supplyBalances[token][msg.sender];
        supplyBalances[token][msg.sender] = _safeIncrease(stored, handle, msg.sender);
        emit Supplied(msg.sender, token);
    }

    // ── Commit-Reveal: Borrow ──────────────────────────────
    function commitBorrow(
        address collateralToken,
        address borrowToken,
        InEuint128 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external payable nonReentrant whenNotPaused returns (bytes32 commitId) {
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (ltvDen == 0) revert LtvDenominatorZero();
        if (ltvNum == 0) revert LtvNumeratorZero();
        if (ltvNum > ltvDen) revert LtvExceedsHundredPercent();
        euint128 incoming = FHE.asEuint128(encBorrowAmount);
        commitId = _commit(incoming);
        _borrowParams[commitId] = BorrowCommitParams({
            collateralToken: collateralToken,
            borrowToken: borrowToken,
            ltvNum: ltvNum,
            ltvDen: ltvDen
        });
        emit BorrowCommitted(msg.sender, collateralToken, borrowToken, commitId);
    }

    function executeBorrow(
        bytes32 commitId,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused returns (euint128 actual) {
        (uint256 borrowAmount, euint128 verifiedBorrow) = _reveal(
            commitId,
            balanceProof,
            balanceSig
        );
        BorrowCommitParams memory p = _borrowParams[commitId];
        delete _borrowParams[commitId];

        euint128 supplyBal = _ensureInitialized(supplyBalances[p.collateralToken][msg.sender]);
        euint128 borrowBal = _ensureInitialized(borrowBalances[p.borrowToken][msg.sender]);
        euint128 newBorrow = FHE.add(borrowBal, verifiedBorrow);
        euint128 lhs = FHE.mul(newBorrow, FHE.asEuint128(uint256(p.ltvDen)));
        euint128 rhs = FHE.mul(supplyBal, FHE.asEuint128(uint256(p.ltvNum)));
        ebool isHealthy = FHE.lte(lhs, rhs);
        actual = FHE.select(isHealthy, verifiedBorrow, _ZERO);
        FHE.allowThis(actual);
        borrowBalances[p.borrowToken][msg.sender] = _safeIncrease(borrowBal, actual, msg.sender);
        _grantAcl(actual, msg.sender);
        if (euint128.unwrap(actual) != euint128.unwrap(_ZERO)) {
            if (liquidReserve[p.borrowToken] < borrowAmount) revert InsufficientReserve();
            unchecked {
                totalPlainBorrow[p.borrowToken] += borrowAmount;
                liquidReserve[p.borrowToken] -= borrowAmount;
            }
            IERC20(p.borrowToken).safeTransfer(msg.sender, borrowAmount);
        }
        emit Borrowed(msg.sender, p.collateralToken, p.borrowToken);
    }

    // ── Commit-Reveal: Repay ───────────────────────────────
    function repay(
        address token,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused returns (bytes32 commitId) {
        if (token == address(0)) revert ZeroAddress();
        euint128 incoming = FHE.asEuint128(encAmount);
        commitId = _commit(incoming);
        emit RepayCommitted(msg.sender, token, commitId);
    }

    function executeRepay(
        address token,
        bytes32 commitId,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        (uint256 amount, euint128 verifiedIncoming) = _reveal(commitId, balanceProof, balanceSig);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;
        euint128 currentBalance = borrowBalances[token][msg.sender];
        borrowBalances[token][msg.sender] = _safeDecrease(
            currentBalance,
            verifiedIncoming,
            msg.sender
        );
        emit Repaid(msg.sender, token);
    }

    // ── Commit-Reveal: Withdraw ────────────────────────────
    function withdraw(
        address token,
        InEuint128 calldata encAmount
    ) external payable nonReentrant whenNotPaused returns (bytes32 commitId) {
        if (token == address(0)) revert ZeroAddress();
        euint128 incoming = FHE.asEuint128(encAmount);
        commitId = _commit(incoming);
        emit WithdrawCommitted(msg.sender, token, commitId);
    }

    function executeWithdraw(
        address token,
        bytes32 commitId,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        (uint256 amount, euint128 verifiedIncoming) = _reveal(commitId, balanceProof, balanceSig);
        uint256 reserve = liquidReserve[token];
        if (reserve < amount) revert InsufficientReserve();
        unchecked {
            if (reserve - amount < totalPlainBorrow[token]) revert InsufficientReserve();
            liquidReserve[token] = reserve - amount;
        }
        euint128 currentBalance = supplyBalances[token][msg.sender];
        supplyBalances[token][msg.sender] = _safeDecrease(
            currentBalance,
            verifiedIncoming,
            msg.sender
        );
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token);
    }

    // ── Commit-Reveal: Shield ETH ──────────────────────────
    function shieldEth(
        InEuint128 calldata encAmount,
        bool
    ) external payable nonReentrant whenNotPaused returns (bytes32 commitId) {
        if (address(weth) == address(0)) revert WethNotSet();
        euint128 incoming = FHE.asEuint128(encAmount);
        commitId = _commit(incoming);
        emit ShieldEthCommitted(msg.sender, commitId);
    }

    function executeShieldEth(
        bytes32 commitId,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        if (msg.value == 0) revert ZeroAmount();
        (uint256 amount, euint128 verifiedIncoming) = _reveal(commitId, balanceProof, balanceSig);
        if (msg.value != amount) revert ValueMismatch();
        address tokenAddr = address(weth);
        liquidReserve[tokenAddr] += amount;
        euint128 stored = supplyBalances[tokenAddr][msg.sender];
        supplyBalances[tokenAddr][msg.sender] = _safeIncrease(stored, verifiedIncoming, msg.sender);
        weth.deposit{ value: amount }();
        emit Supplied(msg.sender, tokenAddr);
    }

    // ── Commit-Reveal: Withdraw ETH ────────────────────────
    function withdrawEth(
        InEuint128 calldata encAmount,
        bool
    ) external payable nonReentrant whenNotPaused returns (bytes32 commitId) {
        if (address(weth) == address(0)) revert WethNotSet();
        euint128 incoming = FHE.asEuint128(encAmount);
        commitId = _commit(incoming);
        emit WithdrawEthCommitted(msg.sender, commitId);
    }

    function executeWithdrawEth(
        bytes32 commitId,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external payable nonReentrant whenNotPaused {
        if (address(weth) == address(0)) revert WethNotSet();
        (uint256 amount, euint128 verifiedIncoming) = _reveal(commitId, balanceProof, balanceSig);
        address tokenAddr = address(weth);
        uint256 reserve = liquidReserve[tokenAddr];
        if (reserve < amount) revert InsufficientReserve();
        unchecked {
            if (reserve - amount < totalPlainBorrow[tokenAddr]) revert InsufficientReserve();
            liquidReserve[tokenAddr] = reserve - amount;
        }
        euint128 currentBalance = supplyBalances[tokenAddr][msg.sender];
        supplyBalances[tokenAddr][msg.sender] = _safeDecrease(
            currentBalance,
            verifiedIncoming,
            msg.sender
        );
        weth.withdraw(amount);
        (bool ok, ) = msg.sender.call{ value: amount }("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(msg.sender, tokenAddr);
    }

    /// @dev Accept ETH only from WETH during unwrap, or from any payable function call.
    receive() external payable {}

    function borrowWithOracle(
        address collateralToken,
        address borrowToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount
    ) external payable nonReentrant whenNotPaused returns (euint128 actual) {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
        if (borrowAmount == 0) revert ZeroAmount();
        if (collateralAmount == 0) revert ZeroAmount();
        _requireOracleHealthy(collateralToken, borrowToken, collateralAmount, borrowAmount, 0);

        euint128 requested = FHE.asEuint128(encBorrowAmount);
        euint128 verifiedRequested = _verifyEquality(requested, borrowAmount);
        if (euint128.unwrap(verifiedRequested) == euint128.unwrap(_ZERO))
            revert VerificationFailed();

        if (liquidReserve[borrowToken] < borrowAmount) revert InsufficientReserve();
        unchecked {
            totalPlainBorrow[borrowToken] += borrowAmount;
            liquidReserve[borrowToken] -= borrowAmount;
        }
        actual = verifiedRequested;
        euint128 storedBorrow = borrowBalances[borrowToken][msg.sender];
        borrowBalances[borrowToken][msg.sender] = _safeIncrease(
            storedBorrow,
            verifiedRequested,
            msg.sender
        );
        _grantAcl(actual, msg.sender);
        IERC20(borrowToken).safeTransfer(msg.sender, borrowAmount);
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

    function depositFor(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external payable nonReentrant whenNotPaused onlyComposer {
        if (token == address(0) || user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        liquidReserve[token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        euint128 storedSupply = supplyBalances[token][user];
        supplyBalances[token][user] = _safeIncrease(storedSupply, handle, user);
        emit Supplied(user, token);
    }

    function borrowFor(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external payable nonReentrant whenNotPaused onlyComposer {
        if (token == address(0) || user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (liquidReserve[token] < amount) revert InsufficientReserve();
        unchecked {
            totalPlainBorrow[token] += amount;
            liquidReserve[token] -= amount;
        }
        euint128 storedBorrow = borrowBalances[token][user];
        borrowBalances[token][user] = _safeIncrease(storedBorrow, handle, user);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, address(0), token);
    }

    function repayFor(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external payable nonReentrant whenNotPaused onlyComposer {
        if (token == address(0) || user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        totalPlainBorrow[token] -= amount;
        liquidReserve[token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        euint128 currentBalance = borrowBalances[token][user];
        borrowBalances[token][user] = _safeDecrease(currentBalance, handle, user);
        emit Repaid(user, token);
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
    ) external payable nonReentrant whenNotPaused {
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (user == address(0)) revert ZeroAddress();
        if (collateralToken == address(0) || debtToken == address(0)) revert ZeroAddress();
        if (debtToCover == 0) revert ZeroAmount();
        if (collateralToken == debtToken) revert TokenMismatch();
        if (user == msg.sender) revert CannotSelfLiquidate();

        _verifyLiquidationProofs(
            user,
            debtToken,
            collateralToken,
            debtBalanceProof,
            debtSig,
            supplyBalanceProof,
            supplySig
        );

        uint256 userDebt = uint256(debtBalanceProof);
        uint256 userCollateral = uint256(supplyBalanceProof);
        uint256 maxLiquidation = (userDebt * LIQUIDATION_CLOSE_FACTOR_BPS) / BPS_DEN;
        uint256 actualDebtCover = debtToCover > maxLiquidation ? maxLiquidation : debtToCover;
        if (actualDebtCover > userDebt) revert LiquidationTooLarge();

        uint256 remainingDebt;
        unchecked {
            remainingDebt = userDebt - actualDebtCover;
        }
        _requireOracleHealthy(collateralToken, debtToken, userCollateral, remainingDebt, 0);

        IERC20(debtToken).safeTransferFrom(msg.sender, address(this), actualDebtCover);
        totalPlainBorrow[debtToken] -= actualDebtCover;
        liquidReserve[debtToken] += actualDebtCover;

        euint128 repayEnc = FHE.asEuint128(actualDebtCover);
        euint128 storedDebt = _ensureInitialized(borrowBalances[debtToken][user]);
        FHE.allowThis(storedDebt);
        borrowBalances[debtToken][user] = _safeDecrease(storedDebt, repayEnc, msg.sender);

        uint256 seizedCollateral =
            (actualDebtCover *
                oracle.convertToUsd(collateralToken, 1e18) *
                (BPS_DEN + LIQUIDATION_BONUS_BPS)) /
                (oracle.convertToUsd(debtToken, 1e18) * BPS_DEN);
        if (seizedCollateral > userCollateral) seizedCollateral = userCollateral;
        liquidReserve[collateralToken] -= seizedCollateral;

        euint128 seizeEnc = FHE.asEuint128(seizedCollateral);
        euint128 storedColl = _ensureInitialized(supplyBalances[collateralToken][user]);
        FHE.allowThis(storedColl);
        supplyBalances[collateralToken][user] = _safeDecrease(storedColl, seizeEnc, msg.sender);

        IERC20(collateralToken).safeTransfer(msg.sender, seizedCollateral);
        emit Liquidated(
            msg.sender,
            user,
            collateralToken,
            debtToken,
            actualDebtCover,
            seizedCollateral
        );
    }

    function _verifyLiquidationProofs(
        address user,
        address debtToken,
        address collateralToken,
        uint128 debtBalanceProof,
        bytes calldata debtSig,
        uint128 supplyBalanceProof,
        bytes calldata supplySig
    ) private view {
        if (
            !FHE.verifyDecryptResult(
                _ensureInitialized(borrowBalances[debtToken][user]),
                debtBalanceProof,
                debtSig
            )
        ) {
            revert InvalidProof();
        }
        if (
            !FHE.verifyDecryptResult(
                _ensureInitialized(supplyBalances[collateralToken][user]),
                supplyBalanceProof,
                supplySig
            )
        ) {
            revert InvalidProof();
        }
    }

    function getSupplyBalance(address token) external payable returns (euint128 bal) {
        bal = _ensureInitialized(supplyBalances[token][msg.sender]);
        FHE.allowSender(bal);
        return bal;
    }

    function getBorrowBalance(address token) external payable returns (euint128 bal) {
        bal = _ensureInitialized(borrowBalances[token][msg.sender]);
        FHE.allowSender(bal);
        return bal;
    }

    function isLiquidatable(
        address user,
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount
    ) external view returns (bool liquidatable) {
        if (user == address(0)) revert ZeroAddress();
        if (collateralToken == address(0) || debtToken == address(0)) revert ZeroAddress();
        if (collateralAmount == 0 || borrowAmount == 0) return false;
        if (address(oracle) == address(0)) return false;
        uint16 ltvBps = oracle.collateralFactorBps(collateralToken);
        if (ltvBps == 0) return false;
        uint256 collateralUsd = oracle.convertToUsd(collateralToken, collateralAmount);
        uint256 totalDebtUsd = oracle.convertToUsd(debtToken, borrowAmount);
        return collateralUsd * ltvBps < totalDebtUsd * BPS_DEN;
    }

    uint256 public constant FLASH_FEE_BPS = 5;

    event FlashLoan(address indexed receiver, address indexed token, uint256 amount, uint256 fee);

    function maxFlashLoan(address token) external view returns (uint256 maxLoan) {
        uint256 reserve = liquidReserve[token];
        uint256 borrowed = totalPlainBorrow[token];
        if (reserve < borrowed) return 0;
        unchecked {
            return reserve - borrowed;
        }
    }

    function flashFee(address token, uint256 amount) external view returns (uint256 fee) {
        if (liquidReserve[token] == 0 && totalPlainBorrow[token] == 0) {
            revert FlashLoanUnsupportedToken();
        }
        return (amount * FLASH_FEE_BPS) / 10000;
    }

    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata params
    ) external payable nonReentrant whenNotPaused returns (bool success) {
        if (amount == 0) revert ZeroAmount();
        uint256 fee = (amount * FLASH_FEE_BPS) / 10000;
        uint256 reserve = liquidReserve[token];
        if (reserve < amount) revert InsufficientReserve();
        unchecked {
            liquidReserve[token] = reserve - amount;
        }
        IERC20(token).safeTransfer(receiver, amount);
        bytes32 flashResult = IERC3156FlashBorrower(receiver).onFlashLoan(
            msg.sender,
            token,
            amount,
            fee,
            params
        );
        if (flashResult != keccak256("ERC3156FlashBorrower.onFlashLoan")) {
            revert FlashLoanNotRepaid();
        }
        uint256 totalDebt = amount + fee;
        IERC20(token).safeTransferFrom(receiver, address(this), totalDebt);
        liquidReserve[token] += totalDebt;
        emit FlashLoan(receiver, token, amount, fee);
        return true;
    }
}
