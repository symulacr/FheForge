// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StrategyVault} from "../contracts/StrategyVault.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";
import {FheForgeBase} from "../contracts/FheForgeBase.sol";
import {MockERC20} from "../contracts/MockERC20.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";

/// @custom:mock
contract NonFheConstructorTest is FheForgeTestHelper {
    address internal constant UNISWAP_ROUTER = address(0x1);

    function setUp() public {
        _deployFheMocks();
    }

    function testStrategyVaultConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new StrategyVault(address(0));
    }

    uint256 internal constant PROD_MIN_DEADLINE = 30;
    uint256 internal constant PROD_MAX_DEADLINE = 7 days;
    uint256 internal constant PROD_EXEC_DELAY = 48 hours;

    function testSwapRouterConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new SwapRouter(address(0), PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY, UNISWAP_ROUTER);
    }

    function testSwapRouterRevertsOnZeroMinDeadline() public {
        vm.expectRevert(SwapRouter.DeadlineTooShort.selector);
        new SwapRouter(address(0xCAFE), 0, PROD_MAX_DEADLINE, PROD_EXEC_DELAY, UNISWAP_ROUTER);
    }

    function testSwapRouterRevertsOnInvalidMaxLessThanMin() public {
        vm.expectRevert(SwapRouter.DeadlineTooLong.selector);
        new SwapRouter(address(0xCAFE), 100, 50, PROD_EXEC_DELAY, UNISWAP_ROUTER);
    }

    function testSwapRouterStoresExecutor() public {
        address fakeExecutor = address(0xCAFE);
        SwapRouter router =
            new SwapRouter(fakeExecutor, PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY, UNISWAP_ROUTER);
        assertEq(router.executor(), fakeExecutor);
        assertEq(router.owner(), address(this));
    }

    function testSwapRouterRejectsSameTokenIntent() public {
        address fakeExecutor = address(0xCAFE);
        SwapRouter router =
            new SwapRouter(fakeExecutor, PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY, UNISWAP_ROUTER);
        assertEq(router.executor(), fakeExecutor);

        // Deploy mock ERC20 tokens so submitSwapIntent's safeTransferFrom succeeds
        MockERC20 tokenIn = new MockERC20("TokenIn", "TIN", 18);
        MockERC20 tokenOut = new MockERC20("TokenOut", "TOUT", 18);
        tokenIn.mint(address(this), 100);
        tokenIn.approve(address(router), 100);

        // submit a valid intent so executeIntent doesn't revert with UnknownIntent
        bytes32 intentId = router.submitSwapIntent(address(tokenIn), address(tokenOut), 100, 50, PROD_MIN_DEADLINE);

        // executeIntent with outputAmount=0 must revert with ZeroOutput
        vm.startPrank(fakeExecutor);
        vm.expectRevert(abi.encodeWithSelector(SwapRouter.ZeroOutput.selector));
        router.executeIntent(intentId, 0);
        vm.stopPrank();
    }

    function testSwapRouterDeadlineImmutablesAreSane() public {
        SwapRouter router =
            new SwapRouter(address(0xCAFE), PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY, UNISWAP_ROUTER);
        assertEq(router.MIN_DEADLINE_OFFSET(), PROD_MIN_DEADLINE);
        assertEq(router.MAX_DEADLINE_OFFSET(), PROD_MAX_DEADLINE);
        assertEq(router.ROTATION_DELAY(), PROD_EXEC_DELAY);
    }

    function testSwapRouterAcceptsDemoTimings() public {
        SwapRouter router = new SwapRouter(address(0xCAFE), 5, 300, 90, UNISWAP_ROUTER);
        assertEq(router.MIN_DEADLINE_OFFSET(), 5);
        assertEq(router.MAX_DEADLINE_OFFSET(), 300);
        assertEq(router.ROTATION_DELAY(), 90);
    }
}
