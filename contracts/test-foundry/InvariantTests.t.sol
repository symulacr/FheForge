// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "../contracts/MockERC20.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";
import {ExecutorContract} from "../contracts/ExecutorContract.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";

/// @notice Foundry invariant/fuzz tests for non-FHE protocol invariants (MC-073).
///         These tests validate that core constraints hold across various inputs.
/// @custom:mock
contract InvariantTests is FheForgeTestHelper {
    uint256 internal constant MIN_DL = 30;
    uint256 internal constant MAX_DL = 7 days;
    uint256 internal constant EXEC_DELAY = 48 hours;
    address internal constant UNISWAP_ROUTER = address(0x1);

    SwapRouter public router;
    ExecutorContract public executorContract;
    MockERC20 public tokenIn;
    MockERC20 public tokenOut;

    address public owner = makeAddr("owner");
    address public executor = makeAddr("executor");
    address public user = makeAddr("user");

    function setUp() public {
        _deployFheMocks();
        vm.startPrank(owner);
        tokenIn = new MockERC20("TokenIn", "TIN", 18);
        tokenOut = new MockERC20("TokenOut", "TOUT", 18);
        executorContract = new ExecutorContract();
        router = new SwapRouter(address(executorContract), MIN_DL, MAX_DL, EXEC_DELAY, UNISWAP_ROUTER);
        vm.stopPrank();

        vm.prank(owner);
        tokenIn.mint(user, 10000 ether);
    }

    function testFuzzSubmitAndCancel(uint128 amount, uint128 minOut, uint256 deadlineOffset) public {
        // Constrain inputs to valid ranges
        if (amount == 0) return;
        if (amount > 10000 ether) return; // user balance bound
        if (minOut > amount) return;
        vm.assume(deadlineOffset > MIN_DL - 1 && deadlineOffset < MAX_DL + 1);

        vm.startPrank(user);
        tokenIn.approve(address(router), amount);

        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), amount, minOut, deadlineOffset);

        uint256 userBalanceBefore = tokenIn.balanceOf(user);
        router.cancelIntent(intentId);
        uint256 userBalanceAfter = tokenIn.balanceOf(user);
        vm.stopPrank();

        // Invariant: After cancel, user has all their tokens back
        assertEq(userBalanceAfter, userBalanceBefore + amount, "escrow leak on cancel");
    }

    function testFuzzUniqueIntents(uint128 amountA, uint128 amountB, uint128 minOutA, uint128 minOutB) public {
        if (amountA == 0 || amountB == 0) return;
        if (uint256(amountA) + uint256(amountB) > 10000 ether) return; // user balance bound + overflow protection
        if (minOutA > amountA || minOutB > amountB) return;
        vm.assume(keccak256(abi.encode(amountA, amountB)) != keccak256(abi.encode(amountA, amountB)) || true);

        vm.startPrank(user);
        tokenIn.approve(address(router), uint256(amountA) + uint256(amountB));

        bytes32 idA = router.submitSwapIntent(address(tokenIn), address(tokenOut), amountA, minOutA, MIN_DL);
        bytes32 idB = router.submitSwapIntent(address(tokenIn), address(tokenOut), amountB, minOutB, MIN_DL);
        vm.stopPrank();

        // Invariant: Different intents must have different IDs
        assertTrue(idA != idB, "duplicate intent ID");
    }

    function testFuzzTimelockEnforced() public {
        address newExec = makeAddr("newExec");
        vm.prank(owner);
        router.proposeExecutor(newExec);

        // Accept before delay should revert
        vm.expectRevert();
        router.acceptExecutor();

        // After delay it succeeds
        vm.warp(block.timestamp + EXEC_DELAY);
        vm.prank(owner);
        router.acceptExecutor();
        assertEq(router.executor(), newExec);
    }

    function testFuzzDeadlineBoundaries(uint256 offset) public {
        // Test every boundary: below min, at min, between, at max, above max
        vm.assume(offset < MAX_DL * 2 + 1);

        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);

        if (offset < MIN_DL) {
            vm.expectRevert(SwapRouter.DeadlineTooShort.selector);
            router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 50 ether, offset);
        } else if (offset > MAX_DL) {
            vm.expectRevert(SwapRouter.DeadlineTooLong.selector);
            router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 50 ether, offset);
        } else {
            bytes32 id = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 50 ether, offset);
            (,,, uint256 dl) = router.getIntentMeta(id);
            assertTrue(dl > block.timestamp + MIN_DL - 1, "deadline too early");
            assertTrue(dl < block.timestamp + MAX_DL + 1, "deadline too late");
        }
        vm.stopPrank();
    }

    function testFuzzOnlyExecutorCanExecute(uint256 amount, uint256 minOut, uint256 deadlineOffset) public {
        if (amount == 0) return;
        if (amount > 10000 ether) return; // user balance bound
        if (minOut == 0 || minOut > amount) return;
        vm.assume(deadlineOffset > MIN_DL - 1 && deadlineOffset < MAX_DL + 1);

        address randomCaller = makeAddr("random");

        vm.startPrank(user);
        tokenIn.approve(address(router), amount);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), amount, minOut, deadlineOffset);
        vm.stopPrank();

        vm.prank(randomCaller);
        vm.expectRevert(SwapRouter.NotExecutor.selector);
        router.executeIntent(intentId, minOut);
    }

    function testFuzzBalanceConservation(uint128 amount, uint128 minOut, uint256 deadlineOffset) public {
        if (amount == 0) return;
        if (amount > 10000 ether) return; // user balance bound
        if (minOut == 0 || minOut > amount) return;
        vm.assume(deadlineOffset > MIN_DL - 1 && deadlineOffset < MAX_DL + 1);

        uint256 totalBefore = tokenIn.balanceOf(address(router)) + tokenIn.balanceOf(user) + tokenIn.balanceOf(owner);

        vm.startPrank(user);
        tokenIn.approve(address(router), amount);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), amount, minOut, deadlineOffset);

        uint256 afterSubmit = tokenIn.balanceOf(address(router)) + tokenIn.balanceOf(user) + tokenIn.balanceOf(owner);
        assertEq(afterSubmit, totalBefore, "balance changed on submit");

        router.cancelIntent(intentId);
        vm.stopPrank();

        uint256 afterCancel = tokenIn.balanceOf(address(router)) + tokenIn.balanceOf(user) + tokenIn.balanceOf(owner);
        assertEq(afterCancel, totalBefore, "balance changed after cancel");
    }
}
