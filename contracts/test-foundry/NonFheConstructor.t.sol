// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";
import {StrategyVault} from "../contracts/StrategyVault.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";











contract NonFheConstructorTest is Test {
    function test_StrategyVaultConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(StrategyVault.ZeroAddress.selector);
        new StrategyVault(address(0));
    }


    uint256 internal constant PROD_MIN_DEADLINE = 30;
    uint256 internal constant PROD_MAX_DEADLINE = 7 days;
    uint256 internal constant PROD_EXEC_DELAY = 48 hours;

    function test_SwapRouterConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(SwapRouter.ZeroAddress.selector);
        new SwapRouter(address(0), PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY);
    }

    function test_SwapRouterRevertsOnZeroMinDeadline() public {
        vm.expectRevert(SwapRouter.DeadlineTooShort.selector);
        new SwapRouter(address(0xCAFE), 0, PROD_MAX_DEADLINE, PROD_EXEC_DELAY);
    }

    function test_SwapRouterRevertsOnInvalidMaxLessThanMin() public {
        vm.expectRevert(SwapRouter.DeadlineTooLong.selector);
        new SwapRouter(address(0xCAFE), 100, 50, PROD_EXEC_DELAY);
    }

    function test_SwapRouterStoresExecutor() public {
        address fakeExecutor = address(0xCAFE);
        SwapRouter router = new SwapRouter(
            fakeExecutor, PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY
        );
        assertEq(router.executor(), fakeExecutor);
        assertEq(router.OWNER(), address(this));
    }

    function test_SwapRouterRejectsSameTokenIntent() public {
        SwapRouter router = new SwapRouter(
            address(0xCAFE), PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY
        );



        assertEq(router.executor(), address(0xCAFE));
    }

    function test_SwapRouterDeadlineImmutablesAreSane() public {
        SwapRouter router = new SwapRouter(
            address(0xCAFE), PROD_MIN_DEADLINE, PROD_MAX_DEADLINE, PROD_EXEC_DELAY
        );
        assertEq(router.MIN_DEADLINE_OFFSET(), PROD_MIN_DEADLINE);
        assertEq(router.MAX_DEADLINE_OFFSET(), PROD_MAX_DEADLINE);
        assertEq(router.EXECUTOR_ROTATION_DELAY(), PROD_EXEC_DELAY);
    }

    function test_SwapRouterAcceptsDemoTimings() public {

        SwapRouter router = new SwapRouter(address(0xCAFE), 5, 300, 90);
        assertEq(router.MIN_DEADLINE_OFFSET(), 5);
        assertEq(router.MAX_DEADLINE_OFFSET(), 300);
        assertEq(router.EXECUTOR_ROTATION_DELAY(), 90);
    }
}
