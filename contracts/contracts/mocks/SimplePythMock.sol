// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Minimal IPyth mock for testing PriceOracle without vm.mockCall.
///         Supports direct price setting via setPrice() for test scenarios.
contract SimplePythMock is IPyth {
    error NotImplemented();

    uint256 public singleUpdateFeeInWei;
    mapping(bytes32 => PythStructs.Price) public prices;

    constructor(uint256 _singleUpdateFeeInWei) {
        singleUpdateFeeInWei = _singleUpdateFeeInWei;
    }

    /// @notice Set a price for a given price feed ID directly (no encoding needed).
    function setPrice(bytes32 id, PythStructs.Price calldata price) external {
        prices[id] = price;
    }

    function getPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory price) {
        return prices[id];
    }

    function getPriceNoOlderThan(
        bytes32 id,
        uint256
    ) external view returns (PythStructs.Price memory price) {
        return prices[id];
    }

    function getEmaPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory price) {
        return prices[id];
    }

    function getEmaPriceNoOlderThan(
        bytes32 id,
        uint256
    ) external view returns (PythStructs.Price memory price) {
        return prices[id];
    }

    function getUpdateFee(bytes[] calldata) external view returns (uint256 feeAmount) {
        return singleUpdateFeeInWei;
    }

    function getTwapUpdateFee(bytes[] calldata) external view returns (uint256 feeAmount) {
        return singleUpdateFeeInWei;
    }

    function updatePriceFeeds(bytes[] calldata) external payable {
        return;
    }

    function updatePriceFeedsIfNecessary(
        bytes[] calldata,
        bytes32[] calldata,
        uint64[] calldata
    ) external payable {
        return;
    }

    function parsePriceFeedUpdates(
        bytes[] calldata,
        bytes32[] calldata,
        uint64,
        uint64
    ) external payable returns (PythStructs.PriceFeed[] memory) {
        revert NotImplemented();
    }

    function parsePriceFeedUpdatesWithConfig(
        bytes[] calldata,
        bytes32[] calldata,
        uint64,
        uint64,
        bool,
        bool,
        bool
    ) external payable returns (PythStructs.PriceFeed[] memory, uint64[] memory) {
        revert NotImplemented();
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata,
        bytes32[] calldata,
        uint64,
        uint64
    ) external payable returns (PythStructs.PriceFeed[] memory) {
        revert NotImplemented();
    }

    function parseTwapPriceFeedUpdates(
        bytes[] calldata,
        bytes32[] calldata
    ) external payable returns (PythStructs.TwapPriceFeed[] memory) {
        revert NotImplemented();
    }

    // These are required by IPyth but not called by PriceOracle.
    function priceFeedExists(bytes32) external pure returns (bool exists) {
        return true;
    }

    function queryPriceFeed(bytes32) external pure returns (PythStructs.PriceFeed memory) {
        revert NotImplemented();
    }

    function getValidTimePeriod() external pure returns (uint256 period) {
        return 0;
    }
}
