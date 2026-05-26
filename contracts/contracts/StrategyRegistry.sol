// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { TimelockedRotation } from "./libraries/TimelockedRotation.sol";

contract StrategyRegistry is IStrategyRegistry, FheForgeBase, TimelockedRotation {
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 256;

    struct Strategy {
        bytes32 workflowHash;
        uint64 createdAt;
        uint16 apyTarget;
        bool active;
        uint8 loopCount;
        address creator;
        string name;
    }

    error OnlyVault();
    error OnlyCreator();
    error InvalidStrategyId();
    error VaultAlreadySet();
    error FhePermissionDenied();
    error EmptyName();
    error NameTooLong();
    error ZeroWorkflowHash();
    error StrategyAlreadyExists();
    error StrategyInactive();

    mapping(uint256 => Strategy) private strategies;
    mapping(uint256 => euint128) private encryptedTvls;

    mapping(bytes32 => uint256) public idByContentHash;
    uint256 public strategyCount;

    address public vaultAddress;

    event StrategyRegistered(uint256 indexed id, address indexed creator, string name);
    event StrategyActiveSet(uint256 indexed id, bool indexed active);
    event VaultSet(address indexed vault);
    event VaultProposed(address indexed newVault, uint256 indexed earliest);
    event TvlIncreased(uint256 indexed strategyId, address indexed caller);
    event TvlDecreased(uint256 indexed strategyId, address indexed caller);
    event CrossChainMessage(
        uint256 indexed destinationDomain,
        bytes32 indexed intentId,
        address indexed sender,
        bytes payload
    );
    uint256 public localDomain = block.chainid;

    modifier onlyVault() {
        _onlyVault();
        _;
    }

    function _onlyVault() internal view {
        if (msg.sender != vaultAddress) revert OnlyVault();
    }

    constructor(uint256 vaultRotationDelay_) TimelockedRotation(vaultRotationDelay_) {}

    /// @notice Set the vault address (one-time, onlyOwner).
    /// @param v The vault contract address.
    function setVault(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        if (vaultAddress != address(0)) revert VaultAlreadySet();
        vaultAddress = v;
        emit VaultSet(v);
    }

    /// @notice Propose a new vault address with timelock.
    /// @param newVault The proposed vault address.
    function proposeVault(address newVault) external onlyOwner {
        _proposeRole(newVault);
        emit VaultProposed(newVault, pendingRoleEarliest);
    }

    /// @notice Accept the pending vault role after timelock expires.
    function acceptVault() external {
        address newVault = _acceptRole();
        vaultAddress = newVault;
        emit VaultSet(vaultAddress);
    }

    function registerStrategy(
        string calldata name,
        bytes32 workflowHash
    ) external whenNotPaused returns (uint256 id) {
        return _registerStrategy(name, workflowHash, 0, 0);
    }

    function registerStrategy(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) external whenNotPaused returns (uint256 id) {
        return _registerStrategy(name, workflowHash, apyTarget, loopCount);
    }

    function _registerStrategy(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) internal returns (uint256 id) {
        if (bytes(name).length < MIN_NAME_LENGTH) revert EmptyName();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (workflowHash == bytes32(0)) revert ZeroWorkflowHash();

        bytes32 contentHash = keccak256(abi.encode(_msgSender(), name));
        if (idByContentHash[contentHash] != 0) revert StrategyAlreadyExists();

        id = ++strategyCount;
        idByContentHash[contentHash] = id;
        strategies[id] = Strategy({
            workflowHash: workflowHash,
            creator: _msgSender(),
            active: true,
            createdAt: uint64(block.timestamp),
            name: name,
            apyTarget: apyTarget,
            loopCount: loopCount
        });
        encryptedTvls[id] = _ZERO;
        emit StrategyRegistered(id, msg.sender, name);
    }

    /// @notice Activate or deactivate a strategy (creator only).
    function setActive(uint256 strategyId, bool active) external whenNotPaused {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (strategies[strategyId].creator != _msgSender()) revert OnlyCreator();
        strategies[strategyId].active = active;
        emit StrategyActiveSet(strategyId, active);
    }

    /// @notice Increment the encrypted TVL for a strategy (vault only).
    function incrementTvl(
        uint256 strategyId,
        euint128 amount
    ) external override nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        _modifyTvl(strategyId, amount, true);
        emit TvlIncreased(strategyId, msg.sender);
    }

    /// @notice Decrement the encrypted TVL for a strategy (vault only).
    function decrementTvl(
        uint256 strategyId,
        euint128 amount
    ) external override nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        _modifyTvl(strategyId, amount, false);
        emit TvlDecreased(strategyId, msg.sender);
    }

    function _modifyTvl(uint256 strategyId, euint128 amount, bool isIncrement) internal {
        if (!FHE.isAllowed(amount, address(this))) revert FhePermissionDenied();
        euint128 prev = _ensureInitialized(encryptedTvls[strategyId]);
        FHE.allowThis(prev);
        euint128 result;
        if (isIncrement) {
            result = _safeIncrease(prev, amount, owner());
        } else {
            result = _safeDecrease(prev, amount, owner());
        }
        encryptedTvls[strategyId] = result;
        FHE.allowThis(result);
    }

    /// @notice Returns the encrypted TVL for a strategy, ACL-granted to caller for decryptForView.
    function getEncryptedTvl(uint256 strategyId) external returns (euint128 v) {
        v = _ensureInitialized(encryptedTvls[strategyId]);
        FHE.allow(v, msg.sender);
        FHE.allowSender(v);
        return v;
    }

    function getStrategyMeta(
        uint256 strategyId
    )
        external
        view
        returns (
            string memory name,
            bytes32 workflowHash,
            address creator,
            uint256 createdAt,
            bool active
        )
    {
        Strategy storage s = strategies[strategyId];
        return (s.name, s.workflowHash, s.creator, s.createdAt, s.active);
    }

    function getStrategyParams(
        uint256 strategyId
    ) external view returns (uint16 apyTarget, uint8 loopCount) {
        Strategy storage s = strategies[strategyId];
        return (s.apyTarget, s.loopCount);
    }

    /// @notice Broadcast a strategy to another domain via cross-chain message.
    /// @param strategyId The strategy ID to broadcast.
    /// @param destinationDomain The destination chain domain ID.
    function broadcastStrategy(uint256 strategyId, uint256 destinationDomain) external {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        Strategy storage s = strategies[strategyId];
        bytes memory payload = abi.encode(
            localDomain,
            strategyId,
            s.name,
            s.workflowHash,
            s.creator,
            s.apyTarget,
            s.loopCount
        );
        bytes32 intentId = _computeIntentId(payload);
        emit CrossChainMessage(destinationDomain, intentId, msg.sender, payload);
    }

    function _computeIntentId(bytes memory payload) private pure returns (bytes32 result) {
        return keccak256(payload);
    }

    /// @notice Receive a strategy from another domain (onlyOwner).
    /// @param sourceDomain The source chain domain ID.
    /// @param sourceStrategyId The original strategy ID on the source chain.
    /// @param name The strategy name.
    /// @param workflowHash The workflow hash.
    /// @param creator The original creator address.
    /// @param apyTarget Target APY in basis points.
    /// @param loopCount Number of loop iterations.
    function receiveCrossChainStrategy(
        uint256 sourceDomain,
        uint256 sourceStrategyId,
        string calldata name,
        bytes32 workflowHash,
        address creator,
        uint16 apyTarget,
        uint8 loopCount
    ) external onlyOwner {
        bytes32 contentHash = _computeContentHash(name, workflowHash, apyTarget, loopCount);
        if (idByContentHash[contentHash] != 0) revert StrategyAlreadyExists();
        uint256 id = strategyCount;
        ++strategyCount;
        strategies[id] = Strategy({
            workflowHash: workflowHash,
            creator: creator,
            active: true,
            createdAt: uint64(block.timestamp),
            name: name,
            apyTarget: apyTarget,
            loopCount: loopCount
        });
        idByContentHash[contentHash] = id;
        emit StrategyRegistered(id, creator, name);
        emit CrossChainMessage(sourceDomain, bytes32(sourceStrategyId), creator, "");
    }

    function _computeContentHash(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) private pure returns (bytes32 result) {
        bytes memory data = abi.encode(name, workflowHash, apyTarget, loopCount);
        return keccak256(data);
    }
}
