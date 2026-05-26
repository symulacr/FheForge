// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC3156FlashBorrower } from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

/// @notice Minimal ERC-3156 flash loan receiver for testing.
contract FlashLoanReceiver is IERC3156FlashBorrower {
    address public pool;
    address public token;

    constructor(address pool_, address token_) {
        pool = pool_;
        token = token_;
    }

    function onFlashLoan(
        address,
        address flashToken,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external returns (bytes32 flashResult) {
        IERC20(flashToken).approve(pool, amount + fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}
