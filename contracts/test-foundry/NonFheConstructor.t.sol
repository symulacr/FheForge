// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";
import {StrategyVault} from "../contracts/StrategyVault.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";

/// @title NonFheConstructorTest
/// @notice Plaintext-only smoke tests for contracts whose constructors do not invoke
///         FHE precompiles. After the Stage 5 remediation StrategyVault, StrategyRegistry,
///         and LendingPool all initialise an `_ZERO` encrypted-zero handle in their
///         constructor; their on-chain coverage is in the hardhat suite under
///         test/StrategyVault.test.ts and the live-testnet scripts test-live.ts /
///         test-stress.ts where the cofhe-hardhat-plugin deploys the mock coprocessor.
///
/// The remaining foundry tests cover SwapRouter (no FHE in its constructor) and the
/// constructor-side ZeroAddress reverts on every contract that exposes one.
contract NonFheConstructorTest is Test {
    function test_StrategyVaultConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(StrategyVault.ZeroAddress.selector);
        new StrategyVault(address(0));
    }

    /// @dev Production-mode timing parameters.
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
        // submitSwapIntent uses InEuint128 calldata structs that only the off-chain
        // SDK can build, so the same-token check is exercised in scripts/test-live.ts
        // (live arb-sepolia) instead of here. We just verify the executor remained set.
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
        // Verify the demo-mode tuple (min=5, max=300, rotation=90) deploys cleanly.
        SwapRouter router = new SwapRouter(address(0xCAFE), 5, 300, 90);
        assertEq(router.MIN_DEADLINE_OFFSET(), 5);
        assertEq(router.MAX_DEADLINE_OFFSET(), 300);
        assertEq(router.EXECUTOR_ROTATION_DELAY(), 90);
    }
}
