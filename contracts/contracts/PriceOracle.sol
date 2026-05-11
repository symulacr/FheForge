// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

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
    event FallbackPriceSet(address indexed token, uint256 price);
    event FallbackPriceRemoved(address indexed token);
    event StalenessThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    constructor(address pyth_, uint256 defaultStaleThreshold_) FheForgeBase() {
        if (pyth_ == address(0)) revert ZeroAddress();
        PYTH = IPyth(pyth_);
        DEFAULT_STALE_THRESHOLD = defaultStaleThreshold_;
    }

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
        emit SourceSet(token, priceId_, decimals_, threshold_);
    }

    function removeSource(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        delete priceId[token];
        delete staleThreshold[token];
        emit SourceSet(token, bytes32(0), 0, 0);
    }

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

    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 fee = PYTH.getUpdateFee(updateData);
        if (msg.value != fee) revert PythUpdateFeeMismatch();
        PYTH.updatePriceFeeds{ value: fee }(updateData);

        uint256 timestamp = block.timestamp;
        for (uint i = 0; i < 256; i++) {
            address token = address(uint160(i));
            if (priceId[token] != bytes32(0)) {
                lastPriceUpdate[token] = timestamp;
            }
        }

        emit PythCacheUpdated(msg.sender, fee);
    }

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
            priceWad = absAnswer / (10 ** (-totalExpInt).toUint256());
        }

        updatedAt = p.publishTime.toUint64();
    }

    function isStale(address token) external view returns (bool) {
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

    function getPriceWithFallback(address token) public view returns (uint256) {
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
            try PYTH.getPriceNoOlderThan(id, threshold) returns (PythStructs.Price memory p) {
                return _normalizePythPrice(p);
            } catch {
                // Pyth call failed — fall through to fallback
            }
        }

        // Stale or Pyth call failed — try fallback
        if (hasFallback[token]) {
            return fallbackPrices[token];
        }

        revert NoPriceAvailable();
    }

    function _isPythStale(bytes32 id, address token) internal view returns (bool) {
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

    function _normalizePythPrice(PythStructs.Price memory p) internal pure returns (uint256 priceWad) {
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
            priceWad = absAnswer / (10 ** (-totalExpInt).toUint256());
        }
    }

    function setFallbackPrice(address token, uint256 price) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroAmount();
        fallbackPrices[token] = price;
        hasFallback[token] = true;
        emit FallbackPriceSet(token, price);
    }

    function removeFallbackPrice(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        delete fallbackPrices[token];
        delete hasFallback[token];
        emit FallbackPriceRemoved(token);
    }

    function setStalenessThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert ZeroAmount();
        uint256 old = stalenessThreshold;
        stalenessThreshold = newThreshold;
        emit StalenessThresholdUpdated(old, newThreshold);
    }

    function convertToUsd(address token, uint256 amount) external view returns (uint256 usdWad) {
        uint256 priceWad = getPriceWithFallback(token);
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = WAD_DECIMALS;
        usdWad = (amount * priceWad) / (10 ** dec);
    }

    function convertFromUsd(address token, uint256 usdWad) external view returns (uint256 amount) {
        uint256 priceWad = getPriceWithFallback(token);
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = WAD_DECIMALS;
        amount = (usdWad * (10 ** dec)) / priceWad;
    }

    function isSupported(address token) external view returns (bool) {
        return priceId[token] != bytes32(0);
    }

    function sweepEth(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        if (bal < 1) return;
        (bool ok, ) = to.call{ value: bal }("");
        if (!ok) revert EthTransferFailed();
    }
}
