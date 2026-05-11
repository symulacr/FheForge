// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, ebool, euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";

contract StrategyRegistry is IStrategyRegistry, ReentrancyGuard, Pausable {
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 256;

    uint256 public immutable VAULT_ROTATION_DELAY;

    // solhint-disable-next-line gas-struct-packing
    struct Strategy {
        bytes32 workflowHash;
        address creator;
        bool active;
        uint64 createdAt;
        string name;
        uint16 apyTarget;
        uint8 loopCount;
    }

    error OnlyVault();
    error OnlyOwner();
    error OnlyCreator();
    error InvalidStrategyId();
    error VaultAlreadySet();
    error FhePermissionDenied();
    error ZeroAddress();
    error EmptyName();
    error NameTooLong();
    error ZeroWorkflowHash();
    error StrategyAlreadyExists();
    error StrategyInactive();
    error NoPendingVault();
    error TimelockNotElapsed();

    mapping(uint256 => Strategy) private strategies;
    mapping(uint256 => euint128) private encryptedTvls;

    mapping(bytes32 => uint256) public idByContentHash;
    uint256 public strategyCount;

    address public vaultAddress;
    address public immutable OWNER;

    euint128 private immutable _ZERO;

    address public pendingVault;

    uint256 public pendingVaultEarliest;

    event StrategyRegistered(uint256 indexed id, address indexed creator, string name);
    event StrategyActiveSet(uint256 indexed id, bool indexed active);
    event VaultSet(address indexed vault);
    event VaultProposed(address indexed newVault, uint256 indexed earliest);
    event TvlIncreased(uint256 indexed strategyId, address indexed caller);
    event TvlDecreased(uint256 indexed strategyId, address indexed caller);
    event Paused();
    event Unpaused();

    modifier onlyVault() {
        _onlyVault();
        _;
    }

    function _onlyVault() internal view {
        if (msg.sender != vaultAddress) revert OnlyVault();
    }

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert OnlyOwner();
    }

    constructor(uint256 vaultRotationDelay_) {
        OWNER = msg.sender;
        VAULT_ROTATION_DELAY = vaultRotationDelay_;
        euint128 z = FHE.asEuint128(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    function setVault(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        if (vaultAddress != address(0)) revert VaultAlreadySet();
        vaultAddress = v;
        emit VaultSet(v);
    }

    function proposeVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        pendingVault = newVault;
        pendingVaultEarliest = block.timestamp + VAULT_ROTATION_DELAY;
        emit VaultProposed(newVault, pendingVaultEarliest);
    }

    function acceptVault() external {
        if (pendingVault == address(0)) revert NoPendingVault();
        if (block.timestamp < pendingVaultEarliest) revert TimelockNotElapsed();
        vaultAddress = pendingVault;
        pendingVault = address(0);
        pendingVaultEarliest = 0;
        emit VaultSet(vaultAddress);
    }

    function pause() external onlyOwner {
        _pause();
        emit Paused();
    }

    function unpause() external onlyOwner {
        _unpause();
        emit Unpaused();
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

        bytes32 contentHash;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let m := mload(0x40)
            mstore(m, caller())
            let nameLen := name.length
            calldatacopy(add(m, 0x20), name.offset, nameLen)
            contentHash := keccak256(m, add(0x20, nameLen))
        }
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

    function setActive(uint256 strategyId, bool active) external whenNotPaused {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (strategies[strategyId].creator != _msgSender()) revert OnlyCreator();
        strategies[strategyId].active = active;
        emit StrategyActiveSet(strategyId, active);
    }

    function incrementTvl(
        uint256 strategyId,
        euint128 amount
    ) external override nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        _modifyTvl(strategyId, amount, true);
        emit TvlIncreased(strategyId, msg.sender);
    }

    function decrementTvl(
        uint256 strategyId,
        euint128 amount
    ) external override nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        _modifyTvl(strategyId, amount, false);
        emit TvlDecreased(strategyId, msg.sender);
    }

    function incrementTvl(
        uint256 strategyId,
        InEuint128 calldata encAmount
    ) external nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        InEuint128 memory m = encAmount;
        euint128 amount = FHE.asEuint128(m);
        _modifyTvl(strategyId, amount, true);
        emit TvlIncreased(strategyId, msg.sender);
    }

    function decrementTvl(
        uint256 strategyId,
        InEuint128 calldata encAmount
    ) external nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        InEuint128 memory m = encAmount;
        euint128 amount = FHE.asEuint128(m);
        _modifyTvl(strategyId, amount, false);
        emit TvlDecreased(strategyId, msg.sender);
    }

    function _modifyTvl(uint256 strategyId, euint128 amount, bool isIncrement) internal {
        if (!FHE.isAllowed(amount, address(this))) revert FhePermissionDenied();
        euint128 prev = encryptedTvls[strategyId];
        FHE.allowThis(prev);
        euint128 result;
        if (isIncrement) {
            result = FHE.add(prev, amount);
        } else {
            ebool hasEnough = FHE.gte(prev, amount);
            result = FHE.select(hasEnough, FHE.sub(prev, amount), prev);
        }
        encryptedTvls[strategyId] = result;
        FHE.allowThis(result);

    }

    /// @notice Returns the encrypted TVL for a strategy, ACL-granted to caller for decryptForView.
    function getEncryptedTvl(uint256 strategyId) external returns (euint128) {
        euint128 v = encryptedTvls[strategyId];
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
}
