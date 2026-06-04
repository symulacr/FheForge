// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FheForgeBase } from "./FheForgeBase.sol";

contract TokenRegistry is FheForgeBase {
    struct TokenInfo {
        address token;
        uint16 ltvBps;
        uint16 liquidationBonusBps;
        uint8 decimals;
        bool isLendable;
        bool isBorrowable;
        bool isCollateral;
        bool enabled;
        bytes32 pythPriceId;
        uint256 borrowCap;
        uint256 supplyCap;
    }

    mapping(address => TokenInfo) public tokens;
    mapping(address => bool) public isRegistered;
    address[] public tokenList;

    event TokenRegistered(address indexed token, bytes32 indexed priceId, uint8 indexed decimals);
    event TokenUpdated(address indexed token);
    event TokenDisabled(address indexed token);
    error TokenNotRegistered();

    /// @param info TokenInfo struct with token address, price ID, flags, caps, and LTV.
    function registerToken(TokenInfo calldata info) external onlyOwner {
        if (info.token == address(0)) revert ZeroAddress();
        tokens[info.token] = info;
        if (!isRegistered[info.token]) {
            isRegistered[info.token] = true;
            tokenList.push(info.token);
            emit TokenRegistered(info.token, info.pythPriceId, info.decimals);
        } else {
            emit TokenUpdated(info.token);
        }
    }

    /// @notice Remove a token from the registry (swap-and-pop from tokenList).
    /// @param token The token address to remove.
    function removeToken(address token) external onlyOwner {
        if (!isRegistered[token]) revert TokenNotRegistered();
        delete tokens[token];
        isRegistered[token] = false;
        // swap-and-pop
        uint256 len = tokenList.length;
        for (uint256 i = 0; i < len; ) {
            if (tokenList[i] == token) {
                tokenList[i] = tokenList[len - 1];
                tokenList.pop();
                break;
            }
            unchecked {
                ++i;
            }
        }
        emit TokenDisabled(token);
    }

    /// @param info The new TokenInfo configuration.
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

    function getTokenCount() external view returns (uint256 count) {
        return tokenList.length;
    }

    enum TokenFilterType {
        Lendable,
        Borrowable,
        Collateral
    }

    function getLendableTokens() external view returns (address[] memory result) {
        return _getTokensByFilter(TokenFilterType.Lendable);
    }

    function getBorrowableTokens() external view returns (address[] memory result) {
        return _getTokensByFilter(TokenFilterType.Borrowable);
    }

    function getCollateralTokens() external view returns (address[] memory result) {
        return _getTokensByFilter(TokenFilterType.Collateral);
    }

    function _getTokensByFilter(
        TokenFilterType filterType
    ) private view returns (address[] memory result) {
        uint256 count;
        uint256 tokenLen = tokenList.length;
        for (uint256 i = 0; i < tokenLen; ) {
            if (_matchesFilter(tokenList[i], filterType)) ++count;
            unchecked {
                ++i;
            }
        }
        result = new address[](count);
        uint256 idx;
        uint256 tokenLen2 = tokenList.length;
        for (uint256 i = 0; i < tokenLen2; ) {
            if (_matchesFilter(tokenList[i], filterType)) {
                result[idx] = tokenList[i];
                unchecked {
                    ++idx;
                }
            }
            unchecked {
                ++i;
            }
        }
        return result;
    }

    function _matchesFilter(
        address tokenAddr,
        TokenFilterType filterType
    ) private view returns (bool matches) {
        TokenInfo storage info = tokens[tokenAddr];
        if (!info.enabled) return false;
        if (filterType == TokenFilterType.Lendable) return info.isLendable;
        if (filterType == TokenFilterType.Borrowable) return info.isBorrowable;
        if (filterType == TokenFilterType.Collateral) return info.isCollateral;
        return false;
    }

    function isTokenEnabled(address token) external view returns (bool enabled) {
        return tokens[token].enabled;
    }
}
