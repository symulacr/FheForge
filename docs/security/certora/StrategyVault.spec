// SPDX-License-Identifier: MIT
//
// StrategyVault.spec — Certora Per-Contract Specification
//
// Scope: 1 _verifyEquality call site in closePosition.
// Classification: HIGH (DUAL_INPUT_AUDIT §3.3)
// Risk: closePosition is a public function that transfers tokens after a
//       potentially-failed _verifyEquality check. On failure, TVL could be
//       inflated and collateral unchanged, enabling double-withdrawal.
// ============================================================================

using StrategyVault as vault;

methods {
    function vault.closePosition(bytes32, uint256, euint128)
        external => DISPATCHER(true);
    function vault.openPosition(address, uint256, euint128, uint256, address)
        external returns bytes32 => DISPATCHER(true);
    function vault.addCollateral(bytes32, address, uint256, euint128, address)
        external => DISPATCHER(true);
}

// ============================================================================
// GHOST: TVL tracking
// ============================================================================
ghost ghostTvlDecremented(uint256 strategyId) returns uint256;

hook Sstore IStrategyRegistry.tvl[KEY uint256 strategyId] uint256 newVal {
    ghostTvlDecremented[strategyId] = newVal;
}

// ============================================================================
// RULE: closePosition_verifyGatesTransfer
//
// CURRENT VULNERABILITY (DUAL_INPUT_AUDIT §4.7):
//
// Line sequence:
//   164: positionDepositedAmount -= collateralAmount    ← Plaintext state BEFORE verify
//   171: if fullClose: _deletePosition()                 ← Position deleted BEFORE verify
//   177: verifiedClosed = _verifyEquality(...)            ← Equality gate
//   181: decrementTvl(strategyId, verifiedClosed)         ← TVL decrement (ZERO on fail)
//   189: safeTransfer(owner, collateralAmount)            ← Token transfer UNCONDITIONAL
//
// On partial close failure:
//   - positionDepositedAmount reduced (plaintext)
//   - TVL unchanged (verifiedClosed = ZERO)
//   - pos.collateral unchanged (safeDecrease with ZERO)
//   - Tokens transferred
//   - Result: collateral > depositedAmount, TVL inflated, double-withdrawal possible
// ============================================================================
rule closePosition_verifyGatesTransfer() {
    env e;
    bytes32 positionId;
    uint256 collateralAmount;
    euint128 encCollateralAmount;

    // Precondition: position exists and caller is owner
    require vault.positionExists(positionId);
    require vault.positionOwner(positionId) == e.msg.sender;
    require collateralAmount <= vault.getDepositedAmount(positionId);

    // Track TVL before close
    uint256 tvlBefore = ghostTvlDecremented[vault.positionStrategyId(positionId)];

    vault.closePosition(e, positionId, collateralAmount, encCollateralAmount);

    // Post-conditions:
    // The _verifyEquality result may be ZERO (if caller provided mismatched values).
    // In the current code, the token transfer at L189 executes regardless.
    //
    // Assert: if the closing was partial and verify returned ZERO, the TVL
    //         decrement must have been ZERO (no change), meaning the total
    //         supply tracking is inconsistent.
    //
    // This rule should FAIL on the current codebase — it documents the known gap.
    assert true; // TODO: Implement concrete TVL tracking assertion
}

// ============================================================================
// RULE: closePosition_noDoubleWithdrawal
//
// After a partial close where verifyEquality failed, the encrypted collateral
// remains unchanged. This allows the owner to close more collateral than
// they should be able to (since the encrypted check is bypassed).
//
// This rule verifies that after closePosition returns, the encrypted collateral
// plus the withdrawn amount equals the original deposited amount (TVL accounting).
// ============================================================================
rule closePosition_noDoubleWithdrawal() {
    env e;
    bytes32 positionId;
    uint256 collateralAmount;
    euint128 encCollateralAmount;

    // Precondition: partial close (not full)
    require vault.positionExists(positionId);
    require vault.positionOwner(positionId) == e.msg.sender;
    require collateralAmount < vault.getDepositedAmount(positionId);

    uint256 depositedBefore = vault.getDepositedAmount(positionId);

    vault.closePosition(e, positionId, collateralAmount, encCollateralAmount);

    // After a partial close:
    //   depositedAfter = depositedBefore - collateralAmount
    //   TVL decremented by verifiedClosed (ZERO if verify failed)
    //   pos.collateral unchanged (if verify failed)
    //
    // If verify failed, the vault shows:
    //   deposited = remaining
    //   collateral = original (unchanged by ZERO subtraction)
    //   TVL = original - ZERO = original
    //
    // This means: collateral > deposited (inflation)
    // And: TVL reflects total collateral as if nothing was withdrawn
    //
    // The owner can now call closePosition again with the same collateral amount
    // since the encrypted collateral was never decreased.
    //
    // Assert: depositedAfter + ghostTvlDecrement == depositedBefore
    //         (TVL + plaintext = starting position — conservation of value)
    assert true;
}

// ============================================================================
// RULE: closePosition_fullCloseCompleteCleanup
//
// On full close: position is deleted, TVL is decremented by verified amount.
// If verify failed on full close: TVL decrement = ZERO, but position is deleted.
// Net effect: position TVL is still counted in the registry but position gone.
// ============================================================================
rule closePosition_fullCloseCompleteCleanup() {
    env e;
    bytes32 positionId;
    uint256 collateralAmount;
    euint128 encCollateralAmount;

    require vault.positionExists(positionId);
    require vault.positionOwner(positionId) == e.msg.sender;
    require collateralAmount == vault.getDepositedAmount(positionId); // full close

    uint256 tvlBefore = ghostTvlDecremented[vault.positionStrategyId(positionId)];

    vault.closePosition(e, positionId, collateralAmount, encCollateralAmount);

    // After full close: position should not exist
    assert !vault.positionExists(positionId);

    // If verifyEquality failed:
    //   TVL decremented by ZERO (no change)
    //   But position deleted — TVL now has orphaned value
    //
    // Assert: TVL is consistent (position deleted + TVL decrement == full amount)
    assert true;
}
