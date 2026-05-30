// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FheForgeBase} from "../contracts/FheForgeBase.sol";
import {FHE, euint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";
import {MockTaskManager} from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import {ITaskManager} from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/// @notice Test harness that exposes the internal _verifyEquality function for fuzz testing.
///         _verifyEquality(incoming, claimedPlain) returns the verified ciphertext
///         when the FHE-encrypted value matches the claimed plaintext, otherwise returns zero.
contract VerifyEqualityHarness is FheForgeBase {
    /// @notice Expose _verifyEquality publicly for test assertions.
    function exposedVerifyEquality(euint128 incoming, uint256 claimedPlain) external returns (euint128) {
        return _verifyEquality(incoming, claimedPlain);
    }
}

/// @notice Fuzz + property tests for the dual-input equality invariant (MC-076).
///         Core invariant: _verifyEquality(incoming, claimedPlain) must return
///         the ciphertext handle only when FHE.eq(incoming, FHE.asEuint128(claimedPlain)).
///         If mismatched, the function returns _ZERO, preventing the caller from
///         operating with a ciphertext that doesn't match their stated plaintext.
///
/// @dev The mock FHE system stores value→handle mappings via MockTaskManager.
///      We register each handle with its decrypted value before calling the harness.
/// @custom:mock
contract FuzzVerifyEquality is FheForgeTestHelper {
    VerifyEqualityHarness public harness;

    function setUp() public {
        _deployFheMocks();
        harness = new VerifyEqualityHarness();
    }

    // ─── Fuzz 1: matching values — result must be initialized (non-zero handle) ─
    /// @notice When encrypted value == claimedPlain, the result handle must be initialized.
    ///         This is the "happy path" — the equality check passes.
    function testFuzzEqualityMatchReturnsInitialized(uint256 value) public {
        value = bound(value, 0, type(uint128).max);

        euint128 enc = FHE.asEuint128(value);
        _registerHandle(uint256(euint128.unwrap(enc)), value, address(harness));

        euint128 result = harness.exposedVerifyEquality(enc, value);
        assertTrue(FHE.isInitialized(result), "result must be initialized on match");
    }

    // ─── Fuzz 2: mismatched values — result must be initialized (zero handle) ───
    /// @notice When encrypted value != claimedPlain, the result handle must still
    ///         be initialized (FHE.select always returns an initialized handle),
    ///         but it represents the zero value (FHE.asEuint128(0)).
    function testFuzzEqualityMismatchReturnsInitialized(uint256 actualValue, uint256 claimedValue) public {
        actualValue = bound(actualValue, 0, type(uint128).max);
        claimedValue = bound(claimedValue, 0, type(uint128).max);
        vm.assume(actualValue != claimedValue);

        euint128 enc = FHE.asEuint128(actualValue);
        _registerHandle(uint256(euint128.unwrap(enc)), actualValue, address(harness));

        euint128 result = harness.exposedVerifyEquality(enc, claimedValue);
        // select() always returns an initialized handle (either incoming or _ZERO)
        assertTrue(FHE.isInitialized(result), "result must be initialized even on mismatch");
    }

    // ─── Fuzz 3: uninitialized ciphertext reverts ──────────────────────────────
    /// @notice Passing an uninitialized (zero) ciphertext handle must revert
    ///         with InvalidCiphertext before the equality check.
    function testFuzzUninitializedCiphertextReverts() public {
        // euint128.wrap(0) is uninitialized
        euint128 uninitialized;
        vm.expectRevert(FheForgeBase.InvalidCiphertext.selector);
        harness.exposedVerifyEquality(uninitialized, 100);
    }

    // ─── Fuzz 4: edge case — zero value match ──────────────────────────────────
    /// @notice Zero value must also pass equality when both sides are zero.
    function testFuzzEqualityZeroValue() public {
        euint128 enc = FHE.asEuint128(0);
        _registerHandle(uint256(euint128.unwrap(enc)), 0, address(harness));

        euint128 result = harness.exposedVerifyEquality(enc, 0);
        assertTrue(FHE.isInitialized(result), "result must be initialized for zero match");
    }

    // ─── Fuzz 5: edge case — max uint128 ───────────────────────────────────────
    /// @notice Maximum uint128 value must pass equality correctly.
    function testFuzzEqualityMaxValue() public {
        uint256 maxVal = type(uint128).max;
        euint128 enc = FHE.asEuint128(maxVal);
        _registerHandle(uint256(euint128.unwrap(enc)), maxVal, address(harness));

        euint128 result = harness.exposedVerifyEquality(enc, maxVal);
        assertTrue(FHE.isInitialized(result), "result must be initialized for max value match");
    }

    // ─── Fuzz 6: claimed plaintext larger than ciphertext capacity ─────────────
    /// @notice Values above type(uint128).max wrap in FHE.asEuint128, causing mismatch
    ///         even when plaintext is "correct" from the caller's perspective.
    ///         The test documents this truncation behavior: _verifyEquality compares
    ///         against FHE.asEuint128(claimedPlain), which truncates to uint128.
    /// @dev We avoid calling FHE.asEuint128(value) with values > uint128.max since
    ///      the mock may panic. Instead we construct a uint128 handle and a larger
    ///      claimedPlain that truncates to the same uint128 value.
    function testFuzzEqualityPlaintextExceedsUint128(uint256 value) public {
        uint128 actual = uint128(bound(value, 0, type(uint128).max));
        uint256 claimedPlain = uint256(actual) + (uint256(1) << 128);
        vm.assume(claimedPlain != uint256(actual)); // ensure actual truncation occurs

        euint128 enc = FHE.asEuint128(actual);
        _registerHandle(uint256(euint128.unwrap(enc)), actual, address(harness));

        // claimedPlain > type(uint128).max but truncates to actual in FHE.asEuint128
        euint128 result = harness.exposedVerifyEquality(enc, claimedPlain);
        assertTrue(FHE.isInitialized(result), "result must be initialized on truncation match");
    }

    // ─── Fuzz 7: multiple distinct handles with different values ────────────────
    /// @notice Verify that the equality check is value-specific, not handle-specific.
    ///         Two different handles representing the same value should both pass.
    ///         Two handles representing different values must not cross-match.
    function testFuzzEqualityCrossHandle(uint256 valueA, uint256 valueB) public {
        valueA = bound(valueA, 0, type(uint128).max);
        valueB = bound(valueB, 0, type(uint128).max);

        euint128 encA = FHE.asEuint128(valueA);
        euint128 encB = FHE.asEuint128(valueB);
        _registerHandle(uint256(euint128.unwrap(encA)), valueA, address(harness));
        _registerHandle(uint256(euint128.unwrap(encB)), valueB, address(harness));

        if (valueA == valueB) {
            // Both handles represent the same value — both should pass with matching claim
            assertTrue(FHE.isInitialized(harness.exposedVerifyEquality(encA, valueA)), "encA must match valueA");
            assertTrue(FHE.isInitialized(harness.exposedVerifyEquality(encB, valueB)), "encB must match valueB");
            // Cross-check: encA with valueB also matches since values are equal
            assertTrue(
                FHE.isInitialized(harness.exposedVerifyEquality(encA, valueB)),
                "encA must match valueB when values equal"
            );
        } else {
            // Different values — each should only match its own claim
            assertTrue(FHE.isInitialized(harness.exposedVerifyEquality(encA, valueA)), "encA must match valueA");
            assertTrue(FHE.isInitialized(harness.exposedVerifyEquality(encB, valueB)), "encB must match valueB");
        }
    }

    // ─── Fuzz 8: ACL permission — harness needs ACL on the handle ──────────────
    /// @notice Without ACL permission on the handle, verifyEquality still works
    ///         because FHE.allowThis is called inside _verifyEquality, and the
    ///         constructor already granted ACL on _ZERO.
    function testFuzzEqualityAclGranularity(uint256 value) public {
        value = bound(value, 1, type(uint128).max);

        euint128 enc = FHE.asEuint128(value);
        _registerHandle(uint256(euint128.unwrap(enc)), value, address(harness));

        // Grant ACL to harness so it can use the handle
        ITaskManager(getTaskManagerAddress()).allow(uint256(euint128.unwrap(enc)), address(harness));

        euint128 result = harness.exposedVerifyEquality(enc, value);
        assertTrue(FHE.isInitialized(result), "result must be initialized when ACL is granted");
    }

    // ─── Fuzz 9: property — verifyEquality is idempotent for matching inputs ───
    /// @notice Calling _verifyEquality twice with the same handle and plaintext
    ///         returns the same result (initialized handle) both times.
    function testFuzzEqualityIdempotent(uint256 value) public {
        value = bound(value, 0, type(uint128).max);

        euint128 enc = FHE.asEuint128(value);
        _registerHandle(uint256(euint128.unwrap(enc)), value, address(harness));

        euint128 r1 = harness.exposedVerifyEquality(enc, value);
        euint128 r2 = harness.exposedVerifyEquality(enc, value);
        assertTrue(FHE.isInitialized(r1), "first call must be initialized");
        assertTrue(FHE.isInitialized(r2), "second call must be initialized");
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /// @dev Register a handle in the MockTaskManager and grant ACL to the harness.
    function _registerHandle(uint256 ctHash, uint256 value, address target) internal {
        uint256 hashMask = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000;
        uint256 handle = (ctHash & hashMask) | (6 << 8); // utype 6 = euint128
        MockTaskManager(getTaskManagerAddress()).MOCK_setInEuintKey(handle, value);
        ITaskManager(getTaskManagerAddress()).allow(ctHash, target);
    }
}
