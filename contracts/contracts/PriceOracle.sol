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

    function convertToUsd(address token, uint256 amount) external view returns (uint256 usdWad) {
        (uint256 priceWad, ) = getPriceUsd(token);
        uint8 dec = tokenDecimals[token];
        if (dec == 0) dec = WAD_DECIMALS;
        usdWad = (amount * priceWad) / (10 ** dec);
    }

    function convertFromUsd(address token, uint256 usdWad) external view returns (uint256 amount) {
        (uint256 priceWad, ) = getPriceUsd(token);
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
