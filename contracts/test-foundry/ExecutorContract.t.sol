// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { Test, console } from "forge-std/Test.sol";
import { MockERC20 } from "../contracts/MockERC20.sol";
import { SwapRouter } from "../contracts/SwapRouter.sol";
import { ExecutorContract } from "../contracts/ExecutorContract.sol";

contract ExecutorContractTest is Test {
    uint256 internal constant MIN_DEADLINE = 30;
    uint256 internal constant MAX_DEADLINE = 7 days;
    uint256 internal constant EXEC_DELAY = 48 hours;

    MockERC20 public tokenOut;
    MockERC20 public tokenIn;
    ExecutorContract public executorContract;
    SwapRouter public router;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock tokens
        tokenIn = new MockERC20();
        tokenOut = new MockERC20();

        // Deploy executor (owner becomes contract owner)
        executorContract = new ExecutorContract();

        // Deploy swap router with executorContract as the executor
        router = new SwapRouter(address(executorContract), MIN_DEADLINE, MAX_DEADLINE, EXEC_DELAY);

        vm.stopPrank();
    }

    /// @notice Full integration test: owner executes intent via ExecutorContract
    function test_ExecuteIntentViaContract() public {
        // 1. User submits a swap intent
        vm.startPrank(user);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DEADLINE
        );
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        // 2. Owner funds executorContract with tokenOut
        vm.startPrank(owner);
        tokenOut.mint(address(executorContract), outputAmount);

        // 3. ExecutorContract approves router to spend tokenOut
        executorContract.approveToken(address(tokenOut), address(router), outputAmount);

        // 4. Owner triggers intent execution via executorContract
        executorContract.executeIntent(address(router), intentId, outputAmount);
        vm.stopPrank();

        // 5. Verify user received the tokens
        assertEq(tokenOut.balanceOf(user), outputAmount, "user should receive outputAmount");

        // 6. Verify the intent is cleared (executed intents are deleted)
        (, , address u, ) = router.getIntentMeta(intentId);
        assertEq(u, address(0), "intent should be deleted after execution");
    }

    /// @notice Only owner can call executeIntent
    function test_ExecuteIntentRejectsNonOwner() public {
        vm.startPrank(user);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DEADLINE
        );
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        // Fund and approve
        vm.startPrank(owner);
        tokenOut.mint(address(executorContract), outputAmount);
        executorContract.approveToken(address(tokenOut), address(router), outputAmount);
        vm.stopPrank();

        // Non-owner tries to execute
        vm.startPrank(user);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user)
        );
        executorContract.executeIntent(address(router), intentId, outputAmount);
        vm.stopPrank();
    }

    /// @notice WithdrawTokens works for owner
    function test_WithdrawTokens() public {
        uint256 amount = 100 ether;

        // Owner funds executor
        vm.prank(owner);
        tokenOut.mint(address(executorContract), amount);

        assertEq(tokenOut.balanceOf(address(executorContract)), amount);

        uint256 ownerBalanceBefore = tokenOut.balanceOf(owner);

        // Owner withdraws
        vm.prank(owner);
        executorContract.withdrawTokens(address(tokenOut), amount);

        assertEq(tokenOut.balanceOf(address(executorContract)), 0);
        assertEq(tokenOut.balanceOf(owner), ownerBalanceBefore + amount);
    }

    /// @notice Only owner can withdraw
    function test_WithdrawTokensRejectsNonOwner() public {
        uint256 amount = 100 ether;

        vm.prank(owner);
        tokenOut.mint(address(executorContract), amount);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user)
        );
        executorContract.withdrawTokens(address(tokenOut), amount);
    }

    /// @notice executeIntent reverts when executor is unfunded
    function test_ExecuteIntentRevertsWhenUnfunded() public {
        vm.startPrank(user);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DEADLINE
        );
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        // Approve router but don't fund executor
        vm.startPrank(owner);
        executorContract.approveToken(address(tokenOut), address(router), outputAmount);

        // Should revert because executorContract has no tokenOut balance
        vm.expectRevert();
        executorContract.executeIntent(address(router), intentId, outputAmount);
        vm.stopPrank();
    }
}
