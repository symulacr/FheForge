// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "../contracts/MockERC20.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";
import {ExecutorContract} from "../contracts/ExecutorContract.sol";

/// @notice Shared test utilities for Foundry tests (MC-077).
///         Provides standard test constants and deployment helpers.
library TestHelper {
    uint256 public constant MIN_DEADLINE = 30;
    uint256 public constant MAX_DEADLINE = 7 days;
    uint256 public constant EXEC_DELAY = 48 hours;
    address public constant UNISWAP_ROUTER = address(0x1);
    address public constant PYTH_MOCK = address(0x2);
    uint256 public constant DEFAULT_STALE_THRESHOLD = 3600;
    uint256 public constant DEFAULT_SUPPLY = 10000 ether;

    /// @notice Deploy standard SwapRouter + ExecutorContract + mock tokens.
    function deploySwapStack()
        internal
        returns (
            address owner,
            address executor,
            SwapRouter router,
            ExecutorContract executorContract,
            MockERC20 tokenIn,
            MockERC20 tokenOut
        )
    {
        owner = address(this);
        executor = address(0xCAFE);

        tokenIn = new MockERC20("TokenIn", "TIN", 18);
        tokenOut = new MockERC20("TokenOut", "TOUT", 18);
        executorContract = new ExecutorContract();
        router = new SwapRouter(executor, MIN_DEADLINE, MAX_DEADLINE, EXEC_DELAY, UNISWAP_ROUTER);

        tokenIn.mint(executor, DEFAULT_SUPPLY);
        tokenOut.mint(executor, DEFAULT_SUPPLY);
    }

    /// @dev Compute the OwnableUnauthorizedAccount selector for a given caller.
    function ownableRevertData(address caller) internal pure returns (bytes memory revertData) {
        return abi.encodeWithSelector(bytes4(0x118cdaa7), caller);
    }
}
