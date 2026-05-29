# Formal Verification Specification — FheForge

**Protocol:** FheForge — Private Encrypted DeFi on Arbitrum Sepolia  
**Document Version:** 1.0  
**Date:** May 2026  
**Core Invariant:** `plaintext_A == plaintext_B` before any FHE trust boundary crossing  
**Reference Audit:** `docs/security/DUAL_INPUT_AUDIT.md` (428 lines, 13 call sites)  
**Contracts Analyzed:** `LendingPool.sol`, `FheForgeComposer.sol`, `StrategyVault.sol`, `FheForgeBase.sol`

---

## Table of Contents

1. [Security Invariant Definitions](#1-security-invariant-definitions)
2. [Trust Boundary Map](#2-trust-boundary-map)
3. [Tool Selection Analysis](#3-tool-selection-analysis)
4. [Recommended Verification Approach](#4-recommended-verification-approach)
5. [Effort Estimates](#5-effort-estimates)
6. [CVL Rule Specification](#6-cvl-rule-specification)
7. [Appendix: Background Research](#7-appendix-background-research)

---

## 1. Security Invariant Definitions

### 1.1 Core Invariant: FHE-Plaintext Consistency

The protocol's fundamental security property is that no function shall accept both an encrypted (`euint128` / `InEuint128`) and plaintext (`uint256`) input from the same caller without verifying their consistency, and that this verification must occur **before** any state mutation or value transfer that depends on either value.

**Natural Language:**

> For every function `f` that accepts both a plaintext amount `p ∈ uint256` and an encrypted handle `e ∈ euint128`, if `_verifyEquality(e, p)` returns `_ZERO` (indicating mismatch), then `f` must either revert entirely, or the plaintext token transfer associated with `p` must not execute.

**Formal Pseudo-Code (TLA⁺-style):**

```
Invariant FHEPlaintextConsistency:
    ∀ f ∈ {shield, borrowWithLtvCheck, ..., closePosition}:
        ∀ p ∈ uint256, e ∈ euint128:
            let result = _verifyEquality(e, p)
            in  (result == _ZERO) ⇒
                    (¬tokenTransferExecuted(f, p) ∨ f reverts)
```

### 1.2 Invariant A: Equality Gate Soundness

The `_verifyEquality` function must satisfy the soundness property that if it returns a non-zero result (the original `incoming` ciphertext), then the plaintext value of `incoming` must equal `claimedPlain`.

**Natural Language:**

> If `_verifyEquality(incoming, claimedPlain)` returns `incoming` (not `_ZERO`), then the decryption of `incoming` equals `claimedPlain`. Equivalently: `FHE.eq(incoming, FHE.asEuint128(claimedPlain))` must evaluate to `true`.

**Formal:**

```
Invariant EqualityGateSoundness:
    ∀ incoming ∈ euint128, claimedPlain ∈ uint256:
        let match  = FHE.eq(incoming, FHE.asEuint128(claimedPlain))
        let result = FHE.select(match, incoming, ZERO)
        in  (result ≠ ZERO) ⇒ (match = true)
```

### 1.3 Invariant B: No State Mutation Before Equality Check

For all call sites, the plaintext token transfer (`safeTransfer` / `safeTransferFrom`) must not execute before the `_verifyEquality` check completes, UNLESS the function reverts on a failed equality check.

**Natural Language:**

> In every function listed in §2, the sequence of operations must be: (1) equality verification, (2) conditional token transfer. Currently, 4 of 13 sites violate this order — see trust boundary classification below.

**Formal:**

```
Invariant NoStateMutationBeforeCheck:
    ∀ function f ∈ HIGH_RISK_SITES:
        let order = operationSequence(f)
        in  order.indexOf(tokenTransfer) ≥ order.indexOf(verifyEquality)
```

### 1.4 Invariant C: Reentrancy Isolation Across FHE→Plaintext Boundary

The `nonReentrant` modifier must be active across the entire FHE-to-plaintext trust boundary transition. No external call that could reenter the contract may occur between the equality check and the plaintext token transfer.

**Natural Language:**

> Between the call to `_verifyEquality` and the execution of `safeTransfer`/`safeTransferFrom`, the reentrancy guard (`_REENTERED` bit) must be set. No callback, external call, or fallback may execute `_verifyEquality`-gated functions during this window.

**Formal:**

```
Invariant ReentrancyIsolation:
    ∀ function f ∈ ALL_SITES:
        let guardBit = storage[poolGuard] & _REENTERED
        in  between(verifyEqualityCall, tokenTransfer, f) ⇒
                guardBit = 1
```

---

## 2. Trust Boundary Map

FheForge has three trust boundaries. Each crossing from FHE-encrypted state to plaintext state is a verification point.

### 2.1 Trust Boundary Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    CALLER DOMAIN                        │
│  (User provides both plaintext amount + encrypted       │
│   InEuint128 through CoFHE SDK)                         │
└─────────────────────────────────┬───────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│               TRUST BOUNDARY 1                          │
│  FHE.asEuint128(InEuint128) → euint128                  │
│  _verifyEquality(euint128, uint256) → euint128          │
│  CoFHE runtime: FHE.eq, FHE.select                      │
│  DEPENDENCY: CoFHE coprocessor correctness              │
└─────────────────────────────────┬───────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│               TRUST BOUNDARY 2                          │
│  Encrypted state mutation:                              │
│  FHESafeMath128, supplyBalances, borrowBalances          │
│  TVL registry updates                                   │
│  ACL: FHE.allowThis(), FHE.allowTransient()             │
│  All operations on euint128 — never leaves FHE          │
└─────────────────────────────────┬───────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│               TRUST BOUNDARY 3 ★★★                     │
│  FHE → PLAINTEXT CROSSING (THE CRITICAL GAP)            │
│  safeTransfer/safeTransferFrom: ERC-20 token movement   │
│  liquidReserve[]: plaintext liquidity accounting        │
│  totalPlainBorrow[]: plaintext debt accounting          │
│  positionDepositedAmount[]: plaintext position tracking │
│  _deletePosition(): plaintext position deletion         │
│                                                          │
│  ★ AT THIS BOUNDARY, _verifyEquality RESULT IS IGNORED  │
│  ★ Token transfers execute UNCONDITIONALLY              │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Call Site Classification by Trust Boundary Risk

| # | Contract | Function | B1 Gate | B2 Effects | B3 Crossing | Category |
|---|---|---|---|---|---|---|
| 1 | LendingPool | `shield()` | ✓ verifyEq | supplyBalances += verified | safeTransferFrom **BEFORE** verifyEq | **HIGH** — B3 before B1 |
| 2 | LendingPool | `borrowWithLtvCheck()` | ✓ verifyEq | borrowBalances += verified | safeTransfer **AFTER** verifyEq (unconditional) | **HIGH** — B3 ignores B1 result |
| 3 | LendingPool | `repayDebt()` | ✓ verifyEq | borrowBalances -= verified | safeTransferFrom **BEFORE** verifyEq | **HIGH** — B3 before B1 |
| 4 | LendingPool | `_withdrawCore()` | ✓ verifyEq | supplyBalances -= verified | safeTransfer (via partialUnshield) | **HIGH** — B3 unconditional |
| 5 | LendingPool | `shieldEth()` | ✓ verifyEq | supplyBalances += verified | weth.deposit **AFTER** verifyEq | **HIGH** — B3 unconditional |
| 6 | LendingPool | `borrowWithOracle()` | ✓ verifyEq | borrowBalances += verified | safeTransfer **AFTER** verifyEq | **HIGH** — B3 unconditional |
| 7 | FheForgeComposer | `_openVaultPosition()` | ✓ verifyEq | verifiedColl → VAULT | safeTransferFrom **BEFORE** (collateral taken) | **MED** — Composer mediator |
| 8 | FheForgeComposer | `_depositToPool()` | ✓ verifyEq | verifiedSupply → POOL | safeTransferFrom **BEFORE** | **MED** — downstream trusted |
| 9 | FheForgeComposer | `_borrowFromPool()` | ✓ verifyEq | verifiedBorrow → POOL | POOL.borrowFor (safeTransfer) | **MED** — downstream trusted |
| 10 | FheForgeComposer | `rebalance()` addColl | ✓ verifyEq | verifiedAddColl → VAULT | safeTransferFrom **BEFORE** | **MED** — downstream trusted |
| 11 | FheForgeComposer | `rebalance()` repay | ✓ verifyEq | verifiedRepay → POOL | safeTransferFrom **BEFORE** | **MED** — downstream trusted |
| 12 | FheForgeComposer | `rebalance()` borrow | ✓ verifyEq | verifiedNewBorrow → POOL | POOL.borrowFor (safeTransfer) | **MED** — downstream trusted |
| 13 | StrategyVault | `closePosition()` | ✓ verifyEq | TVL decremented, collateral decreased | safeTransfer **AFTER** verifyEq (unconditional) | **HIGH** — B3 ignores B1 result |

### 2.3 Critical Gap Analysis

The fundamental gap is captured by two observations:

**Observation 1:** `_verifyEquality` returns a `euint128` result that only affects **encrypted state** (`supplyBalances`, `borrowBalances`, `pos.collateral`). Plaintext state and token transfers are governed by the caller-provided `uint256` parameter, not the verified result.

**Observation 2:** Where token transfers occur **after** `_verifyEquality`, they execute unconditionally — the equality result does not gate them. Where they occur **before**, the equality check is too late to prevent loss.

The combined effect: a caller who provides a mismatched pair `(plaintext=1000, ciphertext=decrypts_to_0)` will:
- Have the ciphertext value `0` recorded in encrypted state (safe)
- Have the plaintext value `1000` transferred in tokens (unsafe — at risk)

---

## 3. Tool Selection Analysis

### 3.1 Tool Landscape Overview

| Tool | Type | Exhaustive | Handles FHE Ops | Cross-Contract | Maturity | Cost |
|---|---|---|---|---|---|---|
| **Certora Prover** | Formal verification (SMT + symbolic execution) | ✓ Exhaustive for specified paths | ✗ No native FHE support — requires abstraction | ✓ Multi-contract via methods blocks | Production-grade (200+ protocols verified) | Commercial (free for OSS/academic) |
| **HEVM** | Symbolic EVM execution | ✓ Exhaustive | ✗ Generic EVM — no FHE opcode awareness | ✓ Any EVM contract | Mature (EF-backed) | Free / open source |
| **Scribble** | Runtime annotation verification | ✗ Per-input only | ✗ Annotation language — no FHE awareness | ✓ Annotation-based | Beta (ConsenSys) | Free / open source |
| **Halmos** | Symbolic testing (a16z) | ✓ Exhaustive | ✗ Generic EVM — no FHE primitives | ✓ Foundry-based | Active development | Free / open source |
| **Manual Audit** | Expert code review | ✗ Coverage limited by reviewer | ✓ Human reasoning | ✓ Human reasoning | — | $100–500K+ |
| **CoFHE ZK Proof** | Cryptographic proof (planned MC-035) | ✓ For individual equality proof | ✓ Native FHE integration | ✓ Protocol-level | Planned post-MVP | Development effort |

### 3.2 Detailed Analysis by Tool

#### 3.2.1 Certora Prover (Recommended Primary Tool)

**Strengths:**
- **Exhaustive state-space exploration** — proves properties for ALL inputs, not just sampled cases
- **Multi-contract verification** — can model the LendingPool ↔ Composer ↔ Vault interactions through `methods` blocks with `NONDET` summaries for external contracts
- **Ghost variables** — can model abstract FHE state (supply balances, borrow balances) without needing actual FHE execution
- **CVL hooks** — `sload`/`sstore` hooks can track every storage write between `_verifyEquality` and `safeTransfer`
- **Parametric rules** — one rule can verify all 13 call sites with a single `method f` variable
- **Industry precedence** — used by Morpho Blue, Aave, Compound, MakerDAO for verified invariants

**Limitations:**
- **No native FHE support** — Certora's Prover operates on EVM bytecode and cannot symbolically execute CoFHE `FHE.eq`, `FHE.asEuint128`, `FHE.select`. These must be approximated with CVL `ghost` functions and `hook` summaries.
- **External call modeling** — Calls to `FHE.*` functions and the CoFHE runtime are opaque to the Prover. Behavior must be summarized via `NONDET` or custom ghost functions.
- **Requires CERTORAKEY** — Prover runs on cloud infrastructure (free for open source)

**Approach for FHE Abstraction in CVL:**

```cvl
// Abstract FHE.eq as a ghost function that returns true/false
// based on the relationship between the two arguments
ghost FHE_eq(euint128 a, euint128 b) returns bool;
ghost FHE_asEuint128(uint256 v) returns euint128;
ghost FHE_select(bool cond, euint128 a, euint128 b) returns euint128;

// The _verifyEquality function's behavior can be modeled as:
//   _verifyEquality(incoming, claimed) {
//     match = FHE_eq(incoming, FHE_asEuint128(claimed))
//     return match ? incoming : ZERO;
//   }
```

#### 3.2.2 HEVM (Recommend for Equivalence Checking)

**Strengths:**
- **Symbolic execution** — explores all execution paths for a given function
- **Equivalence checking** — can prove two contract versions behave identically (critical for upgrade safety)
- **Assertion checking** — `prove_`-prefixed functions in Forge become symbolic checks
- **Open source** — no API key or cloud dependency

**Limitations:**
- **No FHE opcode awareness** — Cannot symbolically execute FHE operations. Paths through `FHE.eq` are opaque unless summarized
- **Single-contract focus** — Cross-contract equivalence is possible but requires manual setup
- **No native ghost/hook system** — Cannot easily model abstract state like Certora's ghosts

**Best Use Case:**
- Equivalence checking between deployed bytecode and new versions after upgrades
- Proving that the gas-optimized version of `_verifyEquality` has the same behavior as the original
- Symbolic unit testing of `FHESafeMath128` to prove no overflow paths exist

#### 3.2.3 Scribble (Recommend for Continuous Monitoring)

**Strengths:**
- **Inline annotations** — `/// @if_succeeds` and `/// @invariant` annotations go directly in Solidity
- **Instrumentation** — transforms annotated contracts into self-checking versions
- **Combines with fuzzing** — instrumented contracts can be fuzzed with Echidna or Diligence Fuzzing

**Limitations:**
- **Not exhaustive** — only checks properties for the specific inputs tested
- **No FHE awareness** — Cannot reason about encrypted values
- **No formal proof** — Runtime monitoring, not mathematical verification

**Best Use Case:**
- Runtime assertions that can catch invariant violations in staging/test environments
- Lightweight property guards that complement formal verification

#### 3.2.4 Custom ZK Proof (Long-Term, Planned MC-035)

**Strengths:**
- **Cryptographic guarantee** — Replaces `_verifyEquality`'s caller-provided-plaintext trust with a ZK proof that the encrypted amount matches user intent
- **Eliminates the fundamental gap** — No more dual-input trust assumption
- **Native FHE integration** — Works with CoFHE's encrypted state model

**Limitations:**
- **Development effort** — Estimated 4–8 weeks for circuit design, implementation, and audit
- **Gas cost** — ZK proof verification on-chain adds gas overhead
- **CoFHE dependency** — Requires CoFHE SDK support for proof generation

**Best Use Case:**
- Post-MVP replacement of the current `_verifyEquality` mechanism (see ADR-002, MC-035)

### 3.3 Tool Selection Matrix by Invariant

| Invariant | Certora | HEVM | Scribble | ZK Proof |
|---|---|---|---|---|
| A: Equality Gate Soundness | ⭐ Primary — ghost FHE ops | ◇ Symbolic unit test | ◇ Runtime assertion | ⭐ Ultimate fix |
| B: No State Mutation Before Check | ⭐ Primary — parametric rule | ✗ Cross-contract ordering hard | ◇ If annotation added | ◇ Protocol-level |
| C: Reentrancy Isolation | ⭐ Primary — hook on guard bit | ✗ Cannot model reentrancy | ✗ Not expressible | ✗ Out of scope |
| FHESafeMath128 correctness | ◇ Well-suited | ⭐ Symbolic unit test | ◇ Annotations | ✗ Out of scope |
| Upgrade equivalence | ✗ Not designed | ⭐ Equivalence checking | ✗ Not designed | ✗ Out of scope |

---

## 4. Recommended Verification Approach

### 4.1 Phased Strategy

We recommend a **three-phase approach** progressing from highest-ROI formal verification to the ultimate cryptographic fix.

#### Phase 1: Certora CVL Rules (Weeks 1–3)

Target the three core invariants with CVL parametric rules across all 13 call sites.

**Deliverables:**
- `FheForge.spec` with invariant A, B, C as CVL rules (see §6)
- Ghost functions modeling FHE operations (`FHE_eq`, `FHE_asEuint128`, `FHE_select`)
- `LendingPool.spec`, `FheForgeComposer.spec`, `StrategyVault.spec` per-contract complement
- Configuration files for the Certora Prover CLI

**Success Criteria:**
- All three invariants verified on a FHE-abstracted model
- Counterexamples generated for known vulnerable patterns (verifying the spec catches bugs)
- Proof that reordering operations eliminates B3-before-B1 violations

#### Phase 2: Scribble Runtime Annotations (Week 4)

Deploy runtime-checkable versions of the invariants for staging/testing.

**Deliverables:**
- Inline Scribble annotations on all 13 call sites
- CI pipeline that runs instrumented contracts through fuzzing
- Reduced false-positive rate via fuzzed counterexample discovery

#### Phase 3: CoFHE ZK Proof of Equality (Post-MVP, MC-035)

Replace the caller-provided-plaintext trust model with cryptographic proof.

**Deliverables:**
- ZK circuit for `plaintext_amount == encrypted_amount`
- On-chain proof verification in `_verifyEquality`
- Removal of the dual-input trust gap

### 4.2 Why Certora First?

1. **Exhaustive vs. sampled** — Certora proves invariants for ALL inputs, unlike fuzzing or testing
2. **Already proven in DeFi** — Used by Morpho Blue, Spark, Aave to verify similar cross-contract invariants. Morpho Blue's formal verification by Certora (Dec 2023) verified properties including: no under-collateralized loans, no double-counting of assets, correct liquidation behavior — directly analogous to FheForge's `_verifyEquality` invariants
3. **Ghost-based FHE abstraction** — Even though Certora cannot execute FHE operations natively, ghost functions can model the protocol's behavior over encrypted state. The invariants we care about (ordering, execution gating, reentrancy) are control-flow properties that do not require actual FHE computation
4. **Parametric rules reduce spec surface** — A single parametric rule with `method f` can check the invariant across all 13 sites, rather than writing 13 separate rules

### 4.3 Key Abstraction Decisions for Certora

When modeling FheForge in CVL, three critical abstraction decisions must be made:

**Decision 1 — FHE Ops as Ghosts:**
Abstract `FHE.eq`, `FHE.asEuint128`, `FHE.select` as CVL ghost functions. This is sound because the invariants we verify are about **execution ordering** and **state isolation** — not about the correctness of CoFHE's cryptographic operations. The CoFHE runtime is independently verified through its own security model.

```cvl
// Soundness argument: If a violation exists, it's because of ordering/gating,
// not because FHE.eq computed the wrong result. Ghost abstractions are
// sound for control-flow properties.
```

**Decision 2 — Encrypted State as Ghost Mappings:**
Model `supplyBalances`, `borrowBalances`, and `collateral` as ghost mappings of type `address → address → uint256`. This allows the Prover to reason about when encrypted state changes, even though the actual values are opaque.

```cvl
ghost supplyBalances(address, address) returns uint256;
ghost borrowBalances(address, address) returns uint256;

hook Sstore mapping[KEY address token][KEY address user] euint128 newVal {
    // Track that encrypted state was updated
    ghostSupplyBalances[token][user] = 1; // abstract: 1 = updated
}
```

**Decision 3 — NonReentrant Guard Modeling:**
The `_poolGuard` bitmask is standard uint256 manipulation and can be directly verified by the Prover. No abstraction needed.

### 4.4 Verification Soundness

The FHE abstraction introduces an **over-approximation**: the Prover may report counterexamples that are not reachable with the real CoFHE runtime. This is conservative — it means the spec may report false positives but will never miss a true violation (assuming the ghost abstraction correctly models state transitions that depend on FHE results).

To mitigate over-approximation risk:
- Validate ghost model against real CoFHE execution for a subset of call sites
- Use `rule_sanity` to verify non-vacuous rules
- Manually review counterexamples before declaring them valid

---

## 5. Effort Estimates

### 5.1 Certora CVL Verification (Recommended First Phase)

| Component | Effort | Parallelizable | Dependencies |
|---|---|---|---|
| Ghost function definitions (FHE abstraction) | 2–3 days | Yes | Understanding of FHE ops |
| Invariant A: Equality Gate Soundness | 2 days | No | Ghost definitions complete |
| Invariant B: No State Mutation Before Check | 3 days | No | Invariant A complete |
| Invariant C: Reentrancy Isolation | 2 days | Yes | Contract analysis complete |
| Per-contract spec augmentation | 3 days | Yes (3 tracks) | Core invariants complete |
| Configuration files & CI integration | 1 day | Yes | — |
| Counterexample review & iteration | 3–5 days | No | All rules written |
| **Total Phase 1** | **16–19 days** | — | — |

### 5.2 HEVM Equivalence Checking

| Component | Effort | Notes |
|---|---|---|
| FHESafeMath128 symbolic unit tests | 2 days | High ROI — no FHE abstraction needed |
| Upgrade equivalence: current vs. reordered | 3 days | After Phase 1 identifies needed reordering |
| Symbolic fuzz harness for `_verifyEquality` | 2 days | With FHE ops abstracted as symbolic values |
| **Total (if pursued)** | **7 days** | Phase 1 complement, not replacement |

### 5.3 Scribble Runtime Annotations

| Component | Effort | Notes |
|---|---|---|
| Annotations on HIGH sites (7 functions) | 2 days | Inline `@if_succeeds` on public functions |
| Scribble instrumentation in CI | 1 day | `scribble --arm` pipeline |
| Fuzzing integration (Echidna) | 2 days | Property-based testing of instrumented contracts |
| **Total (if pursued)** | **5 days** | Phase 2 — after Certora |

### 5.4 CoFHE ZK Proof (Long-Term)

| Component | Effort | Notes |
|---|---|---|
| ZK circuit design | 2–3 weeks | Requires ZK engineering expertise |
| On-chain verifier integration | 1–2 weeks | Integration with `_verifyEquality` |
| Security audit | 2–3 weeks | External audit mandatory |
| **Total** | **5–8 weeks** | Planned for post-MVP (MC-035) |

### 5.5 Comparative Cost Summary

| Approach | Cost (USD) | Assurance Level | Time to Result |
|---|---|---|---|
| Certora CVL (Phase 1) | $0 (OSS) – $15K (Pro) | ★★★★☆ — Exhaustive for spec | 3–4 weeks |
| HEVM | $0 | ★★★☆☆ — Exhaustive for single contracts | 1–2 weeks |
| Scribble | $0 | ★★☆☆☆ — Per-input only | 1 week |
| Manual Audit | $50K–$150K | ★★★☆☆ — Reviewer-dependent | 2–4 weeks |
| ZK Proof (MC-035) | $100K–$250K | ★★★★★ — Cryptographic guarantee | 6–10 weeks |
| **Certora + Audit + ZK** | $150K–$415K | ★★★★★ — Multi-layered | 10–14 weeks |

---

## 6. CVL Rule Specification

The following section defines the three core invariants as Certora Verification Language (CVL) rule skeletons. The actual rules are implemented in `docs/security/certora/FheForge.spec`.

### 6.1 Rule A: EqualityGateSoundness

**Purpose:** Verify that `_verifyEquality` returns `_ZERO` when the encrypted and plaintext values do not match, and returns the original ciphertext when they do match.

**CVL Pseudo-Code:**

```cvl
rule EqualityGateSoundness(method f) {
    // Pre-condition: f is a function using _verifyEquality
    require f.selector in { shield.selector, borrowWithLtvCheck.selector, ... };
    
    // Execute f with any valid arguments
    env e;
    calldataarg args;
    f(e, args);
    
    // Post-condition: if _verifyEquality was called and returned ZERO,
    // then a revert must occur or no token transfer may happen
    assert _verifyEqualityReturnedZero ⇒ (reverted || noTokenTransfer);
}
```

### 6.2 Rule B: StateMutationOrdering

**Purpose:** Verify that no plaintext state mutation or token transfer occurs before `_verifyEquality` in any function.

**CVL Pseudo-Code:**

```cvl
rule StateMutationOrdering(method f) {
    // Track calls to _verifyEquality and safeTransfer/safeTransferFrom
    bool verifyCalled = false;
    
    // Hooks track execution order
    hook CALL _verifyEquality(env e) {
        verifyCalled = true;
    }
    
    hook CALL safeTransfer(env e) {
        assert verifyCalled,
            "safeTransfer must not execute before _verifyEquality";
    }
    
    hook CALL safeTransferFrom(env e) {
        assert verifyCalled,
            "safeTransferFrom must not execute before _verifyEquality";
    }
    
    // Execute function
    env e;
    calldataarg args;
    f(e, args);
}
```

### 6.3 Rule C: ReentrancyGuardActive

**Purpose:** Verify that the `nonReentrant` modifier is active throughout the FHE→plaintext crossing (from `_verifyEquality` to `safeTransfer`).

**CVL Pseudo-Code:**

```cvl
rule ReentrancyGuardActive(method f) {
    // The _REENTERED bit (0x02) must be set during the critical section
    // _poolGuard is stored at slot 0 of FheForgeBase
    
    hook SLOAD uint256 guard BEFORE {
        // Track guard state at call boundaries
    }
    
    // Execute the function twice to test reentrancy
    env e1; calldataarg args1;
    f(e1, args1);
    
    env e2; calldataarg args2;
    f(e2, args2);
    
    // The guard must prevent reentrant calls
    assert !reentered || reverted;
}
```

---

## 7. Appendix: Background Research

### 7.1 Cited Sources

| Source | Relevance |
|---|---|
| Certora Prover Documentation (docs.certora.com) | CVL syntax, methods blocks, hooks, ghosts, invariants |
| Certora Examples Repository (github.com/Certora/Examples) | Real-world CVL specs for DeFi protocols |
| CryptoSKills Certora Skill | Practical CVL patterns: parametric rules, multi-contract verification, FHE abstraction approach |
| RareSkills Certora Book (rareskills.io) | Inductive invariants, ghost variables, hook patterns |
| Morpho Blue Formal Verification (Dec 2023) | Precedent for DeFi lending formal verification with Certora |
| HEVM Documentation (hevm.dev) | Symbolic execution for EVM, equivalence checking |
| Scribble Specification Language (docs.scribble.codes) | Runtime annotation verification language |
| DUAL_INPUT_AUDIT.md | Complete _verifyEquality call site inventory (13 sites) |
| WAVE2_REVIEW.md (MF-1, MF-6) | Elevates dual input skew to P0 finding |
| ADR-002-cofhe-fhe-integration.md | _verifyEquality design rationale and limitation documentation |
| MC-035 (MICROCHANGE_PLAN_WAVE3.md) | Tracks CoFHE ZK proof of equality implementation |

### 7.2 Industry Precedents for Certora DeFi Verification

| Protocol | Year | Properties Verified | Relevance to FheForge |
|---|---|---|---|
| **Morpho Blue** | 2023 | No under-collateralized loans, no asset double-counting, correct liquidation | Lending invariant structure directly analogous |
| **Aave** | 2022–2023 | Protocol solvency, correct interest accrual, permission checks | Multi-contract verification pattern |
| **Compound** | 2022 | cToken invariants, governance safety, liquidation math | Parametric rule patterns |
| **MakerDAO** | 2021 | Vault safety, liquidation, oracle price freshness | Ghost variable patterns for abstract state |

### 7.3 FHE-Specific Verification Challenges

1. **Opaque ciphertext comparison** — `FHE.eq` returns an `ebool` whose value is encrypted. The contract cannot directly branch on the result (no `if (FHE.eq(...))`). Instead, it uses `FHE.select` for data-dependent operations. Certora's ghost model must account for this: the result of `_verifyEquality` is either `incoming` or `_ZERO`, and the contract cannot distinguish which without decryption.

2. **Decoupled token flow** — Because `_verifyEquality`'s result only affects encrypted state, plaintext token transfers that run in parallel with it create the fundamental gap. Formal verification's strength is precisely in catching this pattern — tokens moving independently of a security gate.

3. **CoFHE runtime as trusted third party** — The correctness of `FHE.eq` itself is not verified by any of these tools. It is a dependency assumed correct at the CoFHE infrastructure level. Formal verification of FheForge verifies the *protocol logic around* FHE operations, not the FHE operations themselves.

4. **`FHE.allowTransient` and ACL model** — ACL grants (`FHE.allowThis`, `FHE.allowTransient`) are CoFHE runtime operations. Their execution is critical for cross-contract encrypted data flow (Composer → Vault/Pool). Ghost abstractions must model that downstream contracts can read verified ciphertexts.

---

*This document is a specification and analysis artifact. It does not modify any contract code. Implementation of the recommended verification approach should proceed with Certora Prover access and CVL development tooling.*
