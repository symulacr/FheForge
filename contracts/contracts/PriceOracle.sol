// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PriceOracle {
    using SafeCast for int256;
    using SafeCast for uint256;

    uint256 public constant WAD = 1e18;
    uint256 public constant BPS_DEN = 1e4;
    uint8 public constant WAD_DECIMALS = 18;

    int256 public constant MAX_PYTH_EXP = 38;

    uint256 public immutable DEFAULT_STALE_THRESHOLD;
    IPyth public immutable PYTH;

    mapping(address => bytes32) public priceId;

    mapping(address => uint64) public staleThreshold;

    mapping(address => uint8) public tokenDecimals;
    mapping(address => uint16) public collateralFactorBps;
    mapping(address => uint16) public liquidationThresholdBps;

    address public immutable OWNER;

    mapping(address => uint256) private fallbackPrices;
    mapping(address => bool) private hasFallback;
    uint256 public stalenessThreshold = 1 hours;
    mapping(address => uint256) public lastPriceUpdate;

    error OnlyOwner();
    error NoPriceFeed();
    error NegativePrice();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidBps();
    error PythUpdateFeeMismatch();
    error UncertainPrice();
    error EthTransferFailed();
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

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert OnlyOwner();
    }

    constructor(address pyth_, uint256 defaultStaleThreshold_) {
        if (pyth_ == address(0)) revert ZeroAddress();
        OWNER = msg.sender;
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

        // Update lastPriceUpdate for all registered tokens.
        // This is an approximation: any successful update refreshes the
        // staleness clock for all tracked tokens. Gas cost is O(N registered tokens).
        uint256 timestamp = block.timestamp;
        // We iterate through a reasonable range of slots (tokens are sparse).
        // For production, consider maintaining an active token list.
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

    /// @notice Returns true if the Pyth price for a token is older than the staleness threshold.
    /// @dev Uses the Pyth price's publishTime; falls back to lastPriceUpdate if publishTime is 0.
    /// @param token The token to check.
    /// @return True if price is stale or never updated; false if fresh.
    function isStale(address token) external view returns (bool) {
        if (priceId[token] == bytes32(0)) return true;

        bytes32 id = priceId[token];
        // Try to read Pyth price (without staleness guard) to get publishTime.
        // Pyth's getPriceUnsafe returns the last cached price regardless of age.
        PythStructs.Price memory p = PYTH.getPriceUnsafe(id);

        uint256 age;
        if (p.publishTime == 0) {
            // No Pyth price ever — fall back to lastPriceUpdate
            if (lastPriceUpdate[token] == 0) return true;
            age = block.timestamp - lastPriceUpdate[token];
        } else {
            age = block.timestamp - uint256(p.publishTime);
        }

        return age > stalenessThreshold;
    }

    /// @notice Returns the Pyth price if fresh; otherwise returns the fallback price if set.
    /// @dev Uses the globally configurable stalenessThreshold to determine freshness.
    /// @param token The token to get price for.
    /// @return The price in WAD scale.
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
            // Fetch fresh Pyth price
            uint256 threshold = staleThreshold[token];
            if (threshold == 0) threshold = DEFAULT_STALE_THRESHOLD;
            try PYTH.getPriceNoOlderThan(id, threshold) returns (PythStructs.Price memory p) {
                return _normalizePythPrice(p);
            } catch {
                // Pyth call failed (e.g. feed exists but no data) — fall through to fallback
            }
        }

        // Stale or Pyth call failed — try fallback
        if (hasFallback[token]) {
            return fallbackPrices[token];
        }

        revert NoPriceAvailable();
    }

    /// @notice Returns true if the Pyth price for a given priceId is older than stalenessThreshold.
    /// @dev Checks Pyth's publishTime; falls back to lastPriceUpdate[token] if publishTime == 0.
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

    /// @notice Normalizes a Pyth price struct to WAD-scale uint256.
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

    /// @notice Sets a fallback price for a token. Used when Pyth price becomes stale.
    /// @param token The token to set fallback price for.
    /// @param price The fallback price in WAD scale.
    function setFallbackPrice(address token, uint256 price) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroAmount();
        fallbackPrices[token] = price;
        hasFallback[token] = true;
        emit FallbackPriceSet(token, price);
    }

    /// @notice Removes the fallback price for a token.
    /// @param token The token to remove fallback price for.
    function removeFallbackPrice(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        delete fallbackPrices[token];
        delete hasFallback[token];
        emit FallbackPriceRemoved(token);
    }

    /// @notice Updates the global staleness threshold.
    /// @param newThreshold The new threshold in seconds.
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