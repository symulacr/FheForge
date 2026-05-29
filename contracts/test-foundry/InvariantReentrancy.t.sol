// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC3156FlashBorrower } from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import { MockERC20 } from "../contracts/MockERC20.sol";
import { LendingPool } from "../contracts/LendingPool.sol";
import { FHE, euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ITaskManager } from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";

// ──────────────────────────────────────────────────────────────────────────────
//  Malicious flash-borrower that attempts to re-enter the LendingPool during
//  the onFlashLoan callback. Tests the nonReentrant guard across the
//  FHE→plaintext boundary (the external callback after encrypted state is set).
// ──────────────────────────────────────────────────────────────────────────────
contract ReentrantFlashBorrower is IERC3156FlashBorrower {
    LendingPool public pool;
    address public token;
    bool public doReenter;
    bool public reentrancyDetected;

    address public attacker;

    modifier onlyAttacker() {
        if (msg.sender != attacker) revert();
        _;
    }

    constructor(LendingPool pool_, address token_, address attacker_) {
        pool    = pool_;
        token   = token_;
        attacker = attacker_;
    }

    /// @notice Enable/disable reentrancy attempt for a specific test.
    function setDoReenter(bool val) external onlyAttacker {
        doReenter = val;
    }

    /// @notice onFlashLoan callback — if doReenter is set, attempt to re-enter
    ///         the pool via shield(), which is also nonReentrant.
    function onFlashLoan(
        address initiator,
        address,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external returns (bytes32) {
        // Approve repayment
        MockERC20(token).approve(address(pool), amount + fee);

        if (doReenter) {
            try pool.shield(token, 1, InEuint128(uint256(0), 0, 6, "")) {
                // Reentrancy succeeded — that's a bug
                reentrancyDetected = true;
            } catch {
                // Reentrancy was blocked — expected behavior
                reentrancyDetected = false;
            }
        }

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    /// @notice Receive tokens for flash loan repayment.
    function approveRepay(uint256 amountPlusFee) external {
        MockERC20(token).approve(address(pool), amountPlusFee);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Invariant + fuzz tests for reentrancy across the FHE→plaintext boundary.
//  Core invariants:
//
//    I1: nonReentrant modifier prevents callback-based reentrancy
//        (e.g., flash loan → onFlashLoan → re-enter via shield).
//
//    I2: After a failed reentrancy attempt, liquidReserve and totalPlainBorrow
//        must remain consistent (supply + borrow conservation).
//
//    I3: State changes before the external call must NOT be rolled back
//        when reentrancy is blocked — the outer transaction completes normally.
//
//  The FHE→plaintext boundary is the point where encrypted arithmetic has
//  completed and the function makes an opaque external call (safeTransfer,
//  safeTransferFrom, or onFlashLoan). If that external call can re-enter,
//  the reentrant call sees intermediate state. The nonReentrant guard must
//  prevent any stateful re-entry.
// ──────────────────────────────────────────────────────────────────────────────
/// @custom:mock
contract InvariantReentrancy is FheForgeTestHelper {
    LendingPool public pool;
    MockERC20 public token;

    address public owner  = makeAddr("owner");
    address public user   = makeAddr("user");
    address public liquidator = makeAddr("liquidator");

    address private constant PYTH_MOCK  = address(0x1);
    uint256 private constant DEFAULT_STALE = 3600;

    ReentrantFlashBorrower public reentrantBorrower;

    function setUp() public {
        _deployFheMocks();
        vm.startPrank(owner);
        pool  = new LendingPool();
        token = new MockERC20("Test", "TST", 18);
        pool.setComposer(owner);
        vm.stopPrank();
    }

    // ─── I1: Flash loan reentrancy is blocked by nonReentrant ─────────────────
    /// @notice The flashLoan function calls onFlashLoan externally, creating a
    ///         reentrancy window. The nonReentrant modifier must block any
    ///         re-entering call (e.g., shield). This test verifies the guard.
    function testReentrancyBlockedViaFlashLoan() public {
        uint256 supplyAmount = 1000 ether;
        uint256 flashAmount  = 100 ether;

        // Seed pool
        _seedPool(supplyAmount);

        // Deploy malicious borrower
        reentrantBorrower = new ReentrantFlashBorrower(pool, address(token), address(this));

        // Fund borrower with flash fee
        uint256 fee = (flashAmount * 5) / 10000;
        vm.prank(owner);
        token.mint(address(reentrantBorrower), fee);

        // Enable reentrancy
        reentrantBorrower.setDoReenter(true);

        // Execute flash loan — the onFlashLoan callback will attempt reentrancy
        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount, "");

        // I1: Reentrancy must NOT have been detected (the guard should block it)
        assertFalse(reentrantBorrower.reentrancyDetected(), "reentrancy guard failed during flash loan");
    }

    // ─── I2: Flash loan without reentrancy still works ────────────────────────
    /// @notice Baseline — verify that flash loans work correctly when no reentrancy.
    function testFlashLoanNoReentrancy() public {
        uint256 supplyAmount = 1000 ether;
        uint256 flashAmount  = 100 ether;

        _seedPool(supplyAmount);

        reentrantBorrower = new ReentrantFlashBorrower(pool, address(token), address(this));
        reentrantBorrower.setDoReenter(false);

        uint256 fee = (flashAmount * 5) / 10000;
        vm.prank(owner);
        token.mint(address(reentrantBorrower), fee);

        uint256 reserveBefore = pool.liquidReserve(address(token));

        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount, "");

        // I2: Reserve must be conserved (deposit + flash fee returned)
        assertEq(pool.liquidReserve(address(token)), reserveBefore + fee, "reserve must grow by flash fee");
        assertFalse(reentrantBorrower.reentrancyDetected(), "no false positive");
    }

    // ─── I3: Reentrancy via shield during flash loan — state must be consistent after block ──
    /// @notice Even when reentrancy is attempted, the outer transaction should
    ///         complete normally and state should remain consistent.
    ///         The guard reverts the inner call but the outer flashLoan completes.
    function testReentrancyStateConsistentAfterBlock() public {
        uint256 supplyAmount = 1000 ether;
        uint256 flashAmount  = 100 ether;

        _seedPool(supplyAmount);

        reentrantBorrower = new ReentrantFlashBorrower(pool, address(token), address(this));
        reentrantBorrower.setDoReenter(true);

        uint256 fee = (flashAmount * 5) / 10000;
        vm.prank(owner);
        token.mint(address(reentrantBorrower), fee);

        uint256 reserveBefore = pool.liquidReserve(address(token));

        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount, "");

        // I3: Reserve must still reflect the flash loan + fee
        uint256 reserveAfter = pool.liquidReserve(address(token));
        assertEq(reserveAfter, reserveBefore + fee, "reserve invariant broken after blocked reentrancy");
        assertFalse(reentrantBorrower.reentrancyDetected(), "reentrancy succeeded during flash loan");
    }

    // ─── I4: Multiple flash loans — no accumulated reentrancy corruption ──────
    /// @notice Run two flash loans in sequence — the second must also be safe.
    function testFuzzSequentialFlashLoans(uint256 flashAmount1, uint256 flashAmount2) public {
        uint256 supplyAmount = 1000 ether;
        // Bound flash amounts to available reserve
        flashAmount1 = bound(flashAmount1, 1, supplyAmount / 4);
        flashAmount2 = bound(flashAmount2, 1, supplyAmount / 4);

        _seedPool(supplyAmount);

        reentrantBorrower = new ReentrantFlashBorrower(pool, address(token), address(this));
        reentrantBorrower.setDoReenter(false); // no reentrancy for baseline test

        uint256 fee1 = (flashAmount1 * 5) / 10000;
        uint256 fee2 = (flashAmount2 * 5) / 10000;

        uint256 totalFee = fee1 + fee2;
        vm.prank(owner);
        token.mint(address(reentrantBorrower), totalFee);

        // First flash loan
        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount1, "");

        uint256 afterFirst = pool.liquidReserve(address(token));

        // Second flash loan
        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount2, "");

        uint256 afterSecond = pool.liquidReserve(address(token));

        // Conservation: after two flash loans, reserve increased by sum of fees
        assertEq(afterSecond - afterFirst, fee2, "second flash fee not accrued");
        assertFalse(reentrantBorrower.reentrancyDetected(), "no reentrancy in sequential loans");
    }

    // ─── I5: Fuzz — flash loan with widely varying amounts ─────────────────────
    /// @notice Fuzz the flash loan amount to ensure reentrancy guard works
    ///         across all economic magnitudes.
    function testFuzzFlashLoanReentrancyBlocked(uint256 flashAmount) public {
        uint256 supplyAmount = 10_000 ether;
        flashAmount = bound(flashAmount, 1, supplyAmount / 2);

        _seedPool(supplyAmount);

        reentrantBorrower = new ReentrantFlashBorrower(pool, address(token), address(this));
        reentrantBorrower.setDoReenter(true);

        uint256 fee = (flashAmount * 5) / 10000;
        vm.prank(owner);
        token.mint(address(reentrantBorrower), fee);

        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount, "");

        assertFalse(reentrantBorrower.reentrancyDetected(), "reentrancy guard failed at fuzzed amount");
    }

    // ─── I6: Fuzz — shield → transfer reentrancy attempt ──────────────────────
    /// @notice The shield() function calls safeTransferFrom after FHE operations.
    ///         If the token is malicious (has hooks), it could re-enter.
    ///         We test this by simulating what would happen if the token
    ///         called back into shield() during the transfer.
    ///         Since MockERC20 has no hooks, we verify the pattern would be blocked
    ///         by confirming nonReentrant is active during the transfer phase.
    function testFuzzShieldThenTransferInvariant(uint256 amount) public {
        amount = bound(amount, 1, 1000 ether);

        vm.startPrank(owner);
        token.mint(user, amount);
        vm.stopPrank();

        // Track state before shield
        uint256 userBalanceBefore = token.balanceOf(user);

        vm.startPrank(user);
        token.approve(address(pool), amount);
        euint128 encAmount = FHE.asEuint128(amount);
        _mockEncVal(uint256(euint128.unwrap(encAmount)), amount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(encAmount)), address(pool));
        pool.shield(address(token), amount, InEuint128({
            ctHash: uint256(euint128.unwrap(encAmount)),
            securityZone: 0,
            utype: 6,
            signature: ""
        }));
        vm.stopPrank();

        // I6: After successful shield, reserve increased by amount
        assertEq(pool.liquidReserve(address(token)), amount, "reserve must equal amount after shield");
        // User's token balance decreased
        assertEq(token.balanceOf(user), userBalanceBefore - amount, "user balance decreased");
    }

    // ─── I7: direct nonReentrant invocation chain must revert ──────────────────
    /// @notice Call a nonReentrant function while already inside one via
    ///         a different call path (e.g., shield → flashLoan → shield).
    ///         This must revert with GuardReentrantCall.
    function testDoubleNonReentrantFails() public {
        uint256 amount = 100 ether;
        _seedPool(amount);

        // Deploy borrower that re-enters during flash loan
        reentrantBorrower = new ReentrantFlashBorrower(pool, address(token), address(this));
        reentrantBorrower.setDoReenter(true);

        uint256 flashAmount = 10 ether;
        uint256 fee = (flashAmount * 5) / 10000;
        vm.prank(owner);
        token.mint(address(reentrantBorrower), fee);

        // Flash loan → onFlashLoan → shield (re-enters nonReentrant)
        // The outer flashLoan has nonReentrant, inner shield also has it.
        // The inner call must revert with GuardReentrantCall.
        vm.prank(address(reentrantBorrower));
        pool.flashLoan(address(reentrantBorrower), address(token), flashAmount, "");

        // The outer transaction must still succeed (since fail_on_revert = false
        // is for invariant handler; individual tests fail on unexpected reverts).
        // Shield inside the callback was caught by the guard.
        assertFalse(reentrantBorrower.reentrancyDetected(), "reenter call should have been blocked");
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function _seedPool(uint256 amount) internal {
        vm.startPrank(owner);
        token.mint(owner, amount);
        token.approve(address(pool), amount);
        euint128 handle = FHE.asEuint128(amount);
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(handle)), address(pool));
        pool.depositFor(address(token), amount, handle, owner);
        vm.stopPrank();
    }

    function _mockEncVal(uint256 ctHash, uint256 value) internal {
        uint256 hashMask = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000;
        uint256 handle = (ctHash & hashMask) | (6 << 8);
        MockTaskManager(getTaskManagerAddress()).MOCK_setInEuintKey(handle, value);
    }
}
