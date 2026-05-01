// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

error MainnetForbidden();

/// @title  MockERC20
/// @notice Test-only ERC-20 with unrestricted public minting. Do not deploy
///         to production.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MCK") {
        if (block.chainid == 1 || block.chainid == 42161) revert MainnetForbidden();
        _mint(msg.sender, 1e24);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
