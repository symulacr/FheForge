// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "../contracts/MockERC20.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";
import {FheForgeBase} from "../contracts/FheForgeBase.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";

/// @notice Fuzz tests for SwapRouter (MC-075).
///         Extends coverage beyond InvariantTests.t.sol with deadline boundary
///         fuzzing, amount/minOut ratio fuzzing, swap validation fuzzing,
///         and executor timelock boundary fuzzing.
/// @custom:mock
contract FuzzSwapRouter is FheForgeTestHelper {
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
        tokenIn.mint(user, 10_000 ether);
    }

    // ─── Fuzz 1: deadline boundary exact values ───────────────────────────────
    // Submit at exactly MIN_DL and MAX_DL; verify deadline is set correctly.
    function testFuzzDeadlineBoundaryExact(uint256 offset) public {
        vm.assume(offset == MIN_DL || offset == MAX_DL);

        vm.startPrank(user);
        tokenIn.approve(address(router), 100 ether);
        bytes32 id = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100 ether, 50 ether, offset);
        vm.stopPrank();

        (,,, uint256 dl) = router.getIntentMeta(id);
        assertEq(dl, block.timestamp + offset, "deadline mismatch");
    }

    // ─── Fuzz 2: amount / minOut ratio boundaries ─────────────────────────────
    // Contracts allow minAmountOut up to amountIn. Test various ratios.
    function testFuzzAmountAndMinOut(uint256 amountIn, uint256 minOut) public {
        amountIn = bound(amountIn, 1 ether, 10_000 ether);
        minOut = bound(minOut, 0, amountIn);

        vm.startPrank(user);
        tokenIn.approve(address(router), amountIn);

        if (minOut == 0) {
            // minOut = 0 is allowed; submits fine but execution would need > 0
            bytes32 id = router.submitSwapIntent(address(tokenIn), address(tokenOut), amountIn, 0, MIN_DL);
            (,,, uint256 dl) = router.getIntentMeta(id);
            assertTrue(dl > block.timestamp, "deadline not set");
        } else {
            bytes32 id = router.submitSwapIntent(address(tokenIn), address(tokenOut), amountIn, minOut, MIN_DL);
            (,,, uint256 dl) = router.getIntentMeta(id);
            assertTrue(dl > block.timestamp, "deadline not set");
        }
        vm.stopPrank();
    }

    // ─── Fuzz 3: executor timelock boundary ───────────────────────────────────
    // After proposing an executor, test that accept fails before EXEC_DELAY
    // and succeeds after EXEC_DELAY with various warp offsets.
    function testFuzzExecutorTimelockBoundary(uint256 warpOffset) public {
        warpOffset = bound(warpOffset, 0, EXEC_DELAY + 7 days);

        address newExec = makeAddr("newExec");
        vm.prank(owner);
        router.proposeExecutor(newExec);

        vm.warp(block.timestamp + warpOffset);

        if (warpOffset < EXEC_DELAY) {
            vm.prank(owner);
            vm.expectRevert();
            router.acceptExecutor();
        } else {
            vm.prank(owner);
            router.acceptExecutor();
            assertEq(router.executor(), newExec);
        }
    }

    // ─── Fuzz 4: swapViaUniswapV3 validation (address/amount) ─────────────────
    // Without a real Uniswap router, these calls always revert, but we verify
    // input validation reverts happen first.
    function testFuzzSwapViaUniswapValidation(
        address tokenInAddr,
        address tokenOutAddr,
        uint256 amountIn,
        uint256 amountOutMin
    ) public {
        vm.assume(tokenInAddr != address(0) || tokenOutAddr != address(0));
        amountIn = bound(amountIn, 0, 1000 ether);
        amountOutMin = bound(amountOutMin, 0, amountIn);

        vm.prank(user);

        if (tokenInAddr == address(0) || tokenOutAddr == address(0)) {
            // Zero-address check comes first
            vm.expectRevert(FheForgeBase.ZeroAddress.selector);
            router.swapViaUniswapV3Single(tokenInAddr, tokenOutAddr, 3000, amountIn > 0 ? amountIn : 1, amountOutMin);
        } else if (amountIn == 0) {
            // Zero-amount check
            vm.expectRevert(FheForgeBase.ZeroAmount.selector);
            router.swapViaUniswapV3Single(tokenInAddr, tokenOutAddr, 3000, 0, 0);
        }
        // If both valid, the call would reach Uniswap and revert for other reasons;
        // we only test the validation layer here.
    }

    // ─── Fuzz 5: multi-hop swap validation ────────────────────────────────────
    function testFuzzMultiHopValidation(uint256 amountIn) public {
        amountIn = bound(amountIn, 0, 1000 ether);
        bytes memory path = abi.encodePacked(address(tokenIn), uint24(3000), address(tokenOut));

        vm.prank(user);
        if (amountIn == 0) {
            vm.expectRevert(FheForgeBase.ZeroAmount.selector);
            router.swapViaUniswapV3MultiHop(path, 0, 0);
        }
        // Non-zero amountIn reaches Uniswap and reverts there — not tested
    }

    // ─── Fuzz 6: submit with max-user balance ─────────────────────────────────
    // Submit intents near the user's maximum balance (100% of balance).
    function testFuzzSubmitAtMaxBalance(uint256 pct) public {
        pct = bound(pct, 1, 100);
        uint256 amount = (10_000 ether * pct) / 100;
        vm.assume(amount > 0);

        vm.startPrank(user);
        tokenIn.approve(address(router), amount);
        bytes32 id = router.submitSwapIntent(address(tokenIn), address(tokenOut), amount, amount / 2, MIN_DL);
        vm.stopPrank();

        assertTrue(id != bytes32(0), "intent ID zero");
        assertEq(tokenIn.balanceOf(address(router)), amount, "escrow amount mismatch");
    }

    // ─── Fuzz 7: submit + cancel with random amounts ──────────────────────────
    // Verify tokens are fully reclaimable after cancel across fuzz ranges.
    function testFuzzSubmitAndCancelReclaim(uint256 amount) public {
        amount = bound(amount, 1, 10_000 ether);

        vm.startPrank(user);
        tokenIn.approve(address(router), amount);

        uint256 before = tokenIn.balanceOf(user);
        bytes32 id = router.submitSwapIntent(address(tokenIn), address(tokenOut), amount, amount / 2, MIN_DL);
        router.cancelIntent(id);
        uint256 afterBalance = tokenIn.balanceOf(user);
        vm.stopPrank();

        assertEq(afterBalance, before, "cancel did not fully reclaim");
    }
}
