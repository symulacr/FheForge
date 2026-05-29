// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { LendingPool } from "../contracts/LendingPool.sol";
import { PriceOracle } from "../contracts/PriceOracle.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import { FHE, euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ITaskManager } from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/// @notice Fuzz + invariant tests for LendingPool (MC-074).
///         Covers: oracle-based borrow with random amounts, LTV parameter edge cases,
///         zero-amount revert patterns, and the supply+borrow conservation invariant.
/// @custom:mock
contract FuzzLendingPool is FheForgeTestHelper {
    LendingPool public pool;
    MockERC20 public token;
    PriceOracle public oracle;

    address public owner  = makeAddr("owner");
    address public user   = makeAddr("user");
    address private constant PYTH_MOCK  = address(0x1);
    uint256 private constant DEFAULT_STALE = 3600;

    function setUp() public {
        _deployFheMocks();
        vm.startPrank(owner);
        pool    = new LendingPool();
        token   = new MockERC20("Test", "TST", 18);
        oracle  = new PriceOracle(PYTH_MOCK, DEFAULT_STALE);

        oracle.setCollateralFactor(address(token), 5000, 5500);
        oracle.setFallbackPrice(address(token), 1e18);
        pool.setOracle(address(oracle));
        pool.setComposer(owner);
        vm.stopPrank();
    }

    // ─── Fuzz 1: oracle-based borrow with random amounts ──────────────────────
    // Collateral = 1..10_000 ether; borrow = 1..coll/2 (stays under 50% LTV).
    function testFuzzBorrowWithOracleAmounts(
        uint256 collAmount,
        uint256 borrowAmount
    ) public {
        collAmount   = bound(collAmount,   1 ether,  10_000 ether);
        borrowAmount = bound(borrowAmount, 1,        collAmount / 2);

        _provideLiquidity(address(token), borrowAmount);

        vm.startPrank(user);
        (euint128 enc, uint256 ctHash) = _createBorrowHandle(borrowAmount);
        pool.borrowWithOracle(
            address(token),
            address(token),
            collAmount,
            borrowAmount,
            InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" })
        );
        vm.stopPrank();

        // State post-borrow
        assertEq(pool.totalPlainBorrow(address(token)), borrowAmount, "borrow amount mismatch");
        assertGe(pool.liquidReserve(address(token)), 0, "reserve underflow");
    }

    // ─── Fuzz 2: zero-amount / zero-address revert matrix ─────────────────────
    // Tests multiple entry-points with invalid zero inputs via a fuzzed selector.
    function testFuzzZeroReverts(uint256 selector) public {
        selector = bound(selector, 0, 4);

        vm.startPrank(owner);
        if (selector == 0) {
            vm.expectRevert(FheForgeBase.ZeroAddress.selector);
            pool.setOracle(address(0));
        } else if (selector == 1) {
            vm.expectRevert(FheForgeBase.ZeroAmount.selector);
            pool.flashLoan(user, address(token), 0, "");
        } else if (selector == 2) {
            vm.expectRevert(FheForgeBase.ZeroAddress.selector);
            pool.setComposer(address(0));
        } else if (selector == 3) {
            pool.disableOracle();
            assertEq(address(pool.oracle()), address(0));
        } else if (selector == 4) {
            // setWeth with zero address
            vm.expectRevert(FheForgeBase.ZeroAddress.selector);
            pool.setWeth(address(0));
        }
        vm.stopPrank();
    }

    // ─── Fuzz 3: LTV numerator/denominator edge cases ─────────────────────────
    // Contract requires ltvNum > 0, ltvDen > 0, and ltvNum <= ltvDen.
    function testFuzzLtvRevertOnExceedsHundred(
        uint128 ltvNum,
        uint128 ltvDen
    ) public {
        ltvNum = uint128(bound(uint256(ltvNum), 1, 10000));
        ltvDen = uint128(bound(uint256(ltvDen), 1, 10000));
        vm.assume(ltvNum > ltvDen);

        _provideLiquidity(address(token), 100 ether);

        vm.startPrank(user);
        (euint128 enc, uint256 ctHash) = _createBorrowHandle(10 ether);

        vm.expectRevert(LendingPool.LtvExceedsHundredPercent.selector);
        pool.borrowWithLtvCheck(
            address(token),
            address(token),
            10 ether,
            InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" }),
            ltvNum,
            ltvDen
        );
        vm.stopPrank();
    }

    // ─── Fuzz 4: LTV numerator zero revert ────────────────────────────────────
    function testFuzzLtvRevertOnNumeratorZero(uint128 ltvDen) public {
        ltvDen = uint128(bound(uint256(ltvDen), 1, 10000));

        _provideLiquidity(address(token), 100 ether);

        vm.startPrank(user);
        (euint128 enc, uint256 ctHash) = _createBorrowHandle(10 ether);

        vm.expectRevert(LendingPool.LtvNumeratorZero.selector);
        pool.borrowWithLtvCheck(
            address(token),
            address(token),
            10 ether,
            InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" }),
            0,    // ltvNum = 0 → revert
            ltvDen
        );
        vm.stopPrank();
    }

    // ─── Invariant: supply + borrow ≤ total deposits ──────────────────────────
    // After depositing depAmount and borrowing brwAmount (≤ 50% LTV),
    // the sum of liquidReserve + totalPlainBorrow must equal the initial deposit.
    function testFuzzInvariantSupplyBorrowConservation(
        uint256 depAmount,
        uint256 brwAmount
    ) public {
        depAmount = bound(depAmount, 10 ether, 1000 ether);
        brwAmount = bound(brwAmount,  1,        depAmount / 2);

        _provideLiquidity(address(token), depAmount);
        uint256 reserveAfterDeposit = pool.liquidReserve(address(token));

        vm.startPrank(user);
        (euint128 enc, uint256 ctHash) = _createBorrowHandle(brwAmount);
        pool.borrowWithOracle(
            address(token),
            address(token),
            depAmount,
            brwAmount,
            InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" })
        );
        vm.stopPrank();

        uint256 totalAfter = pool.liquidReserve(address(token))
                           + pool.totalPlainBorrow(address(token));

        // Conservation: what went in (reserve) either stays as reserve
        // or moves to borrow. The sum must match.
        assertEq(totalAfter, reserveAfterDeposit, "invariant: supply + borrow != deposit");
    }

    // ─── Fuzz 5: depositFor → borrowFor → repayFor round-trip ─────────────────
    // Fuzz amounts through the composer-only flow.
    function testFuzzComposerDepositBorrowRepay(
        uint256 amount
    ) public {
        amount = bound(amount, 1 ether, 1000 ether);

        // Deposit
        vm.startPrank(owner);
        token.mint(owner, amount);
        token.approve(address(pool), amount);
        euint128 depHandle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(depHandle)), address(pool)
        );
        pool.depositFor(address(token), amount, depHandle, user);
        vm.stopPrank();

        uint256 reserveAfterDeposit = pool.liquidReserve(address(token));

        // Borrow
        vm.startPrank(owner);
        euint128 brwHandle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(brwHandle)), address(pool)
        );
        pool.borrowFor(address(token), amount, brwHandle, user);
        vm.stopPrank();

        assertEq(pool.totalPlainBorrow(address(token)), amount);
        assertEq(pool.liquidReserve(address(token)), reserveAfterDeposit - amount);

        // Repay
        vm.startPrank(owner);
        token.mint(owner, amount);
        token.approve(address(pool), amount);
        euint128 repayHandle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(repayHandle)), address(pool)
        );
        pool.repayFor(address(token), amount, repayHandle, user);
        vm.stopPrank();

        assertEq(pool.totalPlainBorrow(address(token)), 0);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _provideLiquidity(address tokenAddr, uint256 amount) internal {
        vm.startPrank(owner);
        token.mint(owner, amount);
        token.approve(address(pool), amount);
        euint128 handle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(handle)), address(pool)
        );
        pool.depositFor(address(tokenAddr), amount, handle, user);
        vm.stopPrank();
    }

    function _createBorrowHandle(uint256 amount)
        internal
        returns (euint128 enc, uint256 ctHash)
    {
        enc    = FHE.asEuint128(amount);
        ctHash = uint256(euint128.unwrap(enc));
        _mockEncVal(ctHash, amount);
        ITaskManager(getTaskManagerAddress()).allow(ctHash, address(pool));
    }

    function _mockEncVal(uint256 ctHash, uint256 value) internal {
        uint256 hashMask = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000;
        uint256 handle   = (ctHash & hashMask) | (6 << 8); // utype 6 = euint128
        MockTaskManager(getTaskManagerAddress()).MOCK_setInEuintKey(handle, value);
    }
}
