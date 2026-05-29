// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { LendingPool } from "../contracts/LendingPool.sol";
import { PriceOracle } from "../contracts/PriceOracle.sol";
import { SimplePythMock } from "../contracts/mocks/SimplePythMock.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import { FHE, euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ITaskManager } from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/// @notice Complementary fuzz tests for LendingPool covering edge cases and functions
///         not already fuzzed in existing test files (MC-076).
///
///         Coverage additions:
///           - Fuzz: isLiquidatable() with various oracle price states
///           - Fuzz: flashFee() with fuzzed amounts
///           - Fuzz: maxFlashLoan() with fuzzed reserve/borrow ratios
///           - Fuzz: shield() amount boundaries
///           - Fuzz: borrowWithLtvCheck — ltvDen lower bound edge cases
///           - Fuzz: partialUnshield() — withdraw amount vs reserve ratio
/// @custom:mock
contract LendingPoolFuzzComplement is FheForgeTestHelper {
    LendingPool  public pool;
    MockERC20    public collToken;
    MockERC20    public debtToken;
    PriceOracle  public oracle;
    SimplePythMock public pythMock;

    address public owner = makeAddr("owner");
    address public user  = makeAddr("user");

    address private constant PYTH_MOCK  = address(0x1);
    uint256 private constant DEFAULT_STALE = 3600;
    bytes32 private constant ETH_PRICE_ID = keccak256("ETH/USD");

    function setUp() public {
        _deployFheMocks();
        vm.warp(1_000_000);

        vm.startPrank(owner);
        pythMock  = new SimplePythMock(1 ether);
        pool      = new LendingPool();
        collToken = new MockERC20("Collateral", "COL", 18);
        debtToken = new MockERC20("Debt", "DBT", 18);
        oracle    = new PriceOracle(PYTH_MOCK, DEFAULT_STALE);

        // Configure oracle: 50% LTV, liq threshold 55%
        oracle.setCollateralFactor(address(collToken), 5000, 5500);
        oracle.setFallbackPrice(address(collToken), 1e18);
        oracle.setFallbackPrice(address(debtToken),  1e18);
        pool.setOracle(address(oracle));
        pool.setComposer(owner);
        vm.stopPrank();
    }

    // ─── Fuzz 1: isLiquidatable — oracle-based health check ────────────────────
    /// @notice isLiquidatable must return false when LTV is healthy and true
    ///         when LTV exceeds the threshold. Fuzz over collateral/borrow amounts.
    function testFuzzIsLiquidatable(
        uint256 collAmount,
        uint256 borrowAmount
    ) public {
        collAmount   = bound(collAmount,   1 ether,  1_000_000 ether);
        borrowAmount = bound(borrowAmount, 1 ether,  1_000_000 ether);

        // Set fallback prices to the same (1:1 ratio)
        // LTV = borrowAmount * 10000 / collAmount (since prices are equal)
        // Liquidatable when borrowAmount * 10000 > collAmount * 5000
        // => borrowAmount > collAmount / 2

        bool isLiq;
        if (collAmount * 5000 >= borrowAmount * 10000) {
            // LTV <= 50% — healthy
            isLiq = false;
        } else {
            // LTV > 50% — liquidatable
            isLiq = true;
        }

        bool actual = pool.isLiquidatable(user, address(collToken), address(debtToken), collAmount, borrowAmount);
        assertEq(actual, isLiq, "isLiquidatable mismatch at fuzzed amounts");
    }

    // ─── Fuzz 2: isLiquidatable with zero amounts ──────────────────────────────
    /// @notice isLiquidatable must return false when collateral or borrow is zero.
    function testFuzzIsLiquidatableZeroAmounts(uint256 collAmount, uint256 borrowAmount) public {
        collAmount   = bound(collAmount,   0, type(uint128).max);
        borrowAmount = bound(borrowAmount, 0, type(uint128).max);

        // If either is zero, isLiquidatable returns false
        bool actual = pool.isLiquidatable(user, address(collToken), address(debtToken), collAmount, borrowAmount);
        if (collAmount == 0 || borrowAmount == 0) {
            assertFalse(actual, "must be false when amount is zero");
        }
    }

    // ─── Fuzz 3: isLiquidatable with oracle-disabled ───────────────────────────
    /// @notice When oracle is disabled, isLiquidatable must return false.
    function testFuzzIsLiquidatableOracleDisabled() public {
        vm.prank(owner);
        pool.disableOracle();

        bool res = pool.isLiquidatable(user, address(collToken), address(debtToken), 100 ether, 100 ether);
        assertFalse(res, "must be false when oracle disabled");
    }

    // ─── Fuzz 4: flashFee with fuzzed amounts ──────────────────────────────────
    /// @notice flashFee must return (amount * FLASH_FEE_BPS) / BPS_DEN after a
    ///         token is tracked by the pool.
    function testFuzzFlashFee(uint256 amount) public {
        amount = bound(amount, 1 ether, 1_000_000 ether);

        // Seed the pool so the token is tracked
        _seedPool(amount);

        uint256 expectedFee = (amount * 5) / 10000;
        uint256 actualFee   = pool.flashFee(address(collToken), amount);
        assertEq(actualFee, expectedFee, "flashFee mismatch");
    }

    // ─── Fuzz 5: flashFee reverts on untracked token ──────────────────────────-
    /// @notice flashFee must revert with FlashLoanUnsupportedToken for unknown tokens.
    function testFuzzFlashFeeUntrackedToken() public {
        vm.expectRevert(LendingPool.FlashLoanUnsupportedToken.selector);
        pool.flashFee(address(collToken), 100 ether);
    }

    // ─── Fuzz 6: maxFlashLoan with fuzzed reserve/borrow ───────────────────────
    /// @notice maxFlashLoan = liquidReserve - totalPlainBorrow.
    ///         If borrow >= reserve, maxFlashLoan = 0.
    function testFuzzMaxFlashLoan(uint256 depositAmount, uint256 borrowAmount) public {
        depositAmount = bound(depositAmount, 1 ether, 10_000 ether);
        borrowAmount  = bound(borrowAmount,  0,         depositAmount);

        // Deposit
        vm.startPrank(owner);
        collToken.mint(owner, depositAmount);
        collToken.approve(address(pool), depositAmount);
        euint128 depHandle = FHE.asEuint128(depositAmount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(depHandle)), address(pool));
        pool.depositFor(address(collToken), depositAmount, depHandle, user);
        vm.stopPrank();

        uint256 reserve = pool.liquidReserve(address(collToken));

        if (borrowAmount > 0) {
            // Borrow some
            vm.startPrank(owner);
            collToken.mint(owner, borrowAmount);
            collToken.approve(address(pool), borrowAmount);
            euint128 brwHandle = FHE.asEuint128(borrowAmount);
            ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(brwHandle)), address(pool));
            pool.depositFor(address(collToken), borrowAmount, brwHandle, owner);
            pool.borrowFor(address(collToken), borrowAmount, brwHandle, user);
            vm.stopPrank();

            uint256 borrow = pool.totalPlainBorrow(address(collToken));
            uint256 maxLoan = pool.maxFlashLoan(address(collToken));

            if (borrow >= reserve) {
                assertEq(maxLoan, 0, "maxFlashLoan must be zero when borrow >= reserve");
            } else {
                assertEq(maxLoan, reserve - borrow, "maxFlashLoan mismatch");
            }
        } else {
            uint256 maxLoan = pool.maxFlashLoan(address(collToken));
            assertEq(maxLoan, reserve, "maxFlashLoan must equal reserve when borrow=0");
        }
    }

    // ─── Fuzz 7: shield amount boundaries ──────────────────────────────────────
    /// @notice shield() must work across a wide range of amounts.
    function testFuzzShieldAmounts(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        vm.prank(owner);
        collToken.mint(user, amount);
        vm.startPrank(user);
        collToken.approve(address(pool), amount);
        euint128 enc = FHE.asEuint128(amount);
        _mockEncVal(uint256(euint128.unwrap(enc)), amount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(enc)), address(pool));
        pool.shield(address(collToken), amount, InEuint128({
            ctHash: uint256(euint128.unwrap(enc)),
            securityZone: 0,
            utype: 6,
            signature: ""
        }));
        vm.stopPrank();

        assertEq(pool.liquidReserve(address(collToken)), amount, "reserve mismatch after shield");
    }

    // ─── Fuzz 8: partialUnshield amount vs reserve ratio ───────────────────────
    /// @notice partialUnshield must succeed when amount <= liquidReserve - totalPlainBorrow,
    ///         and revert with InsufficientReserve when the remaining reserve after
    ///         withdrawal would be insufficient to cover borrows.
    function testFuzzPartialUnshieldReserveRatio(uint256 depositAmount, uint256 withdrawAmount) public {
        depositAmount  = bound(depositAmount,  10 ether, 1_000 ether);
        withdrawAmount = bound(withdrawAmount, 1,        depositAmount);

        // Shield
        _shieldUser(depositAmount);

        uint256 reserve   = pool.liquidReserve(address(collToken));
        uint256 borrow    = pool.totalPlainBorrow(address(collToken));

        if (withdrawAmount > reserve - borrow) {
            vm.prank(user);
            vm.expectRevert(LendingPool.InsufficientReserve.selector);
            euint128 wdEnc = FHE.asEuint128(withdrawAmount);
            _mockEncVal(uint256(euint128.unwrap(wdEnc)), withdrawAmount);
            ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(wdEnc)), address(pool));
            pool.partialUnshield(address(collToken), withdrawAmount, InEuint128({
                ctHash: uint256(euint128.unwrap(wdEnc)),
                securityZone: 0,
                utype: 6,
                signature: ""
            }));
        } else {
            euint128 wdEnc = FHE.asEuint128(withdrawAmount);
            _mockEncVal(uint256(euint128.unwrap(wdEnc)), withdrawAmount);
            ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(wdEnc)), address(pool));
            vm.prank(user);
            pool.partialUnshield(address(collToken), withdrawAmount, InEuint128({
                ctHash: uint256(euint128.unwrap(wdEnc)),
                securityZone: 0,
                utype: 6,
                signature: ""
            }));

            assertEq(pool.liquidReserve(address(collToken)), reserve - withdrawAmount, "reserve not decreased");
            assertEq(collToken.balanceOf(user), withdrawAmount, "user did not receive tokens");
        }
    }

    // ─── Fuzz 9: borrowWithLtvCheck — ltvDen lower bound ──────────────────────
    /// @notice LTV denominator cannot be zero (enforced by contract).
    ///         Test various ltvNum/ltvDen combinations.
    function testFuzzLtvBoundaries(uint128 ltvNum, uint128 ltvDen) public {
        ltvNum = uint128(bound(uint256(ltvNum), 0, 1_000_000));
        ltvDen = uint128(bound(uint256(ltvDen), 0, 1_000_000));

        _seedPool(1000 ether);

        // Provide liquidity for the borrow
        _provideLiquidity(100 ether);

        vm.startPrank(user);
        (euint128 enc, uint256 ctHash) = _createBorrowHandle(10 ether);

        // ltvDen == 0 => revert
        if (ltvDen == 0) {
            vm.expectRevert(LendingPool.LtvDenominatorZero.selector);
            pool.borrowWithLtvCheck(
                address(collToken), address(collToken), 10 ether,
                InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" }),
                ltvNum, ltvDen
            );
        }
        // ltvNum == 0 => revert
        else if (ltvNum == 0) {
            vm.expectRevert(LendingPool.LtvNumeratorZero.selector);
            pool.borrowWithLtvCheck(
                address(collToken), address(collToken), 10 ether,
                InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" }),
                ltvNum, ltvDen
            );
        }
        // ltvNum > ltvDen => revert
        else if (ltvNum > ltvDen) {
            vm.expectRevert(LendingPool.LtvExceedsHundredPercent.selector);
            pool.borrowWithLtvCheck(
                address(collToken), address(collToken), 10 ether,
                InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" }),
                ltvNum, ltvDen
            );
        }
        // Valid LTV
        else {
            pool.borrowWithLtvCheck(
                address(collToken), address(collToken), 10 ether,
                InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" }),
                ltvNum, ltvDen
            );
            assertEq(pool.totalPlainBorrow(address(collToken)), 10 ether, "borrow not recorded");
        }
        vm.stopPrank();
    }

    // ─── Fuzz 10: repayDebt boundaries ─────────────────────────────────────────
    /// @notice Fuzz repay amounts after a borrow, including edge cases.
    function testFuzzRepayDebtBoundaries(uint256 borrowAmount, uint256 repayAmount) public {
        borrowAmount = bound(borrowAmount, 1 ether, 1000 ether);
        repayAmount  = bound(repayAmount,  0,       borrowAmount);

        _seedPool(borrowAmount);
        _provideLiquidity(borrowAmount);

        // Borrow
        vm.startPrank(user);
        (euint128 brwEnc, uint256 brwCtHash) = _createBorrowHandle(borrowAmount);
        pool.borrowWithLtvCheck(
            address(collToken), address(collToken), borrowAmount,
            InEuint128({ ctHash: brwCtHash, securityZone: 0, utype: 6, signature: "" }),
            5000, 10000
        );

        // Repay
        if (repayAmount == 0) {
            vm.expectRevert(FheForgeBase.ZeroAmount.selector);
            pool.repayDebt(
                address(collToken), repayAmount,
                InEuint128({ ctHash: brwCtHash, securityZone: 0, utype: 6, signature: "" })
            );
        } else {
            // Mint tokens to user from the owner's prank (user can't mint)
            vm.stopPrank();
            vm.prank(owner);
            collToken.mint(user, repayAmount);

            vm.startPrank(user);
            collToken.approve(address(pool), repayAmount);
            euint128 repayEnc = FHE.asEuint128(repayAmount);
            _mockEncVal(uint256(euint128.unwrap(repayEnc)), repayAmount);
            ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(repayEnc)), address(pool));

            pool.repayDebt(
                address(collToken), repayAmount,
                InEuint128({
                    ctHash: uint256(euint128.unwrap(repayEnc)),
                    securityZone: 0,
                    utype: 6,
                    signature: ""
                })
            );

            uint256 expectedRemaining = borrowAmount - repayAmount;
            assertEq(pool.totalPlainBorrow(address(collToken)), expectedRemaining, "remaining borrow mismatch");
        }
        vm.stopPrank();
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function _seedPool(uint256 amount) internal {
        vm.startPrank(owner);
        collToken.mint(owner, amount);
        collToken.approve(address(pool), amount);
        euint128 handle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(handle)), address(pool));
        pool.depositFor(address(collToken), amount, handle, user);
        vm.stopPrank();
    }

    function _provideLiquidity(uint256 amount) internal {
        vm.startPrank(owner);
        collToken.mint(owner, amount);
        collToken.approve(address(pool), amount);
        euint128 handle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(handle)), address(pool));
        pool.depositFor(address(collToken), amount, handle, owner);
        vm.stopPrank();
    }

    function _shieldUser(uint256 amount) internal {
        vm.prank(owner);
        collToken.mint(user, amount);

        vm.startPrank(user);
        collToken.approve(address(pool), amount);
        euint128 enc = FHE.asEuint128(amount);
        _mockEncVal(uint256(euint128.unwrap(enc)), amount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(enc)), address(pool));
        pool.shield(address(collToken), amount, InEuint128({
            ctHash: uint256(euint128.unwrap(enc)),
            securityZone: 0,
            utype: 6,
            signature: ""
        }));
        vm.stopPrank();
    }

    function _createBorrowHandle(uint256 amount) internal returns (euint128 enc, uint256 ctHash) {
        enc    = FHE.asEuint128(amount);
        ctHash = uint256(euint128.unwrap(enc));
        _mockEncVal(ctHash, amount);
        ITaskManager(getTaskManagerAddress()).allow(ctHash, address(pool));
    }

    function _mockEncVal(uint256 ctHash, uint256 value) internal {
        uint256 hashMask = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000;
        uint256 handle = (ctHash & hashMask) | (6 << 8);
        MockTaskManager(getTaskManagerAddress()).MOCK_setInEuintKey(handle, value);
    }
}
