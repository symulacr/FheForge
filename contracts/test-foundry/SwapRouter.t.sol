// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "../contracts/MockERC20.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";
import {FheForgeBase} from "../contracts/FheForgeBase.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";

/// @custom:mock
contract SwapRouterTest is FheForgeTestHelper {
    uint256 internal constant MIN_DL = 30;
    uint256 internal constant MAX_DL = 7 days;
    uint256 internal constant EXEC_DELAY = 48 hours;
    address internal constant UNISWAP_ROUTER = address(0x1);

    SwapRouter public router;
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
        router = new SwapRouter(executor, MIN_DL, MAX_DL, EXEC_DELAY, UNISWAP_ROUTER);
        vm.stopPrank();

        vm.prank(owner);
        tokenIn.mint(user, 1000 ether);
    }

    function testConstructorSetsParams() public view {
        assertEq(router.executor(), executor);
        assertEq(router.owner(), owner);
        assertEq(router.MIN_DEADLINE_OFFSET(), MIN_DL);
        assertEq(router.MAX_DEADLINE_OFFSET(), MAX_DL);
        assertEq(router.ROTATION_DELAY(), EXEC_DELAY);
        assertEq(router.UNISWAP_V3_ROUTER(), UNISWAP_ROUTER);
    }

    function testConstructorRevertsOnZeroExecutor() public {
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new SwapRouter(address(0), MIN_DL, MAX_DL, EXEC_DELAY, UNISWAP_ROUTER);
    }

    function testConstructorRevertsOnZeroMinDeadline() public {
        vm.expectRevert(SwapRouter.DeadlineTooShort.selector);
        new SwapRouter(executor, 0, MAX_DL, EXEC_DELAY, UNISWAP_ROUTER);
    }

    function testConstructorRevertsOnMaxLessThanMin() public {
        vm.expectRevert(SwapRouter.DeadlineTooLong.selector);
        new SwapRouter(executor, 100, 50, EXEC_DELAY, UNISWAP_ROUTER);
    }

    function testSubmitSwapIntent() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        (address ti, address to, address u, uint256 dl) = router.getIntentMeta(intentId);
        assertEq(ti, address(tokenIn));
        assertEq(to, address(tokenOut));
        assertEq(u, user);
        assertTrue(dl > block.timestamp);
    }

    function testSubmitSwapIntentRevertsOnZeroTokenIn() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        router.submitSwapIntent(address(0), address(tokenOut), 100 ether, 70 ether, MIN_DL);
    }

    function testSubmitSwapIntentRevertsOnSameToken() public {
        vm.prank(user);
        vm.expectRevert(SwapRouter.SameToken.selector);
        router.submitSwapIntent(address(tokenIn), address(tokenIn), 100 ether, 70 ether, MIN_DL);
    }

    function testSubmitSwapIntentRevertsOnZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        router.submitSwapIntent(address(tokenIn), address(tokenOut), 0, 70 ether, MIN_DL);
    }

    function testSubmitSwapIntentRevertsOnDeadlineTooShort() public {
        vm.prank(user);
        vm.expectRevert(SwapRouter.DeadlineTooShort.selector);
        router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL - 1);
    }

    function testSubmitSwapIntentRevertsOnDeadlineTooLong() public {
        vm.prank(user);
        vm.expectRevert(SwapRouter.DeadlineTooLong.selector);
        router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MAX_DL + 1);
    }

    function testSubmitSwapIntentEscrowsTokens() public {
        tokenIn.balanceOf(address(router)); // burn — reverts on approval failure

        vm.prank(user);
        vm.expectRevert(); // No approval was given, so safeTransferFrom reverts
        router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
    }

    function testSubmitSwapIntentWithApproval() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        assertEq(tokenIn.balanceOf(address(router)), 100 ether);
        assertEq(tokenIn.balanceOf(user), 900 ether);

        (,, address u,) = router.getIntentMeta(intentId);
        assertEq(u, user);
    }

    function testCancelIntentReturnsTokens() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        router.cancelIntent(intentId);
        vm.stopPrank();

        assertEq(tokenIn.balanceOf(user), 1000 ether);
        assertEq(tokenIn.balanceOf(address(router)), 0);
    }

    function testCancelIntentRevertsOnNonCreator() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        vm.prank(owner);
        vm.expectRevert(SwapRouter.NotCreator.selector);
        router.cancelIntent(intentId);
    }

    function testCancelIntentRevertsOnUnknownIntent() public {
        vm.prank(user);
        vm.expectRevert(); // Unknown intents revert on transfer attempt (deleted mapping returns 0)
        router.cancelIntent(keccak256("ghost"));
    }

    function testExecuteIntent() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        uint256 outputAmount = 70 ether;

        vm.prank(owner);
        tokenOut.mint(executor, outputAmount);

        vm.startPrank(executor);
        tokenOut.approve(address(router), outputAmount);
        router.executeIntent(intentId, outputAmount);
        vm.stopPrank();

        assertEq(tokenOut.balanceOf(user), outputAmount);
        assertEq(tokenIn.balanceOf(executor), 100 ether);
        (,, address u,) = router.getIntentMeta(intentId);
        assertEq(u, address(0));
    }

    function testExecuteIntentRevertsOnNonExecutor() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(SwapRouter.NotExecutor.selector);
        router.executeIntent(intentId, 70 ether);
    }

    function testExecuteIntentRevertsOnUnknownIntent() public {
        vm.prank(executor);
        vm.expectRevert(SwapRouter.UnknownIntent.selector);
        router.executeIntent(keccak256("ghost"), 70 ether);
    }

    function testExecuteIntentRevertsOnZeroOutput() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        vm.prank(executor);
        vm.expectRevert(SwapRouter.ZeroOutput.selector);
        router.executeIntent(intentId, 0);
    }

    function testExecuteIntentRevertsOnInsufficientOutput() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        vm.stopPrank();

        vm.prank(executor);
        vm.expectRevert(SwapRouter.InsufficientOutput.selector);
        router.executeIntent(intentId, 69 ether); // < minAmountOut of 70
    }

    function testExecuteIntentRevertsOnExpiredDeadline() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 intentId = router.submitSwapIntent(
            address(tokenIn),
            address(tokenOut),
            100 ether,
            70 ether,
            MIN_DL // 30s deadline
        );
        vm.stopPrank();

        vm.warp(block.timestamp + MIN_DL + 1);

        vm.prank(executor);
        vm.expectRevert(SwapRouter.IntentExpired.selector);
        router.executeIntent(intentId, 70 ether);
    }

    function testSubmitSwapIntentUsesUniqueNonce() public {
        vm.startPrank(user);
        tokenIn.approve(address(router), 1000 ether);

        bytes32 intentA = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 70 ether, MIN_DL);
        bytes32 intentB = router.submitSwapIntent(address(tokenIn), address(tokenOut), 200 ether, 140 ether, MIN_DL);
        vm.stopPrank();

        assertTrue(intentA != intentB);
    }

    function testProposeExecutor() public {
        address newExec = makeAddr("newExec");
        vm.prank(owner);
        router.proposeExecutor(newExec);

        assertTrue(router.pendingRoleEarliest() > block.timestamp);
    }

    function testAcceptExecutorAfterDelay() public {
        address newExec = makeAddr("newExec");
        vm.prank(owner);
        router.proposeExecutor(newExec);

        vm.warp(block.timestamp + EXEC_DELAY);

        vm.prank(owner);
        router.acceptExecutor();

        assertEq(router.executor(), newExec);
    }

    function testAcceptExecutorRevertsOnEarlyAccept() public {
        address newExec = makeAddr("newExec");
        vm.prank(owner);
        router.proposeExecutor(newExec);

        vm.warp(block.timestamp + EXEC_DELAY - 1);

        vm.prank(owner);
        vm.expectRevert();
        router.acceptExecutor();
    }

    function testSwapViaUniswapSingleRevertsOnZeroAddress() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        router.swapViaUniswapV3Single(address(0), address(tokenOut), 3000, 100 ether, 70 ether);
    }

    function testSwapViaUniswapSingleRevertsOnZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        router.swapViaUniswapV3Single(address(tokenIn), address(tokenOut), 3000, 0, 0);
    }

    function testSwapViaMultiHopRevertsOnZeroAmount() public {
        bytes memory path = abi.encodePacked(address(tokenIn), uint24(3000), address(tokenOut));
        vm.prank(user);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        router.swapViaUniswapV3MultiHop(path, 0, 0);
    }
}
