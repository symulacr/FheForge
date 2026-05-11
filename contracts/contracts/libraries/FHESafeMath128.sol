// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, ebool, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @dev Library providing safe arithmetic operations for euint128 encrypted values.
///      Ported from FHERC20 reference FHESafeMath (euint64) with identical logic.
///      All overflow/underflow detection is performed homomorphically — no plaintext
///      is revealed. On failure, the original value is preserved via FHE.select.
library FHESafeMath128 {
    /// @dev Try to increase `oldValue` by `delta`.
    ///      If add would overflow (wrapped result < oldValue), success=false,
    ///      updated=oldValue (unchanged). Otherwise success=true, updated=newValue.
    function tryIncrease(euint128 oldValue, euint128 delta)
        internal
        returns (ebool success, euint128 updated)
    {
        if (!FHE.isInitialized(oldValue)) {
            return (FHE.asEbool(true), delta);
        }
        euint128 newValue = FHE.add(oldValue, delta);
        // Overflow check: if a + b wraps, the result is smaller than a
        success = FHE.gte(newValue, oldValue);
        updated = FHE.select(success, newValue, oldValue);
    }

    /// @dev Try to decrease `oldValue` by `delta`.
    ///      If sub would underflow (delta > oldValue), success=false,
    ///      updated=oldValue (unchanged). Otherwise success=true, updated=newValue.
    function tryDecrease(euint128 oldValue, euint128 delta)
        internal
        returns (ebool success, euint128 updated)
    {
        if (!FHE.isInitialized(oldValue)) {
            if (!FHE.isInitialized(delta)) {
                return (FHE.asEbool(true), oldValue);
            }
            return (FHE.eq(delta, FHE.asEuint128(0)), FHE.asEuint128(0));
        }
        // Underflow check: delta must be <= oldValue
        success = FHE.gte(oldValue, delta);
        updated = FHE.select(success, FHE.sub(oldValue, delta), oldValue);
    }

    /// @dev Try to add `a` + `b`. If overflow, success=false, res=0.
    function tryAdd(euint128 a, euint128 b)
        internal
        returns (ebool success, euint128 res)
    {
        if (!FHE.isInitialized(a)) return (FHE.asEbool(true), b);
        if (!FHE.isInitialized(b)) return (FHE.asEbool(true), a);
        euint128 sum = FHE.add(a, b);
        success = FHE.gte(sum, a);
        res = FHE.select(success, sum, FHE.asEuint128(0));
    }

    /// @dev Try to subtract `b` from `a`. If underflow, success=false, res=0.
    function trySub(euint128 a, euint128 b)
        internal
        returns (ebool success, euint128 res)
    {
        if (!FHE.isInitialized(b)) return (FHE.asEbool(true), a);
        euint128 difference = FHE.sub(a, b);
        success = FHE.lte(difference, a);
        res = FHE.select(success, difference, FHE.asEuint128(0));
    }
}
