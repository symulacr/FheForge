// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "./MockERC20.sol";

/// @title FaucetMockERC20 — MockERC20 with public faucet mint for testnets
/// @notice Extends MockERC20 with rate-limited public minting for testnet use.
///         Owner minting is inherited from MockERC20.mint() (onlyOwner).
///         ERC20 functionality (transfer, approve, transferFrom, balanceOf, etc.)
///         is fully inherited from OpenZeppelin ERC20 via MockERC20.
contract FaucetMockERC20 is MockERC20 {
    /// @notice Maximum tokens dispensed per faucet drip (10,000 tokens).
    uint256 public constant FAUCET_AMOUNT = 10_000 * 1e18;

    /// @notice Minimum time between faucet calls per address.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Tracks the last faucet timestamp for each address.
    mapping(address => uint256) public lastFaucet;

    /// @param name_   ERC20 token name
    /// @param symbol_ ERC20 token symbol
    /// @param decimals_ Number of decimals (6 for USDC-like, 18 for standard)
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) MockERC20(name_, symbol_, decimals_) {}

    /// @notice Mint test tokens to the caller. One drip per address per cooldown window.
    ///         Amount is 10,000 tokens adjusted for the token's decimals.
    function faucetMint() external {
        require(
            block.timestamp >= lastFaucet[msg.sender] + FAUCET_COOLDOWN,
            "Faucet: cooldown"
        );
        lastFaucet[msg.sender] = block.timestamp;
        uint256 amount = decimals() == 6 ? 10_000 * 1e6 : FAUCET_AMOUNT;
        _mint(msg.sender, amount);
    }

    /// @notice Mint test tokens to a specific address. One drip per recipient per cooldown window.
    /// @param to Recipient address
    function faucetMintTo(address to) external {
        require(to != address(0), "Faucet: zero address");
        require(
            block.timestamp >= lastFaucet[to] + FAUCET_COOLDOWN,
            "Faucet: cooldown"
        );
        lastFaucet[to] = block.timestamp;
        uint256 amount = decimals() == 6 ? 10_000 * 1e6 : FAUCET_AMOUNT;
        _mint(to, amount);
    }
}
