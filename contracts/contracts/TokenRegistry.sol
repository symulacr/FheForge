// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FheForgeBase } from "./FheForgeBase.sol";

contract TokenRegistry is FheForgeBase {
    struct TokenInfo {
        address token;
        bytes32 pythPriceId;
        uint8 decimals;
        bool isLendable;
        bool isBorrowable;
        bool isCollateral;
        uint16 ltvBps;
        uint16 liquidationBonusBps;
        uint256 borrowCap;
        uint256 supplyCap;
        bool enabled;
    }

    mapping(address => TokenInfo) public tokens;
    address[] public tokenList;

    event TokenRegistered(address indexed token, bytes32 indexed priceId, uint8 decimals);
    event TokenUpdated(address indexed token);
    event TokenDisabled(address indexed token);

    function registerToken(TokenInfo calldata info) external onlyOwner {
        if (info.token == address(0)) revert ZeroAddress();
        TokenInfo memory m = info;
        tokens[info.token] = m;
        bool found;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokenList[i] == info.token) { found = true; break; }
        }
        if (!found) tokenList.push(info.token);
        emit TokenRegistered(info.token, info.pythPriceId, info.decimals);
    }

    function updateTokenConfig(address token, TokenInfo calldata info) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        TokenInfo memory m = info;
        m.token = token;
        tokens[token] = m;
        emit TokenUpdated(token);
    }

    function disableToken(address token) external onlyOwner {
        tokens[token].enabled = false;
        emit TokenDisabled(token);
    }

    function getTokenCount() external view returns (uint256) {
        return tokenList.length;
    }

    function getLendableTokens() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isLendable && tokens[tokenList[i]].enabled) count++;
        }
        address[] memory result = new address[](count);
        uint256 idx;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isLendable && tokens[tokenList[i]].enabled) {
                result[idx++] = tokenList[i];
            }
        }
        return result;
    }

    function getBorrowableTokens() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isBorrowable && tokens[tokenList[i]].enabled) count++;
        }
        address[] memory result = new address[](count);
        uint256 idx;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isBorrowable && tokens[tokenList[i]].enabled) {
                result[idx++] = tokenList[i];
            }
        }
        return result;
    }

    function getCollateralTokens() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isCollateral && tokens[tokenList[i]].enabled) count++;
        }
        address[] memory result = new address[](count);
        uint256 idx;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isCollateral && tokens[tokenList[i]].enabled) {
                result[idx++] = tokenList[i];
            }
        }
        return result;
    }

    function isTokenEnabled(address token) external view returns (bool) {
        return tokens[token].enabled;
    }
}