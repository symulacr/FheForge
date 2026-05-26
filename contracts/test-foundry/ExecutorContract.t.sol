// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { SwapRouter } from "../contracts/SwapRouter.sol";
import { ExecutorContract } from "../contracts/ExecutorContract.sol";
// selector 0x118cdaa7 = OwnableUnauthorizedAccount(address) — hardcoded per TestHelper pattern
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";

contract ExecutorContractTest is FheForgeTestHelper {
    error ExecutorContractTest_IntentNotDeleted();

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
        _deployFheMocks();
        vm.startPrank(owner);

        tokenIn = new MockERC20("TokenIn", "TIN", 18);
        tokenOut = new MockERC20("TokenOut", "TOUT", 18);

        executorContract = new ExecutorContract();

        router = new SwapRouter(
            address(executorContract),
            MIN_DEADLINE,
            MAX_DEADLINE,
            EXEC_DELAY,
            address(0x1)
        );

        tokenIn.mint(user, 100 ether);

        vm.stopPrank();
    }

    /// @notice Full integration test: owner executes intent via ExecutorContract
    function testExecuteIntentViaContract() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DEADLINE
        );
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        vm.startPrank(owner);
        tokenOut.mint(address(executorContract), outputAmount);

        executorContract.approveToken(address(tokenOut), address(router), outputAmount);

        executorContract.executeIntent(address(router), intentId, outputAmount);
        vm.stopPrank();

        assertEq(tokenOut.balanceOf(user), outputAmount, "user should receive outputAmount");

        (, , address u, ) = router.getIntentMeta(intentId);
        if (u != address(0)) revert ExecutorContractTest_IntentNotDeleted();
    }

    /// @notice Only owner can call executeIntent
    function testExecuteIntentRejectsNonOwner() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DEADLINE
        );
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        vm.startPrank(owner);
        tokenOut.mint(address(executorContract), outputAmount);
        executorContract.approveToken(address(tokenOut), address(router), outputAmount);
        vm.stopPrank();

        // Non-owner tries to execute
        vm.startPrank(user);
        vm.expectRevert(abi.encodeWithSelector(0x118cdaa7, user));
        executorContract.executeIntent(address(router), intentId, outputAmount);
        vm.stopPrank();
    }

    /// @notice WithdrawTokens works for owner
    function testWithdrawTokens() public {
        uint256 amount = 100 ether;

        vm.prank(owner);
        tokenOut.mint(address(executorContract), amount);

        assertEq(tokenOut.balanceOf(address(executorContract)), amount);

        uint256 ownerBalanceBefore = tokenOut.balanceOf(owner);

        vm.prank(owner);
        executorContract.withdrawTokens(address(tokenOut), amount);

        assertEq(tokenOut.balanceOf(address(executorContract)), 0);
        assertEq(tokenOut.balanceOf(owner), ownerBalanceBefore + amount);
    }

    /// @notice Only owner can withdraw
    function testWithdrawTokensRejectsNonOwner() public {
        uint256 amount = 100 ether;

        vm.prank(owner);
        tokenOut.mint(address(executorContract), amount);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(0x118cdaa7, user));
        executorContract.withdrawTokens(address(tokenOut), amount);
    }

    /// @notice executeIntent reverts when executor is unfunded
    function testExecuteIntentRevertsWhenUnfunded() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DEADLINE
        );
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        vm.startPrank(owner);
        executorContract.approveToken(address(tokenOut), address(router), outputAmount);

        // Should revert because executorContract has no tokenOut balance
        vm.expectRevert();
        executorContract.executeIntent(address(router), intentId, outputAmount);
        vm.stopPrank();
    }
}
