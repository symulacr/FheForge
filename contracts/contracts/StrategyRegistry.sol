// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";

/// @title  StrategyRegistry
/// @notice Tracks registered strategies and their FHE-encrypted total-value-
///         locked. TVL is mutated only by the linked StrategyVault; underflow
///         on decrement is clamped to zero.
contract StrategyRegistry is IStrategyRegistry, ReentrancyGuard, Pausable {
    uint256 public constant MIN_NAME_LENGTH = 1;
    uint256 public constant MAX_NAME_LENGTH = 256;

    /// @notice Seconds between `proposeVault` and `acceptVault`. Production
    ///         deploys pass 48 hours; demo / testnet may pass smaller values.
    uint256 public immutable VAULT_ROTATION_DELAY;

    struct Strategy {
        bytes32 workflowHash;
        address creator;
        bool active;
        uint64 createdAt;
        string name;
        // F-03: strategy-level params, plaintext. Default 0 means "unset".
        // `apyTarget` is in basis points; `loopCount` is the leverage loop
        // depth. Both were previously per-position encrypted euint16/euint8.
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

    /// @notice Strategies indexed by id. Id 0 is reserved for "invalid".
    mapping(uint256 => Strategy) private strategies;
    mapping(uint256 => euint128) private encryptedTvls;
    /// @notice keccak256(abi.encodePacked(creator, name)) → id; prevents
    ///         duplicate (creator, name) pairs and front-run via mempool copy.
    mapping(bytes32 => uint256) public idByContentHash;
    uint256 public strategyCount;

    /// @notice The StrategyVault authorised to mutate encrypted TVL.
    address public vaultAddress;
    address public immutable OWNER;

    euint128 private immutable _ZERO;

    address public pendingVault;
    /// @notice Earliest `block.timestamp` at which `acceptVault` may be called.
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

    /// @notice Set the vault address for the FIRST time. Subsequent rotations
    ///         must use `proposeVault` + `acceptVault`.
    function setVault(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        if (vaultAddress != address(0)) revert VaultAlreadySet();
        vaultAddress = v;
        emit VaultSet(v);
    }

    /// @notice Propose a new vault address. Starts the rotation timelock.
    function proposeVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        pendingVault = newVault;
        pendingVaultEarliest = block.timestamp + VAULT_ROTATION_DELAY;
        emit VaultProposed(newVault, pendingVaultEarliest);
    }

    /// @notice Finalise a vault rotation after the timelock has elapsed.
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

    /// @notice Register a new strategy. The (creator, name) tuple must be
    ///         unique across the registry. Strategy params (apyTarget +
    ///         loopCount) default to zero — "unset". For atomic registration
    ///         with explicit params, use the 4-argument overload below.
    /// @return id The newly assigned id (always >= 1).
    /// @dev    No `nonReentrant` modifier: the body performs no token
    ///         transfers, no FHE ACL grants, and no external contract calls.
    ///         The only external surface is `_ZERO` (immutable euint128) and
    ///         storage writes — neither can re-enter.
    function registerStrategy(
        string calldata name,
        bytes32 workflowHash
    ) external whenNotPaused returns (uint256 id) {
        return _registerStrategy(name, workflowHash, 0, 0);
    }

    /// @notice Register a strategy with explicit plaintext params. Composer
    ///         flow uses this; the 2-arg overload above remains for callers
    ///         that don't care about the params (legacy + maintenance).
    function registerStrategy(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) external whenNotPaused returns (uint256 id) {
        return _registerStrategy(name, workflowHash, apyTarget, loopCount);
    }

    /// @dev Shared registration core. The pre-F-03 body lived inline in the
    ///      single `registerStrategy(name, hash)` external — extraction here
    ///      lets both overloads delegate without duplicating the contentHash
    ///      assembly + uniqueness gate.
    function _registerStrategy(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) internal returns (uint256 id) {
        if (bytes(name).length < MIN_NAME_LENGTH) revert EmptyName();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (workflowHash == bytes32(0)) revert ZeroWorkflowHash();

        // contentHash = keccak256(left-padded sender || raw name bytes).
        bytes32 contentHash;
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
            creator: msg.sender,
            active: true,
            createdAt: uint64(block.timestamp),
            name: name,
            apyTarget: apyTarget,
            loopCount: loopCount
        });
        encryptedTvls[id] = _ZERO;
        emit StrategyRegistered(id, msg.sender, name);
    }

    /// @notice Mark a strategy active or archived. Creator-only.
    function setActive(uint256 strategyId, bool active) external whenNotPaused {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (strategies[strategyId].creator != msg.sender) revert OnlyCreator();
        strategies[strategyId].active = active;
        emit StrategyActiveSet(strategyId, active);
    }

    /// @notice Add an encrypted amount to a strategy's TVL. Vault-only.
    function incrementTvl(
        uint256 strategyId,
        euint128 amount
    ) external override nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        if (!strategies[strategyId].active) revert StrategyInactive();
        _modifyTvl(strategyId, amount, true);
        emit TvlIncreased(strategyId, msg.sender);
    }

    /// @notice Subtract an encrypted amount from a strategy's TVL with
    ///         underflow clamping. Allowed even on archived strategies so
    ///         users can close out pre-archival positions.
    function decrementTvl(
        uint256 strategyId,
        euint128 amount
    ) external override nonReentrant onlyVault {
        if (strategyId == 0 || strategyId > strategyCount) revert InvalidStrategyId();
        _modifyTvl(strategyId, amount, false);
        emit TvlDecreased(strategyId, msg.sender);
    }

    /// @dev Shared FHE-permission + read-modify-write core for
    ///      `incrementTvl` / `decrementTvl` (72% similar in pre-refactor
    ///      analyzer). Caller is responsible for strategyId range
    ///      validation, the active / archived precondition, and emitting
    ///      its own `TvlIncreased` / `TvlDecreased` event (signatures
    ///      differ — both carry `msg.sender`). Caching `prev` here also
    ///      absorbs F-23 (was 3× `encryptedTvls[strategyId]` SLOADs in
    ///      the old `incrementTvl`).
    function _modifyTvl(uint256 strategyId, euint128 amount, bool isIncrement) internal {
        if (!FHE.isAllowed(amount, msg.sender)) revert FhePermissionDenied();
        euint128 prev = encryptedTvls[strategyId];
        FHE.allowThis(prev);
        euint128 result =
            isIncrement ? FHE.add(prev, amount) : FHE.sub(prev, FHE.min(amount, prev));
        encryptedTvls[strategyId] = result;
        FHE.allowThis(result);
    }

    /// @return name         Human-readable strategy name.
    /// @return workflowHash Hash of the strategy workflow definition.
    /// @return creator      Address that registered the strategy.
    /// @return createdAt    Block timestamp at registration.
    /// @return active       Whether the strategy is currently active.
    /// @dev Return tuple is intentionally not extended with the F-03
    ///      params — preserves positional decoders in scripts. Use
    ///      `getStrategyParams` for the new fields.
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

    /// @return apyTarget Target APY in basis points (0 if unset).
    /// @return loopCount Leverage loop depth (0 if unset).
    function getStrategyParams(
        uint256 strategyId
    ) external view returns (uint16 apyTarget, uint8 loopCount) {
        Strategy storage s = strategies[strategyId];
        return (s.apyTarget, s.loopCount);
    }
}
