// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import { FheForgeBase } from "./FheForgeBase.sol";

contract PriceOracle is FheForgeBase {
    using SafeCast for int256;
    using SafeCast for uint256;

    uint8 public constant WAD_DECIMALS = 18;
    int256 public constant MAX_PYTH_EXP = 38;

    uint256 public immutable DEFAULT_STALE_THRESHOLD;
    IPyth public immutable PYTH;

    mapping(address => bytes32) public priceId;
    mapping(address => uint64) public staleThreshold;
    mapping(address => uint8) public tokenDecimals;
    mapping(address => uint16) public collateralFactorBps;
    mapping(address => uint16) public liquidationThresholdBps;

    mapping(address => uint256) private fallbackPrices;
    mapping(address => bool) private hasFallback;
    uint256 public stalenessThreshold = 1 hours;
    mapping(address => uint256) public lastPriceUpdate;

    address[] public registeredTokens;
    mapping(address => bool) public isTokenRegistered;

    error NoPriceFeed();
    error NegativePrice();
    error InvalidBps();
    error PythUpdateFeeMismatch();
    error UncertainPrice();
    error ZeroPrice();
    error NoPriceAvailable();

    event SourceSet(
        address indexed token,
        bytes32 indexed priceId,
        uint8 indexed tokenDecimals,
        uint64 staleThreshold
    );
    event CollateralFactorSet(
        address indexed token,
        uint16 indexed ltvBps,
        uint16 indexed liqThresholdBps
    );
    event PythCacheUpdated(address indexed caller, uint256 indexed feePaid);
    event FallbackPriceSet(address indexed token, uint256 indexed price);
    event FallbackPriceRemoved(address indexed token);
    event StalenessThresholdUpdated(uint256 indexed oldThreshold, uint256 indexed newThreshold);
    event SourcesBatchSet(uint256 indexed count);

    constructor(address pyth_, uint256 defaultStaleThreshold_) FheForgeBase() {
        if (pyth_ == address(0)) revert ZeroAddress();
        PYTH = IPyth(pyth_);
        DEFAULT_STALE_THRESHOLD = defaultStaleThreshold_;
    }

    /// @notice Set the Pyth price feed source for a given token.
    /// @param token The token address to configure.
    /// @param priceId_ The Pyth price feed ID for this token.
    /// @param decimals_ The number of decimals for the token.
    /// @param threshold_ The staleness threshold (seconds) before the feed is considered stale.
    function setSource(
        address token,
        bytes32 priceId_,
        uint8 decimals_,
        uint64 threshold_
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (decimals_ == 0) revert ZeroAmount();
        priceId[token] = priceId_;
        tokenDecimals[token] = decimals_;
        staleThreshold[token] = threshold_;
        if (!isTokenRegistered[token]) {
            isTokenRegistered[token] = true;
            registeredTokens.push(token);
        }
        emit SourceSet(token, priceId_, decimals_, threshold_);
    }

    /// @notice Remove a Pyth price feed source for a given token.
    /// @param token The token address to remove.
    function removeSource(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        delete priceId[token];
        delete staleThreshold[token];
        emit SourceSet(token, bytes32(0), 0, 0);
    }

    struct FeedInfo {
        address token;
        uint64 staleThreshold;
        uint8 decimals;
        bytes32 priceId;
    }

    /// @notice Batch-configure Pyth price feeds for multiple tokens at once.
    /// @param feeds Array of FeedInfo structs with token, priceId, decimals, and staleThreshold.
    function batchSetSources(FeedInfo[] calldata feeds) external onlyOwner {
        uint256 feedsLen = feeds.length;
        for (uint256 i = 0; i < feedsLen; ) {
            FeedInfo calldata feed = feeds[i];
            if (feed.token == address(0)) revert ZeroAddress();
            if (feed.decimals == 0) revert ZeroAmount();
            priceId[feed.token] = feed.priceId;
            tokenDecimals[feed.token] = feed.decimals;
            staleThreshold[feed.token] = feed.staleThreshold;
            if (!isTokenRegistered[feed.token]) {
                isTokenRegistered[feed.token] = true;
                registeredTokens.push(feed.token);
            }
            emit SourceSet(feed.token, feed.priceId, feed.decimals, feed.staleThreshold);
            unchecked {
                ++i;
            }
        }
        emit SourcesBatchSet(feeds.length);
    }

    /// @notice Set collateral and liquidation factors (in basis points) for a token.
    /// @param token The token address.
    /// @param ltvBps Loan-to-value basis points (e.g. 7500 = 75%).
    /// @param liqThresholdBps Liquidation threshold basis points (e.g. 8000 = 80%).
    function setCollateralFactor(
        address token,
        uint16 ltvBps,
        uint16 liqThresholdBps
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (ltvBps > BPS_DEN) revert InvalidBps();
        if (liqThresholdBps > BPS_DEN) revert InvalidBps();
        if (ltvBps > liqThresholdBps) revert InvalidBps();
        collateralFactorBps[token] = ltvBps;
        liquidationThresholdBps[token] = liqThresholdBps;
        emit CollateralFactorSet(token, ltvBps, liqThresholdBps);
    }

    /// @notice Update Pyth price feeds with fresh oracle data.
    /// @param updateData Encoded Pyth price update data.
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 fee = PYTH.getUpdateFee(updateData);
        if (msg.value != fee) revert PythUpdateFeeMismatch();
        PYTH.updatePriceFeeds{ value: fee }(updateData);

        uint256 timestamp = block.timestamp;
        uint256 regLen = registeredTokens.length;
        for (uint256 i = 0; i < regLen; ) {
            address token = registeredTokens[i];
            lastPriceUpdate[token] = timestamp;
            unchecked {
                ++i;
            }
        }

        emit PythCacheUpdated(msg.sender, fee);
    }

    /// @notice Get the fee required to update Pyth price feeds.
    /// @param updateData Encoded Pyth price update data.
    /// @return feeAmount The required fee in wei.
    function getPythUpdateFee(
        bytes[] calldata updateData
    ) external view returns (uint256 feeAmount) {
        return PYTH.getUpdateFee(updateData);
    }

    function getPriceUsd(address token) public view returns (uint256 priceWad, uint64 updatedAt) {
        bytes32 id = priceId[token];
        if (id == bytes32(0)) revert NoPriceFeed();

        uint256 threshold = staleThreshold[token];
        if (threshold == 0) threshold = DEFAULT_STALE_THRESHOLD;

        PythStructs.Price memory p = PYTH.getPriceNoOlderThan(id, threshold);

        if (p.price == 0) revert ZeroPrice();
        if (p.price < 0) revert NegativePrice();
        uint256 absAnswer = int256(p.price).toUint256();

        if (p.conf < 1) revert UncertainPrice();
        if (uint256(p.conf) * BPS_DEN > absAnswer * 100) revert UncertainPrice();

        int256 totalExpInt = int256(uint256(WAD_DECIMALS)) + int256(p.expo);
        if (totalExpInt > MAX_PYTH_EXP || totalExpInt < -MAX_PYTH_EXP) revert NegativePrice();
        if (totalExpInt > -1) {
            priceWad = absAnswer * (10 ** totalExpInt.toUint256());
        } else {
            uint256 divisor = 10 ** (-totalExpInt).toUint256();
            priceWad = (absAnswer + divisor - 1) / divisor;
        }

        updatedAt = p.publishTime.toUint64();
    }

    /// @notice Check if a token's price feed is stale.
    /// @param token The token address to check.
    /// @return stale True if the feed is stale or not registered.
    function isStale(address token) external view returns (bool stale) {
        if (priceId[token] == bytes32(0)) return true;

        bytes32 id = priceId[token];
        PythStructs.Price memory p = PYTH.getPriceUnsafe(id);

        uint256 age;
        if (p.publishTime == 0) {
            if (lastPriceUpdate[token] == 0) return true;
            age = block.timestamp - lastPriceUpdate[token];
        } else {
            age = block.timestamp - uint256(p.publishTime);
        }

        return age > stalenessThreshold;
    }

    function getPriceWithFallback(address token) public view returns (uint256 priceWad) {
        bytes32 id = priceId[token];

        // If no Pyth feed registered, try fallback immediately
        if (id == bytes32(0)) {
            if (hasFallback[token]) return fallbackPrices[token];
            revert NoPriceFeed();
        }

        // Check staleness using Pyth's publishTime or lastPriceUpdate
        bool stale = _isPythStale(id, token);

        if (!stale) {
            uint256 threshold = staleThreshold[token];
            if (threshold == 0) threshold = DEFAULT_STALE_THRESHOLD;
            priceWad = _tryGetPrice(id, threshold);
            if (priceWad != 0) return priceWad;
        }

        // Stale or Pyth call failed — try fallback
        if (hasFallback[token]) {
            return fallbackPrices[token];
        }

        revert NoPriceAvailable();
    }

    function _isPythStale(bytes32 id, address token) internal view returns (bool stale) {
        PythStructs.Price memory p = PYTH.getPriceUnsafe(id);

        uint256 age;
        if (p.publishTime == 0) {
            if (lastPriceUpdate[token] == 0) return true;
            age = block.timestamp - lastPriceUpdate[token];
        } else {
            age = block.timestamp - uint256(p.publishTime);
        }

        return age > stalenessThreshold;
    }

    /// @dev Try to get a fresh Pyth price; returns 0 if Pyth call fails (triggers fallback path).
    function _tryGetPrice(bytes32 id, uint256 threshold) private view returns (uint256 priceWad) {
        try PYTH.getPriceNoOlderThan(id, threshold) returns (PythStructs.Price memory p) {
            priceWad = _normalizePythPrice(p);
        } catch {
            return 0;
        }
    }

    function _normalizePythPrice(
        PythStructs.Price memory p
    ) internal pure returns (uint256 priceWad) {
        if (p.price == 0) revert ZeroPrice();
        if (p.price < 0) revert NegativePrice();
        uint256 absAnswer = int256(p.price).toUint256();

        if (p.conf < 1) revert UncertainPrice();
        if (uint256(p.conf) * BPS_DEN > absAnswer * 100) revert UncertainPrice();

        int256 totalExpInt = int256(uint256(WAD_DECIMALS)) + int256(p.expo);
        if (totalExpInt > MAX_PYTH_EXP || totalExpInt < -MAX_PYTH_EXP) revert NegativePrice();
        if (totalExpInt > -1) {
            priceWad = absAnswer * (10 ** totalExpInt.toUint256());
        } else {
            uint256 divisor = 10 ** (-totalExpInt).toUint256();
            priceWad = (absAnswer + divisor - 1) / divisor;
        }
    }

    /// @notice Set a fallback price for a token when Pyth is unavailable.
    /// @param token The token address.
    /// @param price The fallback price in 18-decimal WAD format.
    function setFallbackPrice(address token, uint256 price) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroAmount();
        fallbackPrices[token] = price;
        hasFallback[token] = true;
        emit FallbackPriceSet(token, price);
    }

    /// @notice Remove a fallback price for a token.
    /// @param token The token address.
    function removeFallbackPrice(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        delete fallbackPrices[token];
        delete hasFallback[token];
        emit FallbackPriceRemoved(token);
    }

    /// @notice Set the global staleness threshold for all Pyth price feeds.
    /// @param newThreshold New staleness duration in seconds.
    function setStalenessThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert ZeroAmount();
        uint256 old = stalenessThreshold;
        stalenessThreshold = newThreshold;
        emit StalenessThresholdUpdated(old, newThreshold);
    }

    /// @notice Convert a token amount to its USD value at current prices.
    /// @param token The token address.
    /// @param amount The token amount (in token's own decimals).
    /// @return usdWad The USD value in 18-decimal WAD format.
    function convertToUsd(address token, uint256 amount) external view returns (uint256 usdWad) {
        uint256 priceWad = getPriceWithFallback(token);
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = WAD_DECIMALS;
        usdWad = (amount * priceWad) / (10 ** dec);
    }

    /// @notice Convert a USD value to a token amount at current prices.
    /// @param token The token address.
    /// @param usdWad The USD value in 18-decimal WAD format.
    /// @return amount The token amount (in token's own decimals).
    function convertFromUsd(address token, uint256 usdWad) external view returns (uint256 amount) {
        uint256 priceWad = getPriceWithFallback(token);
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = WAD_DECIMALS;
        amount = (usdWad * (10 ** dec)) / priceWad;
    }

    /// @notice Check if a token has a price feed configured.
    /// @param token The token address.
    /// @return supported True if the token has a price feed.
    function isSupported(address token) external view returns (bool supported) {
        return priceId[token] != bytes32(0);
    }

    /// @notice Sweep accumulated ETH from oracle update fees to a recipient.
    /// @param to The recipient address.
    function sweepEth(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        if (bal < 1) return;
        (bool ok, ) = to.call{ value: bal }("");
        if (!ok) revert EthTransferFailed();
    }
}
