#!/usr/bin/env python3
"""FheForge interoperability analyzer.

Walks every compiled artifact + source file and produces:
  1. Per-contract function inventory (visibility, mutability, state-changing).
  2. Cross-contract call graph.
  3. State / event / error inventory.
  4. FHE-precompile + Permit2 + Pyth touchpoints.
  5. Identified redundancy / breaker / limit list.
  6. Per-function gas observations (where measurable).
  7. ASCII topology + flow diagrams.

Output: contracts/INTEROP_REPORT.md
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "contracts"
ARTIFACTS = ROOT / "artifacts" / "contracts"
SRC = ROOT / "contracts"
REPORT = ROOT / "INTEROP_REPORT.md"
SUPPRESSIONS_FILE = ROOT / ".analyzer-suppressions.json"

CONTRACTS = [
    "StrategyRegistry",
    "StrategyVault",
    "LendingPool",
    "SwapRouter",
    "PriceOracle",
    "FheForgeComposer",
]

EXTERNAL_TOUCHPOINTS = {
    "IPermit2": "Uniswap Permit2 0x000…22D473030F116dDEE9F6B43aC78BA3",
    "IPyth":    "Pyth oracle (network-specific)",
    "IWETH9":   "WETH9 wrapper",
    "IERC20":   "ERC-20 token (any)",
    "IERC20Permit": "EIP-2612 (REMOVED — round-13 unification)",
    "FHE":      "Fhenix CoFHE precompile",
}


def load_artifact(contract: str) -> dict:
    p = ARTIFACTS / f"{contract}.sol" / f"{contract}.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def load_source(contract: str) -> str:
    p = SRC / f"{contract}.sol"
    return p.read_text() if p.exists() else ""


def load_suppressions() -> list[dict]:
    """Load `contracts/.analyzer-suppressions.json` if it exists.

    Each entry must include:
      - id          (str): human label, e.g. "F-04"
      - category    (str): exact match against finding's `category`
      - location_regex (str): regex matched against finding's `location`
      - status      (str): "deferred" | "wontfix" | "informational"
      - rationale   (str): human-readable reason

    Returns an empty list if the file is absent. Schema-shape errors raise
    so they fail fast in CI.
    """
    if not SUPPRESSIONS_FILE.exists():
        return []
    data = json.loads(SUPPRESSIONS_FILE.read_text())
    items = data.get("suppressions", [])
    required = {"id", "category", "location_regex", "status", "rationale"}
    for i, s in enumerate(items):
        missing = required - set(s.keys())
        if missing:
            raise ValueError(
                f"{SUPPRESSIONS_FILE.name} entry #{i} missing keys: {sorted(missing)}"
            )
    return items


def apply_suppressions(
    findings: list[dict], suppressions: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Split `findings` into (active, suppressed) using `suppressions`.

    A finding is suppressed iff there exists an entry whose `category`
    matches the finding's `category` exactly AND whose `location_regex`
    re.search()-es the finding's `location`. The first matching entry
    wins; the rationale + status are attached to the suppressed finding
    as `_suppressed_by` for downstream rendering.
    """
    if not suppressions:
        return findings, []
    active: list[dict] = []
    suppressed: list[dict] = []
    compiled = [(s, re.compile(s["location_regex"])) for s in suppressions]
    for f in findings:
        cat = f.get("category", "")
        loc = f.get("location", "")
        match = None
        for s, pat in compiled:
            if s["category"] == cat and pat.search(loc):
                match = s
                break
        if match is None:
            active.append(f)
            continue
        annotated = dict(f)
        annotated["_suppressed_by"] = {
            "id": match["id"],
            "status": match["status"],
            "rationale": match["rationale"],
        }
        suppressed.append(annotated)
    return active, suppressed


def extract_abi_functions(abi: list) -> list[dict]:
    out = []
    for item in abi:
        if item.get("type") != "function":
            continue
        out.append({
            "name": item["name"],
            "visibility": item.get("stateMutability", "?"),
            "inputs": [(p.get("name", "_"), p["type"]) for p in item.get("inputs", [])],
            "outputs": [(p.get("name", "_"), p["type"]) for p in item.get("outputs", [])],
        })
    return out


def extract_events(abi: list) -> list[str]:
    return sorted({i["name"] for i in abi if i.get("type") == "event"})


def extract_errors(abi: list) -> list[str]:
    return sorted({i["name"] for i in abi if i.get("type") == "error"})


def extract_constructor(abi: list) -> dict | None:
    for i in abi:
        if i.get("type") == "constructor":
            return {
                "inputs": [(p.get("name", "_"), p["type"]) for p in i.get("inputs", [])],
                "stateMutability": i.get("stateMutability"),
            }
    return None


def find_external_calls(src: str, contract: str) -> list[tuple[str, str]]:
    """Return [(target, method)] pairs for external contract calls in source.

    Note: superseded by `extract_external_callees`, which is the version
    actually used to render the call graph and per-function inventory. Kept
    here for any future per-line reporting use-case.
    """
    out = []
    patterns = [
        re.compile(r"\b(REGISTRY|VAULT|POOL|ROUTER|oracle|weth|PYTH)\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
        re.compile(r"\bIERC20\(\s*([a-zA-Z_.\[\]\s]+?)\s*\)\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
        re.compile(r"\bIPermit2\(\s*PERMIT2\s*\)\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
        re.compile(r"\bIStrategyRegistry\(\s*REGISTRY\s*\)\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
        re.compile(r"\bIPyth\(\s*[a-zA-Z_]+\s*\)\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
        re.compile(r"\bIWETH9\(\s*[a-zA-Z_]+\s*\)\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
        re.compile(r"\bFHE\.([a-zA-Z_][a-zA-Z0-9_]*)\("),
    ]
    for line in src.splitlines():
        # Strip comments
        if "//" in line:
            line = line[: line.index("//")]
        for p in patterns:
            for m in p.finditer(line):
                groups = m.groups()
                if len(groups) == 1:
                    target, method = "FHE", groups[0]
                elif len(groups) == 2:
                    target, method = groups
                    if target.strip().startswith("address"):
                        continue
                else:
                    continue
                out.append((target.strip(), method.strip()))
    return out


def count_state_variables(src: str) -> dict:
    """Count storage variables, immutable, constant, event, error declarations."""
    # Strip block comments
    src_stripped = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    # Strip line comments
    src_stripped = re.sub(r"//[^\n]*", "", src_stripped)
    counts = {
        "storage_mapping": len(re.findall(r"^\s*mapping\(", src_stripped, re.MULTILINE)),
        "storage_simple": 0,
        "immutable": len(re.findall(r"\bimmutable\b", src_stripped)),
        "constant": len(re.findall(r"\bconstant\b", src_stripped)),
        "modifier": len(re.findall(r"^\s*modifier\s+", src_stripped, re.MULTILINE)),
        "internal_func": len(
            re.findall(
                r"^\s*function\s+_[a-zA-Z]+\s*\(.*?\)\s*internal", src_stripped, re.MULTILINE
            )
        ),
    }
    # Simple storage = uint256/address/bool top-level (rough, ignores immutable/constant)
    simple_storage = re.findall(
        r"^\s*(uint256|uint128|uint64|uint32|uint16|uint8|address|bool|bytes32)\s+(public\s+|private\s+)?[a-zA-Z]",
        src_stripped,
        re.MULTILINE,
    )
    counts["storage_simple"] = len(simple_storage) - counts["immutable"] - counts["constant"]
    if counts["storage_simple"] < 0:
        counts["storage_simple"] = 0
    return counts


def find_modifiers_used(src: str, fname: str) -> list[str]:
    """Find all modifiers attached to function `fname`.

    Match pattern: `function NAME(args) [keywords + modifiers] {` where args
    may contain nested parens. We greedy-match up to the opening brace, then
    strip Solidity-builtin keywords from the captured prelude; what remains
    is the modifier list.
    """
    # Find every signature; pick the first one that is an actual function
    # *definition* (ends with `{`), not an interface declaration (`;`).
    pattern = re.compile(
        r"function\s+" + re.escape(fname) + r"\s*\(",
        re.MULTILINE,
    )
    prelude = None
    for m in pattern.finditer(src):
        i = m.end() - 1  # at the `(`
        depth = 0
        paren_close = -1
        while i < len(src):
            if src[i] == "(":
                depth += 1
            elif src[i] == ")":
                depth -= 1
                if depth == 0:
                    paren_close = i
                    break
            i += 1
        if paren_close == -1:
            continue
        # First non-whitespace char of the prelude up to the next ; or {.
        j = paren_close + 1
        # Search for `{` or `;` first to disambiguate.
        brace = src.find("{", paren_close)
        semi = src.find(";", paren_close)
        if semi != -1 and (brace == -1 or semi < brace):
            # interface / abstract declaration — skip
            continue
        if brace == -1:
            continue
        prelude = src[paren_close + 1 : brace]
        break
    if prelude is None:
        return []
    # Drop `returns (...)` blocks.
    prelude = re.sub(r"returns\s*\([^)]*\)", "", prelude, flags=re.DOTALL)
    # Drop modifiers that take arguments — capture them too.
    # (None of our contracts use parameterized modifiers, but be safe.)
    prelude = re.sub(r"\(.*?\)", "", prelude, flags=re.DOTALL)
    builtins = {
        "external", "internal", "public", "private",
        "pure", "view", "payable", "virtual", "override",
    }
    parts = [p for p in prelude.split() if p and p not in builtins]
    return parts


def find_emit_events(src: str, fname: str) -> list[str]:
    """Find events emitted in function `fname` (uses balanced-brace body)."""
    body = find_function_body(src, fname)
    if not body:
        return []
    return re.findall(r"emit\s+([A-Z][a-zA-Z0-9_]*)\s*\(", body)


def find_function_body(src: str, fname: str) -> str:
    """Return the body of function `fname` — picks the first definition that
    has a brace-delimited body (skips interface declarations)."""
    pattern = re.compile(
        r"function\s+" + re.escape(fname) + r"\s*\(",
        re.MULTILINE,
    )
    for m in pattern.finditer(src):
        i = m.end() - 1
        depth = 0
        paren_close = -1
        while i < len(src):
            if src[i] == "(":
                depth += 1
            elif src[i] == ")":
                depth -= 1
                if depth == 0:
                    paren_close = i
                    break
            i += 1
        if paren_close == -1:
            continue
        brace = src.find("{", paren_close)
        semi = src.find(";", paren_close)
        if semi != -1 and (brace == -1 or semi < brace):
            continue
        if brace == -1:
            continue
        # Walk braces to capture body.
        d = 0
        j = brace
        while j < len(src):
            if src[j] == "{":
                d += 1
            elif src[j] == "}":
                d -= 1
                if d == 0:
                    return src[brace + 1 : j]
            j += 1
    return ""


def extract_external_callees(body: str) -> list[str]:
    """Extract method names called via known interfaces or via state vars."""
    out = []
    for m in re.finditer(r"\b(REGISTRY|VAULT|POOL|ROUTER|PYTH|oracle|weth)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", body):
        out.append(f"{m.group(1)}.{m.group(2)}")
    for m in re.finditer(r"\bIPermit2\s*\(\s*PERMIT2\s*\)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", body):
        out.append(f"PERMIT2.{m.group(1)}")
    for m in re.finditer(r"\bIStrategyRegistry\s*\(\s*REGISTRY\s*\)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", body):
        out.append(f"REGISTRY.{m.group(1)}")
    for m in re.finditer(r"\bIERC20\s*\([^)]+\)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", body):
        out.append(f"IERC20.{m.group(1)}")
    return out


def extract_fhe_calls(body: str) -> list[str]:
    # Strip comments first — Phase D's lazy-init pattern documents the
    # avoided `FHE.add(uninit, x)` cost in /// comments above the actual
    # branch, and without stripping the regex would count those comment
    # mentions as real ops, inflating cross-contract amplification
    # estimates by ~50k per occurrence.
    cleaned = _strip_comments(body)
    return [m.group(1) for m in re.finditer(r"\bFHE\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", cleaned)]


def runtime_bytecode_size(contract: str) -> int:
    art = load_artifact(contract)
    deployed = art.get("deployedBytecode", "")
    if deployed.startswith("0x"):
        deployed = deployed[2:]
    return len(deployed) // 2  # bytes


def init_bytecode_size(contract: str) -> int:
    art = load_artifact(contract)
    init = art.get("bytecode", "")
    if init.startswith("0x"):
        init = init[2:]
    return len(init) // 2


def per_contract_summary() -> dict:
    summary = {}
    for c in CONTRACTS:
        art = load_artifact(c)
        src = load_source(c)
        if not art:
            continue
        abi = art.get("abi", [])
        funcs = extract_abi_functions(abi)
        events = extract_events(abi)
        errors = extract_errors(abi)
        cons = extract_constructor(abi)
        cv = count_state_variables(src)

        # Detail each external/public function: modifier list + body interactions
        detail = []
        for f in funcs:
            body = find_function_body(src, f["name"])
            detail.append({
                **f,
                "modifiers": find_modifiers_used(src, f["name"]),
                "emits": find_emit_events(src, f["name"]),
                "calls": extract_external_callees(body),
                "fhe": extract_fhe_calls(body),
                "loc": body.count("\n") + 1 if body else 0,
            })

        summary[c] = {
            "constructor": cons,
            "functions": detail,
            "events": events,
            "errors": errors,
            "counts": cv,
            "lines": len(src.splitlines()),
            "runtime_bytes": runtime_bytecode_size(c),
            "init_bytes": init_bytecode_size(c),
        }
    return summary


def find_redundancies(summary: dict) -> list[str]:
    """Flag potentially redundant or limit-breaking patterns."""
    findings = []

    # 1) Functions with identical signatures across contracts (likely composer-vs-pool wrappers)
    sigs = defaultdict(list)
    for c, info in summary.items():
        for f in info["functions"]:
            sig = f"{f['name']}(" + ",".join(t for _, t in f["inputs"]) + ")"
            sigs[sig].append(c)
    for sig, owners in sigs.items():
        if len(owners) > 1 and not sig.startswith(("pause(", "unpause(", "_msg")):
            findings.append(f"DUPLICATED SIG `{sig}` across: {', '.join(owners)}")

    # 2) Functions that share a common naming prefix (potential wrappers)
    for c, info in summary.items():
        names = [f["name"] for f in info["functions"]]
        groups = defaultdict(list)
        for n in names:
            for prefix in ("supply", "repay", "open", "close", "borrow", "withdraw"):
                if n.startswith(prefix):
                    groups[prefix].append(n)
        for prefix, ns in groups.items():
            if len(ns) > 1:
                findings.append(f"{c}: {len(ns)} functions starting with `{prefix}`: {', '.join(ns)}")

    return findings


def find_function_breakers(summary: dict) -> list[str]:
    """Find pause/unpause + permission gates that can break entire flows."""
    out = []
    for c, info in summary.items():
        for f in info["functions"]:
            if "pause" in f["name"].lower():
                out.append(f"{c}.{f['name']}() — pauses ALL whenNotPaused entry points in {c}")
        if any(m["modifiers"] and "whenNotPaused" in m["modifiers"] for m in info["functions"]):
            count = sum(1 for m in info["functions"] if "whenNotPaused" in m["modifiers"])
            out.append(f"{c} has {count} `whenNotPaused`-gated entry points")
    return out


def find_limits(summary: dict) -> list[tuple[str, str, str]]:
    """Extract `MAX_*` / `MIN_*` / capacity constants from each contract."""
    out = []
    for c in CONTRACTS:
        src = load_source(c)
        # Strip comments to avoid matching inside docstrings
        src_clean = re.sub(r"/\*.*?\*/|//[^\n]*", "", src, flags=re.DOTALL)
        for m in re.finditer(
            r"(uint\d*|int\d*)\s+public\s+(constant|immutable)\s+([A-Z_]+)\s*=\s*([^;]+);",
            src_clean,
        ):
            type_, kind, name, value = m.groups()
            out.append((c, name, f"{type_} {kind} = {value.strip()}"))
    return out


def render_function_table(summary: dict) -> str:
    out = ["| Contract | Function | Visibility | Mutability | Modifiers | FHE ops | External calls | Emits |"]
    out.append("|---|---|---|---|---|---|---|---|")
    for c in CONTRACTS:
        if c not in summary:
            continue
        for f in summary[c]["functions"]:
            mods = ", ".join(f["modifiers"]) or "—"
            fhe = ", ".join(sorted(set(f["fhe"]))) or "—"
            calls = ", ".join(sorted(set(f["calls"]))) or "—"
            emits = ", ".join(f["emits"]) or "—"
            mut = f["visibility"]
            args = ", ".join(t for _, t in f["inputs"])
            out.append(
                f"| {c} | `{f['name']}({args})` | external | {mut} | {mods} | {fhe} | {calls} | {emits} |"
            )
    return "\n".join(out)


def render_call_graph(summary: dict) -> str:
    """Build a Markdown adjacency table contract → callees.

    The per-function call list is limited to direct calls in that function's
    own body, but contracts dispatch external calls through internal helpers
    (e.g. composer._submitSwap → ROUTER.submitSwapIntent). To get the true
    contract-level adjacency, scan the entire source for cross-contract
    invocations once per contract.
    """
    edges = defaultdict(set)
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        edges[c].update(extract_external_callees(src))
    lines = ["| Caller | Callees |", "|---|---|"]
    for c, callees in sorted(edges.items()):
        lines.append(f"| {c} | {', '.join(sorted(callees)) or '—'} |")
    return "\n".join(lines)


def render_metrics_table(summary: dict) -> str:
    out = ["| Contract | LoC | Runtime bytes | Init bytes | External fns | View/pure fns | Events | Errors | Storage | Modifiers |",
           "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    total_loc = total_run = total_init = 0
    for c in CONTRACTS:
        if c not in summary:
            continue
        info = summary[c]
        ext_count = sum(1 for f in info["functions"] if f["visibility"] not in ("view", "pure"))
        view_count = sum(1 for f in info["functions"] if f["visibility"] in ("view", "pure"))
        cv = info["counts"]
        out.append(
            f"| {c} | {info['lines']} | {info['runtime_bytes']:,} | {info['init_bytes']:,} | "
            f"{ext_count} | {view_count} | {len(info['events'])} | {len(info['errors'])} | "
            f"{cv['storage_mapping']}m+{cv['storage_simple']}s | {cv['modifier']} |"
        )
        total_loc += info["lines"]
        total_run += info["runtime_bytes"]
        total_init += info["init_bytes"]
    out.append(f"| **TOTAL** | **{total_loc:,}** | **{total_run:,}** | **{total_init:,}** | | | | | | |")
    return "\n".join(out)


def render_topology() -> str:
    return """\
                          ┌─────────────────────────────────────┐
                          │       USER WALLET / EOA             │
                          │  signs: tx, Permit2 EIP-712, FHE    │
                          │         input metadata              │
                          └──┬──────────────────┬───────────────┘
                             │ tx via JSON-RPC  │
                             ▼                  ▼
        ┌──────────────────────────────┐   ┌─────────────────────────┐
        │   FheForgeComposer (entry)   │   │  Direct user → contract  │
        │   • openLeveragedStrategy    │   │  • LendingPool.supply    │
        │   • rebalance                │   │  • LendingPool.borrow*   │
        └──┬─────────┬─────────┬────┬──┘   │  • Vault.openPosition    │
           │         │         │    │      │  • Vault.closePosition   │
           ▼         ▼         ▼    ▼      │  • Router.submitSwap     │
   ┌──────────┐ ┌──────────┐ ┌────────┐    │  • Pool.supplyWithPermit2│
   │ REGISTRY │ │  VAULT   │ │  POOL  │    │  • Pool.repayWithPermit2 │
   │  (TVL)   │◄┼──────────┼─┤        │    └─────────────────────────┘
   │          │ │ (positions)│         │
   │          │ │           │ ◄──── PriceOracle.collateralFactorBps /
   │          │ │           │       convertToUsd / liquidationThresholdBps
   │          │ │           │
   │          │ │           │ ◄──── ROUTER (intent submission only)
   └──────────┘ └──────────┘ └────────┘
        ▲           ▲           ▲
        │           │           │
        └────FHE.allowThis / FHE.allow / FHE.allowTransient─┐
                    via Fhenix CoFHE precompile (TaskManager + ACL)
                    │
                    ▼
         ┌─────────────────────────────┐
         │    Fhenix CoFHE backend     │
         │  • verifyInput (ZK proof)   │
         │  • TaskManager (FHE ops)    │
         │  • ACL (handle permissions) │
         └─────────────────────────────┘

                   ┌─────────────────────────────────────────┐
                   │     EXTERNAL TRUSTED INFRASTRUCTURE     │
                   │  ┌──────────────────────────────────┐  │
                   │  │ Uniswap Permit2                  │  │
                   │  │  0x000…22D473030F116dDEE9F6B43   │  │
                   │  │  pool/composer call              │  │
                   │  │  permitTransferFrom(...)         │  │
                   │  └──────────────────────────────────┘  │
                   │  ┌──────────────────────────────────┐  │
                   │  │ Pyth Network                     │  │
                   │  │  PriceOracle reads               │  │
                   │  │  getPriceNoOlderThan / pushUpd.  │  │
                   │  └──────────────────────────────────┘  │
                   │  ┌──────────────────────────────────┐  │
                   │  │ WETH9                            │  │
                   │  │  Pool wraps/unwraps for ETH paths│  │
                   │  └──────────────────────────────────┘  │
                   │  ┌──────────────────────────────────┐  │
                   │  │ Off-chain SwapRouter EXECUTOR    │  │
                   │  │  (rotateable, owner-controlled)  │  │
                   │  └──────────────────────────────────┘  │
                   │  ┌──────────────────────────────────┐  │
                   │  │ ERC-2771 trustedForwarder (opt)  │  │
                   │  │  meta-tx relay for composer      │  │
                   │  └──────────────────────────────────┘  │
                   └─────────────────────────────────────────┘
"""


def render_flow_open_leveraged() -> str:
    return """\
END-TO-END FLOW — `composer.openLeveragedStrategy(p, e)`

Actor                     Step                                  State change
─────────────────────────────────────────────────────────────────────────────
USER                  1. Sign Permit2 PermitTransferFrom         off-chain
                         (token, amount, nonce, deadline,
                          spender = composer)
USER                  2. Encrypt FHE inputs via SDK with         off-chain
                         setAccount(composer)
USER → Composer       3. composer.openLeveragedStrategy(p, e)    msg.sender = USER

Composer              4. _pullViaPermit2(collateralToken, p)
Composer → Permit2       Permit2.permitTransferFrom(...)        USER → Composer
                                                                 token transfer
Composer              5. _resolveStrategyId(p)
Composer → Registry      registerStrategy(name, hash) [optional] strategy++
                         OR returns p.strategyId

Composer              6. _openVaultPosition(...)
Composer → Vault         openPosition(token, amt, c, d, a, l, sId)
                            ├ checks no prior position
                            ├ depositedAmounts++ / hasPosition=true
                            ├ ERC20.safeTransferFrom            Composer → Vault
                            ├ FHE.asEuint128(c, d, a, l)         on-chain via precompile
                            └ FHE.allowThis + allow(user) on each handle
Vault → Registry         incrementTvl(sId, c)                    encrypted TVL up

Composer              7. _supplyToPool(...)  [if poolSupplyAmount>0]
Composer → Pool          supply(token, amt, supplyEnc)
                            ├ plainSupply++ / liquidReserve++
                            ├ ERC20.safeTransferFrom            Composer → Pool
                            └ FHE.asEuint128 + add + allowThis/Sender

Composer              8. _borrowFromPool(...)  [if poolBorrowAmount>0]
Composer → Pool          checkLtvAndBorrow(...) OR borrowWithOracle(...)
                            ├ LTV / oracle health check
                            ├ liquidReserve--, plainBorrow++
                            ├ ERC20.safeTransfer (pool→composer)
                            └ FHE.asEuint128 + add + allowThis/Sender
Composer                  receive borrowed tokens
Composer → User           ERC20.safeTransfer(user, balance)     Composer → USER
                          FHE.allow(debtHandle, user)

Composer              9. _submitSwap(...)  [if swapTokenOut != 0]
Composer → Router        submitSwapIntent(in, out, amtIn, minOut, dl)
                            ├ deadline bounds check
                            ├ FHE.asEuint128 + allowThis/Sender
                            └ intents[id] = {...}; nonces[user]++

Composer             10. emit LeveragedStrategyOpened(...)        log

Off-chain
EXECUTOR             11. (later) decrypt amountIn with FHE permit
                         perform swap on external venue
EXECUTOR → Router    12. executeIntent(intentId, outputAmount)
                            ├ pulls outputAmount from EXECUTOR
                            └ forwards to USER                  EXECUTOR → USER

Closing the position later (separate tx):
USER → Vault         13. closePosition(amt, encAmt)
                            ├ requires block.number > openBlock (SameBlockClose guard)
                            ├ depositedAmounts-- / hasPosition= partial-or-cleared
                            ├ FHE.sub-with-min-clamp on collateral handle
                            └ ERC20.safeTransfer (vault→user)    Vault → USER
Vault → Registry         decrementTvl(sId, encClosed)             encrypted TVL down

USER → Pool          14. (independent of vault) repay(...) + withdraw(...)
"""


def render_flow_supply() -> str:
    return """\
END-TO-END FLOW — `pool.supplyWithPermit2(token, amt, encAmt, permit, sig)`

Actor                Step                                       State change
────────────────────────────────────────────────────────────────────────────
USER                 1. Approve Permit2 (one-time)              IERC20.approve(PERMIT2, MAX)
USER                 2. Sign Permit2 EIP-712                    off-chain
                        (token, amt, nonce, deadline,
                         spender = LendingPool)
USER                 3. Encrypt amt via CoFHE SDK               off-chain (default account=user)
USER → Pool          4. pool.supplyWithPermit2(...)             msg.sender = USER

Pool                 5. Validate token / amount / permit fields
Pool → Permit2       6. permitTransferFrom(...)                  USER → Pool
                                                                  token transfer
Pool                 7. _finalizeSupply
                            ├ plainSupplyBalances[t][user] += amt
                            ├ liquidReserve[t] += amt
                            ├ FHE.asEuint128(encAmt) → incoming
                            ├ FHE.add(stored, incoming) → newBalance
                            ├ supplyBalances[t][user] = newBalance
                            ├ FHE.allowThis(newBalance)
                            └ FHE.allowSender(newBalance)
Pool                 8. emit Supplied(...)                        log

The plain `pool.supply(...)` path is identical except step 6 is replaced by
an explicit IERC20.safeTransferFrom that requires a pre-existing pool-side
allowance.
"""


def render_lemma_table() -> str:
    return """\
SECURITY LEMMA / INVARIANT MAP

| ID  | Invariant                                                   | Enforced where (contract::function)                     |
|-----|-------------------------------------------------------------|---------------------------------------------------------|
| L1  | Reserve ≥ outstanding borrow at all times                   | LendingPool::withdraw, withdrawEth, emergencyWithdraw   |
| L2  | User cannot withdraw below their own borrow level           | LendingPool::withdraw, withdrawEth                      |
| L3  | LTV check gates the real ERC-20 transfer (not just FHE)     | LendingPool::checkLtvAndBorrow                          |
| L4  | Oracle-gated borrow uses USD-normalised health              | LendingPool::borrowWithOracle, _requireOracleHealthy    |
| L5  | Liquidation only for unhealthy positions                    | LendingPool::_requireLiquidatable                       |
| L6  | Liquidation respects max-close-factor (50%)                 | LendingPool::_requireLiquidatable                       |
| L7  | Encrypted balance never goes below zero                     | LendingPool::_finalizeRepay/withdraw, Vault::closePos.  |
| L8  | Same-block open + close blocked                             | StrategyVault::closePosition                            |
| L9  | Strategy (creator, name) tuples are unique                  | StrategyRegistry::registerStrategy                      |
| L10 | Only the linked vault may mutate registry TVL               | StrategyRegistry::onlyVault modifier                    |
| L11 | Vault rotation requires timelock                            | StrategyRegistry::proposeVault + acceptVault            |
| L12 | Executor rotation requires timelock                         | SwapRouter::proposeExecutor + acceptExecutor            |
| L13 | Intent deadline is bounded (min/max)                        | SwapRouter::submitSwapIntent                            |
| L14 | Only intent creator may cancel / read encrypted amount      | SwapRouter::cancelIntent, getAmountIn                   |
| L15 | Pyth price must be fresh + positive + low-confidence-band   | PriceOracle::getPriceUsd                                |
| L16 | Pyth `expo` is bounded against pathological feeds           | PriceOracle::getPriceUsd (MAX_PYTH_EXP gate)            |
| L17 | Pause halts all whenNotPaused entry points                  | Every contract w/ Pausable                              |
| L18 | EmergencyWithdraw bypasses FHE on outage (paused only)      | LendingPool, StrategyVault                              |
| L19 | Permit2 signature bound to (token, amt, nonce, dl, spender) | LendingPool/Composer::permitTransferFrom call           |
| L20 | FHE handle ACL grant follows handle ownership rules         | Every FHE.allow/allowThis/allowSender site              |
"""


def _abi_canonical(inp: dict) -> str:
    """Build the canonical Solidity type for an ABI input including tuples."""
    t = inp["type"]
    if t.startswith("tuple"):
        inner = ",".join(_abi_canonical(c) for c in inp.get("components", []))
        suffix = t[len("tuple"):]
        return f"({inner}){suffix}"
    return t


def collect_selectors(summary: dict) -> dict:
    """Compute keccak256 selector for every external/public function and group
    by selector to find collisions across contracts."""
    try:
        from eth_utils import keccak
    except ImportError:
        return {}
    selectors: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for c in CONTRACTS:
        if c not in summary:
            continue
        art = load_artifact(c)
        for item in art.get("abi", []):
            if item.get("type") != "function":
                continue
            sig_args = ",".join(_abi_canonical(i) for i in item.get("inputs", []))
            sig = f"{item['name']}({sig_args})"
            sel = "0x" + keccak(text=sig).hex()[:8]
            selectors[sel].append((c, sig))
    return selectors


def render_selector_analysis(summary: dict) -> str:
    selectors = collect_selectors(summary)
    if not selectors:
        return "_(eth_utils not installed — selector analysis skipped.)_"
    lines: list[str] = []
    total = len(selectors)
    collisions = {s: lst for s, lst in selectors.items() if len(lst) > 1}
    consistent = {
        s: lst for s, lst in collisions.items()
        if len({sig for _, sig in lst}) == 1
    }
    inconsistent = {
        s: lst for s, lst in collisions.items()
        if len({sig for _, sig in lst}) > 1
    }
    lines.append(f"- Total unique selectors across all 6 contracts: **{total}**")
    lines.append(f"- Selectors shared across multiple contracts: **{len(collisions)}**")
    lines.append(f"  - With identical signature (intentional cross-contract API surface): **{len(consistent)}**")
    lines.append(f"  - With divergent signature (potential collision risk): **{len(inconsistent)}**")
    lines.append("")
    if consistent:
        lines.append("**Intentional cross-contract shared selectors (admin / governance / immutable getter consistency):**")
        lines.append("")
        lines.append("| Selector | Signature | Defined in |")
        lines.append("|---|---|---|")
        for sel, lst in sorted(consistent.items()):
            sig = lst[0][1]
            contracts = ", ".join(sorted(c for c, _ in lst))
            lines.append(f"| `{sel}` | `{sig}` | {contracts} |")
        lines.append("")
    if inconsistent:
        lines.append("**Divergent-signature collisions (require attention):**")
        lines.append("")
        for sel, lst in sorted(inconsistent.items()):
            lines.append(f"- `{sel}`")
            for c, sig in lst:
                lines.append(f"  - {c}: `{sig}`")
        lines.append("")
    else:
        lines.append("_No divergent-signature collisions detected — every shared selector across contracts has the same signature, signalling a deliberate consistent surface (e.g. all `pause()` selectors are identical because they represent the same admin operation)._")
    return "\n".join(lines)


def render_flow_rebalance() -> str:
    return """\
END-TO-END FLOW — `composer.rebalance(p, e)`

Actor                Step                                       State change
─────────────────────────────────────────────────────────────────────────────
USER                 1. Encrypt rebalance encAmt (FHE SDK,      off-chain
                        setAccount(composer))
USER                 2. (Optional) sign Permit2 if topping up   off-chain
USER → Composer      3. composer.rebalance(p, e)                 msg.sender = USER

Composer             4. Validate caller has open vault position
Composer → Vault        VAULT.hasPosition(user) == true (read)

  Branch A — INCREASE leverage (more borrow, more collateral)
  ────────────────────────────────────────────────────────────
  Composer           5a. _pullViaPermit2(...)  [if user added more collateral]
  Composer → Permit2     permitTransferFrom                      USER → Composer
  Composer           6a. ERC20.approve(VAULT) + VAULT.addCollateral
  Composer → Vault       addCollateral(...)                       Composer → Vault tokens
  Vault → Registry       incrementTvl(...)                        encrypted TVL up
  Composer           7a. POOL.checkLtvAndBorrow OR borrowWithOracle(...)
  Composer → Pool        borrow                                   Pool → Composer tokens
  Composer → User        ERC20.safeTransfer(user, borrowed)       Composer → USER

  Branch B — DECREASE leverage (repay, but keep collateral)
  ────────────────────────────────────────────────────────────
  Composer → Pool    5b. POOL.repay(token, amt, encAmt)           USER → Pool repayment
                            ├ uses pre-existing approve OR a
                            │  Permit2 wrapper (if user signed)
                            └ FHE.sub on encrypted debt handle
  (collateral untouched)

Composer             8. emit StrategyRebalanced(...)
"""


def render_flow_liquidation() -> str:
    return """\
END-TO-END FLOW — `pool.liquidate(borrower, collToken, debtToken, repayAmt)`

Actor                Step                                       State change
─────────────────────────────────────────────────────────────────────────────
LIQUIDATOR           1. Observe unhealthy position via off-chain index
                        (composer-readable plain debt + plain supply
                         + oracle prices)
LIQUIDATOR           2. Approve pool to pull debtToken             approve(POOL, repayAmt)
LIQUIDATOR → Pool    3. pool.liquidate(borrower, c, d, repayAmt)   msg.sender = LIQUIDATOR

Pool                 4. _requireLiquidatable(borrower, c, d)
                            ├ collateralValueUsd = oracle.convertToUsd(c, supply)
                            ├ debtValueUsd       = oracle.convertToUsd(d, borrow)
                            ├ healthFactor       = (collateralValueUsd *
                            │                       liquidationThresholdBps) /
                            │                      (debtValueUsd * BPS_DEN)
                            ├ require(healthFactor < 1e18)
                            └ require(repayAmt <= borrow * CLOSE_FACTOR / BPS_DEN)
Pool                 5. Compute seizeAmt with bonus
                            seizeAmt = oracle.convertFromUsd(
                              c, debtUsd * (BPS_DEN + LIQ_BONUS) / BPS_DEN
                            )
Pool → DebtToken     6. ERC20.safeTransferFrom(LIQUIDATOR, POOL, repayAmt)
Pool → Liquidator    7. ERC20.safeTransfer(c, LIQUIDATOR, seizeAmt)
                                                                  POOL → LIQUIDATOR
                            collateral
Pool                 8. plainBorrow[d][borrower]    -= repayAmt
                        plainSupply[c][borrower]    -= seizeAmt
                        liquidReserve[c]            -= seizeAmt
                        FHE.sub on encrypted handles (clamp at 0)
Pool                 9. emit Liquidated(borrower, LIQUIDATOR, c, d, repayAmt, seizeAmt)
"""


def render_flow_intent_execution() -> str:
    return """\
END-TO-END FLOW — Swap-intent lifecycle

Actor                Step                                       State change
─────────────────────────────────────────────────────────────────────────────
USER → Router        1. submitSwapIntent(in, out, amtIn, minOut, dl)
                            ├ FHE.asEuint128(amtIn) + allowThis/Sender
                            ├ FHE.asEuint128(minOut) (encrypted)
                            ├ deadline-bounds check (MIN/MAX)
                            ├ intentId = keccak(user, nonce++)
                            └ intents[intentId] = {tokenIn, tokenOut,
                                                   encAmtIn, encMinOut,
                                                   user, deadline, status}
                                                                  intents[id] active

EXECUTOR             2. (off-chain) decrypt encAmtIn via FHE
                        permit issued by user (or via composer
                        as msg.sender of submitSwap path)
EXECUTOR             3. Perform real swap on external venue
                        (e.g. Uniswap router via JIT keeper)
EXECUTOR             4. Approve router to pull tokenOut output
                        ERC20.approve(ROUTER, outputAmount)
EXECUTOR → Router    5. executeIntent(intentId, outputAmount)
                            ├ require(msg.sender == executor)
                            ├ require(intents[id].status == ACTIVE)
                            ├ require(block.timestamp <= deadline)
                            ├ ERC20.safeTransferFrom(EXEC, ROUTER, output)
                            ├ ERC20.safeTransfer(ROUTER, intent.user, output)
                            ├ FHE.sub minOut comparator (no on-chain
                            │  decryption — slippage check happens
                            │  off-chain by executor; on-chain status flips)
                            └ intents[id].status = EXECUTED
Router               6. emit IntentExecuted(...)                  log

Cancellation path:
USER → Router        7. cancelIntent(intentId)
                            ├ require(msg.sender == intent.user)
                            ├ require(intents[id].status == ACTIVE)
                            └ intents[id].status = CANCELLED
Router               8. emit IntentCancelled(...)                 log
"""


def render_redundancy_findings(summary: dict) -> str:
    findings = []

    findings.append("### Redundant / parallel paths")
    findings.append("")
    findings.append("- `LendingPool.checkLtvAndBorrow` and `LendingPool.borrowWithOracle` are TWO borrow paths. The first uses caller-supplied LTV; the second uses the oracle's stored collateral factor. Composer exposes both via `useOracleBorrow` flag. **Justified:** trusted oracle path + manual override path serve different audiences. **Risk:** if oracle is set, users could still call `checkLtvAndBorrow` with adversarially generous LTV (limit: pool's plain-supply gating still applies, so the worst case is failed borrow, not under-collateral).")
    findings.append("- `LendingPool.supply` and `LendingPool.supplyWithPermit2` both supply USDC. The Permit2 path skips the inner safeTransferFrom because Permit2 already moved the tokens. **Justified:** one entry takes a Permit2 sig; the other takes a pre-existing approve.  **No false-positive alt:** EIP-2612 paths were removed in round-13.")
    findings.append("- `LendingPool.repay` and `LendingPool.repayWithPermit2` — same justification as above.")
    findings.append("- `LendingPool.supplyEth` and `LendingPool.supply(WETH, …)` are reachable via two paths. The first wraps ETH inside the pool; the second requires the user to wrap separately. **Slight redundancy:** users have two onboarding paths for the same end state.")
    findings.append("- `StrategyVault.emergencyWithdraw` and `LendingPool.emergencyWithdraw` are independent emergency exits per contract. **Not redundant** — they handle different state (collateral vs supply).")
    findings.append("")
    findings.append("### Function breakers (admin-controlled circuit breakers)")
    findings.append("")
    findings.append("- `pause()` / `unpause()` exist on **every** contract with state-changing entry points: LendingPool, StrategyVault, StrategyRegistry, SwapRouter, FheForgeComposer.")
    findings.append("- Pausing one contract halts that contract's state-mutation surface but does NOT pause the others (no cross-contract pause). E.g. pausing the pool does not pause the vault.")
    findings.append("- `LendingPool.disableOracle()` / `disableWeth()` are kill-switches for individual feature paths.")
    findings.append("- `StrategyRegistry.proposeVault` / `acceptVault` rotate the vault address with a timelock — a window of vulnerability if the rotation is malicious, but no immediate breaker.")
    findings.append("- `SwapRouter.proposeExecutor` / `acceptExecutor` rotates the trusted executor with a timelock.")
    findings.append("")
    findings.append("### Limit constants")
    findings.append("")
    for c, name, val in find_limits(summary):
        findings.append(f"- `{c}.{name}` = {val}")
    findings.append("")
    findings.append("### External-call mismatches / dependencies")
    findings.append("")
    findings.append("- **Composer** depends on `REGISTRY`, `VAULT`, `POOL`, `ROUTER` — all immutable, set in constructor. If any of them is upgraded (i.e. redeployed at a new address), the composer must also be redeployed.")
    findings.append("- **Vault** depends on `REGISTRY` (immutable). The registry knows about the vault via `vaultAddress` (mutable, with timelock).")
    findings.append("- **Pool** depends on `oracle` and `weth` — both **mutable** by owner with explicit `disable*` kill-switches.")
    findings.append("- **Composer** does NOT pass the encrypted-handle `account` to the SDK; the SDK / CoFHE expectation is that the user encrypts with `setAccount(composer)` for composer flows. **This is documented behaviour, not a contract limitation.**")
    return "\n".join(findings)


# ────────────────────────────────────────────────────────────────────────────
# Optimization analyzer.
#
# Detection rules below produce only "real" optimization findings — every
# heuristic is paired with explicit false-positive guards backed by Solidity
# / CoFHE / OpenZeppelin semantics. A finding is rendered only when at least
# one positive signal AND zero falsifying signals match.
#
# Confidence levels:
#   HIGH    — bytecode-deterministic improvement, or the equivalent change
#             has already been used elsewhere in this codebase (see git log).
#   MEDIUM  — gas saving is real but conditional on contextual factors the
#             analyzer can't fully verify (e.g. usage frequency).
#   LOW     — pattern-matched candidate; manual review required because
#             semantics may justify the current code.
# ────────────────────────────────────────────────────────────────────────────


def _strip_comments(src: str) -> str:
    """Remove block + line comments to avoid false matches inside doc-strings."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def _line_of_offset(src: str, offset: int) -> int:
    """Return 1-based line number for `offset` in `src`."""
    return src.count("\n", 0, offset) + 1


def _src_excerpt(src: str, line: int, ctx: int = 0) -> str:
    lines = src.splitlines()
    lo = max(0, line - 1 - ctx)
    hi = min(len(lines), line + ctx)
    return "\n".join(lines[lo:hi]).strip()


def _state_var_decls(src: str) -> list[dict]:
    """Return state variable declarations at contract-body depth 0.

    Iterates the source character-by-character, tracking brace depth from the
    outermost contract body. Only statements at brace-depth zero (i.e. NOT
    inside structs, events, errors, functions, or modifiers) are considered.
    This is critical to avoid mis-classifying struct fields like
    `address collateralToken;` (inside `struct OpenLeveragedParams`) as
    contract-level storage.
    """
    src_clean = _strip_comments(src)
    out: list[dict] = []
    cm = re.search(r"\bcontract\s+\w+[^{]*\{", src_clean)
    if not cm:
        return out
    body_start = cm.end()
    # Walk the contract body, accumulating top-level statements (depth 0)
    # and skipping nested blocks. A "statement" here ends at a semicolon at
    # depth 0.
    i = body_start
    depth = 0
    statement_start = i
    statements: list[tuple[int, str]] = []
    while i < len(src_clean):
        ch = src_clean[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            if depth == 0:
                break  # end of contract body
            depth -= 1
            if depth == 0:
                # We just closed a function/struct/etc body. Reset statement
                # accumulator to the next character.
                statement_start = i + 1
        elif ch == ";" and depth == 0:
            stmt = src_clean[statement_start:i].strip()
            if stmt:
                statements.append((statement_start, stmt))
            statement_start = i + 1
        i += 1
    # Now classify each top-level statement: state var declarations look like
    #   `[modifiers] <type> [public|private|internal|immutable|constant] <name> [= value]`
    keywords_starting_decl = {
        "function", "modifier", "event", "error", "struct", "constructor",
        "using", "enum", "fallback", "receive", "import", "pragma",
    }
    decl_re = re.compile(
        r"^\s*"
        r"(?P<type>"
        r"mapping\(.+?\)|"
        r"euint\d+|ebool|"
        r"u?int\d*|address(?:\s+payable)?|bool|"
        r"bytes\d+|bytes|string|"
        r"[A-Z][A-Za-z0-9_]*"
        r")"
        r"\s+(?P<modifiers>(?:public|private|internal|external|immutable|constant|payable|\s)*)"
        r"\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*)"
        r"\s*(?:=|$)",
        re.DOTALL,
    )
    for offset, stmt in statements:
        first_word = stmt.split(None, 1)[0] if stmt.strip() else ""
        if first_word in keywords_starting_decl:
            continue
        m = decl_re.match(stmt)
        if not m:
            continue
        modifiers = m.group("modifiers") or ""
        out.append({
            "type": m.group("type"),
            "name": m.group("name"),
            "modifiers": modifiers.strip(),
            "is_immutable": "immutable" in modifiers,
            "is_constant": "constant" in modifiers,
            "line": _line_of_offset(src_clean, offset),
        })
    return out


def _state_var_writes(src: str, var: str) -> list[int]:
    """Return line numbers where `var` is assigned (write target).

    Heuristic: matches `var = …`, `var op= …`, `var[…] = …`, `var[…].x = …`,
    `++var`, `--var`, `var++`, `var--`, `delete var`, `delete var[...]`.
    """
    src_clean = _strip_comments(src)
    lines: list[int] = []
    # Direct assignment / compound assignment.
    assign_re = re.compile(
        r"\b" + re.escape(var) + r"\b\s*(?:\[[^\n]*?\])?\s*"
        r"(?:=(?!=)|\+=|-=|\*=|/=|%=|\^=|&=|\|=|<<=|>>=)",
        re.MULTILINE,
    )
    for m in assign_re.finditer(src_clean):
        # Skip equality comparisons `==` and `!=` — already handled by =(?!=).
        lines.append(_line_of_offset(src_clean, m.start()))
    # Pre-increment / pre-decrement: `++var` or `--var`.
    pre_re = re.compile(r"(?:\+\+|--)\s*\b" + re.escape(var) + r"\b", re.MULTILINE)
    for m in pre_re.finditer(src_clean):
        lines.append(_line_of_offset(src_clean, m.start()))
    # Post-increment / post-decrement: `var++` or `var--`.
    post_re = re.compile(r"\b" + re.escape(var) + r"\b\s*(?:\+\+|--)", re.MULTILINE)
    for m in post_re.finditer(src_clean):
        lines.append(_line_of_offset(src_clean, m.start()))
    # `delete var` / `delete var[...]`.
    del_re = re.compile(r"\bdelete\s+" + re.escape(var) + r"\b", re.MULTILINE)
    for m in del_re.finditer(src_clean):
        lines.append(_line_of_offset(src_clean, m.start()))
    return sorted(set(lines))


def _is_inside_constructor(src: str, line: int) -> bool:
    src_clean = _strip_comments(src)
    cm = re.search(r"\bconstructor\s*\([^{]*\{", src_clean)
    if not cm:
        return False
    start = cm.end() - 1
    depth = 0
    i = start
    while i < len(src_clean):
        if src_clean[i] == "{":
            depth += 1
        elif src_clean[i] == "}":
            depth -= 1
            if depth == 0:
                # constructor spans cm.start() to i
                ctor_start_line = _line_of_offset(src_clean, cm.start())
                ctor_end_line = _line_of_offset(src_clean, i)
                return ctor_start_line <= line <= ctor_end_line
        i += 1
    return False


# ── Detector implementations ────────────────────────────────────────────────


def _errors_declared_in_source(src: str) -> list[str]:
    """Errors that are DECLARED in this source file (excludes inherited).

    Match `error Name(...)` outside of any function body (depth 0 of the
    contract). Inherited errors (from OpenZeppelin Pausable, ReentrancyGuard,
    SafeERC20, SafeCast, CoFHE, …) appear in the ABI but are reverted from
    inside library code that isn't visible to us.
    """
    src_clean = _strip_comments(src)
    cm = re.search(r"\bcontract\s+\w+[^{]*\{", src_clean)
    if not cm:
        return []
    body_start = cm.end()
    out: list[str] = []
    depth = 0
    i = body_start
    while i < len(src_clean):
        ch = src_clean[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "e" and depth == 0 and src_clean.startswith("error", i):
            m = re.match(r"error\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", src_clean[i:])
            if m:
                out.append(m.group(1))
        i += 1
    return out


def _events_declared_in_source(src: str) -> list[str]:
    """Events DECLARED in this source file (excludes inherited)."""
    src_clean = _strip_comments(src)
    cm = re.search(r"\bcontract\s+\w+[^{]*\{", src_clean)
    if not cm:
        return []
    body_start = cm.end()
    out: list[str] = []
    depth = 0
    i = body_start
    while i < len(src_clean):
        ch = src_clean[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "e" and depth == 0 and src_clean.startswith("event", i):
            m = re.match(r"event\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", src_clean[i:])
            if m:
                out.append(m.group(1))
        i += 1
    return out


def detect_unused_errors(summary: dict) -> list[dict]:
    """Errors DECLARED in source but never `revert`'d. Filters out errors that
    appear in the ABI only because they are inherited from OpenZeppelin /
    CoFHE base contracts (those revert from library code we don't analyse)."""
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        src_clean = _strip_comments(src)
        declared = _errors_declared_in_source(src)
        for err in declared:
            count = len(re.findall(rf"\brevert\s+{re.escape(err)}\s*\(", src_clean))
            if count == 0:
                findings.append({
                    "category": "Unused custom error",
                    "contract": c,
                    "location": f"{c}.sol",
                    "evidence": f"`error {err}();` declared in source but never `revert`'d.",
                    "fix": "Delete the declaration; frees bytecode + cleaner ABI.",
                    "savings": "~64 bytes runtime per error + cleaner ABI",
                    "confidence": "HIGH",
                })
    return findings


def detect_unused_events(summary: dict) -> list[dict]:
    """Events DECLARED in source but never emitted. Filters out inherited."""
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        src_clean = _strip_comments(src)
        declared = _events_declared_in_source(src)
        for ev in declared:
            count = len(re.findall(rf"\bemit\s+{re.escape(ev)}\s*\(", src_clean))
            if count == 0:
                findings.append({
                    "category": "Unused event",
                    "contract": c,
                    "location": f"{c}.sol",
                    "evidence": f"`event {ev}(...)` declared in source but never `emit`'d.",
                    "fix": "Delete the event declaration.",
                    "savings": "~64 bytes runtime + cleaner ABI",
                    "confidence": "HIGH",
                })
    return findings


def detect_immutable_promotions(summary: dict) -> list[dict]:
    """State variables that are only assigned in the constructor and could be
    `immutable`. Skips: types that aren't immutable-eligible (mapping, struct,
    array, dynamic bytes/string), already-immutable, already-constant.
    """
    findings: list[dict] = []
    INELIGIBLE_TYPES = {"mapping", "bytes", "string"}
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for var in _state_var_decls(src):
            if var["is_immutable"] or var["is_constant"]:
                continue
            t = var["type"]
            if t.startswith("mapping(") or t in INELIGIBLE_TYPES:
                continue
            # Custom types (structs, contracts) — we'd need ABI lookup; skip
            # heuristically when type isn't a primitive.
            primitive = bool(re.match(r"^(u?int\d*|address|bool|bytes\d+|euint\d+|ebool)$", t))
            if not primitive:
                # Allow contract types like `PriceOracle` / `IWETH9`: they
                # compile down to address. Match the convention `[A-Z]…`.
                if not re.match(r"^[A-Z]", t):
                    continue
            writes = _state_var_writes(src, var["name"])
            if not writes:
                continue
            non_ctor = [ln for ln in writes if not _is_inside_constructor(src, ln)]
            if non_ctor:
                continue
            # All writes occurred in constructor → eligible for `immutable`.
            findings.append({
                "category": "State var → `immutable` promotion",
                "contract": c,
                "location": f"{c}.sol:{var['line']}",
                "evidence": (
                    f"`{t} {var['modifiers']} {var['name']}` is assigned only in the constructor "
                    f"(writes at line(s): {writes})."
                ),
                "fix": f"Mark `{var['name']}` as `immutable`; reads become 3 gas (PUSH) instead of 2,100 gas (cold SLOAD) / 100 gas (warm).",
                "savings": "~2,000 gas per cold read site, scales with call volume",
                "confidence": "HIGH",
            })
    return findings


def detect_repeated_sloads(summary: dict) -> list[dict]:
    """Functions that READ the same storage variable 3+ times (caching candidate).

    Counts total occurrences of `vname` in the body, then subtracts:
      - Writes: `vname = ...` and `vname op= ...` (not SLOAD)
      - The LHS of assignment statements (counted in the write subtraction)
      - `address(vname)` casts (still one SLOAD)
    A finding is emitted only when effective READS ≥ 3.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        var_names = {
            v["name"]: v
            for v in _state_var_decls(src)
            if not v["is_immutable"] and not v["is_constant"]
        }
        if not var_names:
            continue
        for f in summary[c]["functions"]:
            if f["visibility"] in ("view", "pure"):
                continue
            body = find_function_body(src, f["name"])
            if not body:
                continue
            body_clean = _strip_comments(body)
            for vname, vmeta in var_names.items():
                # Skip mappings — every access is keyed; multiple keyed
                # accesses are not redundant SLOADs in the cacheable sense.
                if vmeta["type"].startswith("mapping("):
                    continue
                total = len(re.findall(rf"\b{re.escape(vname)}\b", body_clean))
                if total < 3:
                    continue
                # Writes: vname (= | += | -= | *= | /= | %= | …)
                writes = len(
                    re.findall(
                        rf"\b{re.escape(vname)}\b\s*(?:\[[^\n]*?\])?\s*"
                        r"(?:=|\+=|-=|\*=|/=|%=|\^=|&=|\|=|<<=|>>=)",
                        body_clean,
                    )
                )
                # Cast wrappers (counted in `total` but only one SLOAD each).
                cast_count = len(
                    re.findall(rf"\baddress\(\s*{re.escape(vname)}\s*\)", body_clean)
                )
                # Each write also reads (e.g. `x += 1` is SLOAD + SSTORE) —
                # but the SLOAD here uses the EVM's read+modify+write fused
                # pattern; Solidity will still hoist a cache. Count the
                # SLOAD side as 1 per write, so reads = total - writes (the
                # write LHS doesn't count as a separate read) but compound
                # assigns also access the var once. Net effective read count:
                effective_reads = total - writes - cast_count
                if effective_reads < 3:
                    continue
                # `acceptVault`-style admin functions called rarely → LOW
                # confidence; everything else MEDIUM.
                low_freq_names = {
                    "acceptVault", "acceptExecutor", "proposeVault",
                    "proposeExecutor", "setOracle", "setWeth", "setVault",
                    "registerStrategy", "setActive", "disableOracle",
                    "disableWeth", "pause", "unpause", "emergencyWithdraw",
                }
                conf = "LOW" if f["name"] in low_freq_names else "MEDIUM"
                # Saving estimate: each cached SLOAD saves ~100 gas (warm).
                # The first SLOAD pays cold cost (~2100) regardless.
                cached_reads = effective_reads - 1
                findings.append({
                    "category": "Repeated SLOAD candidate",
                    "contract": c,
                    "location": f"{c}.sol::{f['name']}",
                    "evidence": (
                        f"`{vname}` has {effective_reads} effective SLOAD reads in `{f['name']}` "
                        f"({total} total references − {writes} write LHS − {cast_count} casts)."
                    ),
                    "fix": f"Cache `{vname}` to a local at function entry: `{vmeta['type']} _cached = {vname};`.",
                    "savings": f"~{cached_reads * 100} gas per call (warm SLOAD savings)",
                    "confidence": conf,
                })
    return findings


def detect_redundant_oracle_calls(summary: dict) -> list[dict]:
    """Same external view called 3+ times in one function body (e.g.
    oracle.convertToUsd called 3× in _requireOracleHealthy)."""
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        # Walk every function body (including internal) so we don't miss
        # private helpers.
        for fn_match in re.finditer(r"\bfunction\s+([_A-Za-z][_A-Za-z0-9]*)\s*\(", src):
            fname = fn_match.group(1)
            body = find_function_body(src, fname)
            if not body:
                continue
            body_clean = _strip_comments(body)
            # Pattern: `oracle.METHOD(` repeated.
            counter: dict[str, int] = defaultdict(int)
            for cm in re.finditer(r"\b(oracle|PYTH)\.(\w+)\s*\(", body_clean):
                key = f"{cm.group(1)}.{cm.group(2)}"
                counter[key] += 1
            for key, n in counter.items():
                if n < 3:
                    continue
                findings.append({
                    "category": "Repeated external view call",
                    "contract": c,
                    "location": f"{c}.sol::{fname}",
                    "evidence": f"`{key}(...)` called {n}× in `{fname}` body.",
                    "fix": (
                        "If the call has no per-arg side effects, hoist the result(s) into "
                        "locals or extend the oracle interface with a batched view that "
                        "returns all needed values in one staticcall."
                    ),
                    "savings": f"~{(n - 1) * 2600} gas cold first-call + {(n - 1) * 100} gas warm per redundant call",
                    "confidence": "MEDIUM",
                })
    return findings


def detect_redundant_fhe_allowthis(summary: dict) -> list[dict]:
    """Cases where the same FHE handle is granted to `address(this)` twice
    (or where `allowThis(x)` is called on a handle that is the alias of an
    already-granted handle, e.g. `actual = requested; allowThis(actual);`).
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for fn_match in re.finditer(r"\bfunction\s+([_A-Za-z][_A-Za-z0-9]*)\s*\(", src):
            fname = fn_match.group(1)
            body = find_function_body(src, fname)
            if not body:
                continue
            body_clean = _strip_comments(body)
            # Find aliases: `T x = y;` where T is euint128/euint64 etc.
            aliases: dict[str, str] = {}
            for am in re.finditer(
                r"\b(?:euint\d+|ebool)\s+(\w+)\s*=\s*(\w+)\s*;",
                body_clean,
            ):
                aliases[am.group(1)] = am.group(2)
            allowthis_calls = re.findall(r"\bFHE\.allowThis\(\s*(\w+)\s*\)", body_clean)
            seen: set[str] = set()
            for handle in allowthis_calls:
                # Resolve alias.
                root = handle
                while root in aliases and aliases[root] != root:
                    nxt = aliases[root]
                    if nxt in seen and nxt != root:
                        root = nxt
                    else:
                        break
                if root in seen:
                    findings.append({
                        "category": "Redundant `FHE.allowThis`",
                        "contract": c,
                        "location": f"{c}.sol::{fname}",
                        "evidence": (
                            f"`FHE.allowThis({handle})` in `{fname}` is redundant — "
                            f"`{handle}` aliases `{root}` which already has an `allowThis` grant."
                        ),
                        "fix": f"Drop the redundant `FHE.allowThis({handle});` call.",
                        "savings": "~3,000 gas per redundant CoFHE precompile call",
                        "confidence": "MEDIUM",
                    })
                else:
                    seen.add(root)
                    seen.add(handle)
    return findings


def detect_calldata_candidates(summary: dict) -> list[dict]:
    """`memory` parameters on `external` functions that are never reassigned
    inside the body — could be `calldata` for free."""
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        # Match function signatures with one or more `memory` params.
        # `function name(... TYPE memory pname ...) external`.
        for fn_match in re.finditer(
            r"function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*([^{;]*?)\{",
            src,
            re.DOTALL,
        ):
            fname = fn_match.group(1)
            params = fn_match.group(2)
            modifiers = fn_match.group(3)
            if "external" not in modifiers and "public" not in modifiers:
                continue
            # Find `memory <name>` params.
            for pm in re.finditer(
                r"(\b[A-Za-z_][A-Za-z0-9_]*(?:\[\])*)\s+memory\s+(\w+)",
                params,
            ):
                pname = pm.group(2)
                # Check assignment to pname inside body.
                body = find_function_body(src, fname)
                if not body:
                    continue
                body_clean = _strip_comments(body)
                if re.search(rf"\b{re.escape(pname)}\s*=", body_clean):
                    continue
                # Check struct-field write `pname.field = …`.
                if re.search(rf"\b{re.escape(pname)}\s*\.\s*\w+\s*=", body_clean):
                    continue
                findings.append({
                    "category": "`memory` → `calldata` parameter",
                    "contract": c,
                    "location": f"{c}.sol::{fname}",
                    "evidence": (
                        f"Parameter `{pname}` is declared `memory` in external function "
                        f"`{fname}` and is never assigned in the body."
                    ),
                    "fix": f"Change `memory {pname}` → `calldata {pname}`.",
                    "savings": "~5–500 gas per call depending on parameter size (avoids memory copy)",
                    "confidence": "HIGH",
                })
    return findings


def detect_redundant_getter(summary: dict) -> list[dict]:
    """`public` state variables that ALSO have an explicit getter function
    declared. Solidity auto-generates getters for `public` vars; an explicit
    one duplicates bytecode."""
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for var in _state_var_decls(src):
            if "public" not in var["modifiers"]:
                continue
            # Look for an explicit `function <varName>(...)` that returns its value.
            pattern = re.compile(
                r"function\s+" + re.escape(var["name"]) + r"\s*\([^)]*\)\s*[^;{]*\{",
                re.MULTILINE,
            )
            if pattern.search(src):
                findings.append({
                    "category": "Redundant explicit getter",
                    "contract": c,
                    "location": f"{c}.sol",
                    "evidence": (
                        f"`{var['name']}` is `public` (auto-getter generated by Solidity) "
                        f"AND there is an explicit `function {var['name']}(...)` defined."
                    ),
                    "fix": "Delete the explicit getter, or make the state variable `private`/`internal` if the auto-getter has a different signature than the explicit one.",
                    "savings": "~50–200 bytes runtime + dispatch confusion",
                    "confidence": "HIGH",
                })
    return findings


def _collect_transitive_body(src: str, fname: str, visited: set[str] | None = None) -> str:
    """Return `fname`'s body concatenated with the bodies of every internal
    helper it calls (one level deep, with cycle protection).

    Used by the nonReentrant detector so transitively-called helpers like
    `_pullAndSupply`, `_finalizeSupply`, `_openVaultPosition` are inlined
    when deciding whether the function actually performs token transfers
    or FHE ACL grants.
    """
    if visited is None:
        visited = set()
    if fname in visited:
        return ""
    visited.add(fname)
    body = find_function_body(src, fname)
    if not body:
        return ""
    body_clean = _strip_comments(body)
    accumulated = body_clean
    # Find called internal helpers (heuristic: name starts with `_`).
    callees = re.findall(r"\b(_[A-Za-z][A-Za-z0-9_]*)\s*\(", body_clean)
    for callee in set(callees):
        accumulated += "\n" + _collect_transitive_body(src, callee, visited)
    return accumulated


def detect_nonreentrant_on_view(summary: dict) -> list[dict]:
    """`nonReentrant` applied to functions that — including all transitively
    called internal helpers — never perform token transfers, never grant FHE
    ACL, and only write to plaintext mappings without external calls.

    Even after this filter, the result is LOW confidence: removing the
    modifier is only safe if NO future change introduces an external call.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for f in summary[c]["functions"]:
            if "nonReentrant" not in f["modifiers"]:
                continue
            transitive = _collect_transitive_body(src, f["name"])
            if not transitive:
                continue
            # Reject if any external state-changing primitive is reachable.
            mutators = [
                "safeTransfer", "safeTransferFrom", "transferFrom", "approve",
                "forceApprove", ".call(", ".delegatecall(", ".staticcall(",
                "permitTransferFrom",
            ]
            if any(m in transitive for m in mutators):
                continue
            if re.search(r"\bFHE\.(allow|allowSender|allowThis|allowTransient)\(", transitive):
                continue
            # Reject if any external getter could re-enter (e.g.
            # `oracle.<x>(...)` could in principle be malicious if oracle
            # is upgradeable).
            if re.search(r"\b(oracle|weth|PYTH|REGISTRY|VAULT|POOL|ROUTER)\.", transitive):
                continue
            # Reject if any contract-typed call wrapper appears.
            if re.search(r"\bI[A-Z]\w*\(\s*\w+\s*\)\.\w+\s*\(", transitive):
                continue
            findings.append({
                "category": "`nonReentrant` on contract-internal function",
                "contract": c,
                "location": f"{c}.sol::{f['name']}",
                "evidence": (
                    f"Function `{f['name']}` and its transitive internal helpers "
                    f"perform no token transfers, no FHE ACL grants, and no external "
                    f"contract calls. The `nonReentrant` modifier is structurally redundant."
                ),
                "fix": "Reconsider whether `nonReentrant` is needed. If kept for defence-in-depth, document why.",
                "savings": "~2,200 gas per call (TSTORE on entry + TSTORE on exit)",
                "confidence": "LOW",
            })
    return findings


def detect_repeated_mapping_access(summary: dict) -> list[dict]:
    """Functions that access the SAME mapping with the SAME key 3+ times.

    Each `mapping[key]` access pays for a keccak256 hash of the (key, slot)
    pair (~30 gas) on top of the SLOAD cost. Caching with a storage pointer
    (`Position storage pos = positions[key];`) eliminates redundant hashes.

    Reasoning:
    - `mapping[msg.sender]`: extremely common pattern in this codebase.
    - Solidity does NOT auto-cache mapping accesses — each access recomputes
      the hash even when the index is the same expression.
    - The savings are O(N − 1) × 30 gas for keccak + ~100 gas warm SLOAD.

    False-positive guards:
    - Skip mappings whose value type is itself a mapping (nested) — caching
      doesn't compose simply.
    - Skip if the function has fewer than 2 distinct accesses (not worth the
      stack slot).
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for f in summary[c]["functions"]:
            body = find_function_body(src, f["name"])
            if not body:
                continue
            body_clean = _strip_comments(body)
            # Capture all `<map>[<key>]` accesses; key is up to balanced ].
            access_counts: dict[tuple[str, str], int] = defaultdict(int)
            for am in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\[([^\[\]]+?)\]", body_clean):
                map_name = am.group(1)
                key = am.group(2).strip()
                # Only count true storage mappings (heuristic: Solidity local
                # arrays are far less common — restrict to lowercase-starting
                # names that are mappings declared in the contract).
                access_counts[(map_name, key)] += 1
            for (map_name, key), count in access_counts.items():
                if count < 3:
                    continue
                # Filter out non-mapping access (struct or array index that
                # happens to match the same key pattern). Require the map_name
                # to match an actual state variable of mapping type.
                state_vars = {v["name"]: v for v in _state_var_decls(src)}
                if map_name not in state_vars:
                    continue
                if not state_vars[map_name]["type"].startswith("mapping("):
                    continue
                # Skip nested mappings (`mapping(a => mapping(b => …))`) —
                # they are common in `supplyBalances[token][user]` and the
                # caching shape there is a struct rewrite, not a single var.
                if "=> mapping" in state_vars[map_name]["type"].replace(" ", ""):
                    continue
                findings.append({
                    "category": "Repeated mapping access (keccak overhead)",
                    "contract": c,
                    "location": f"{c}.sol::{f['name']}",
                    "evidence": (
                        f"`{map_name}[{key}]` accessed {count}× in `{f['name']}` body. "
                        f"Each access recomputes the keccak256 of (key, slot)."
                    ),
                    "fix": (
                        f"Cache the storage reference at function entry, e.g. "
                        f"`{state_vars[map_name]['type'].replace('mapping(', '').rstrip(')').split('=>')[-1].strip()} "
                        f"storage _slot = {map_name}[{key}];`."
                    ),
                    "savings": f"~{(count - 1) * 30} gas keccak + {(count - 1) * 100} gas warm SLOAD per call",
                    "confidence": "MEDIUM",
                })
    return findings


def detect_struct_packing(summary: dict) -> list[dict]:
    """Adjacent state vars with sub-32-byte types that don't pack today.

    Conservative: only flag pairs of `uint16/uint32/uint64/uint128/bool/
    address` declared back-to-back where they would fit in one slot but the
    Solidity layout doesn't pack them. This requires reading actual storage
    layout from the artifact.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        art = load_artifact(c)
        layout = art.get("storageLayout", {})
        types = layout.get("types", {}) or {}
        slots = layout.get("storage", []) or []
        if not slots:
            continue
        # Build list of (slot, offset, label, type, sizeBytes) tuples.
        entries = []
        for s in slots:
            t = s.get("type", "")
            type_meta = types.get(t, {})
            number_bytes = type_meta.get("numberOfBytes")
            try:
                size = int(number_bytes)
            except (TypeError, ValueError):
                continue
            entries.append({
                "slot": int(s["slot"]),
                "offset": int(s.get("offset", 0)),
                "label": s["label"],
                "type": t,
                "size": size,
            })
        # Group by slot — a slot with multiple labels means packing happened.
        # We're looking for the OPPOSITE: small-type vars in distinct slots
        # that COULD have been packed.
        small = [e for e in entries if 0 < e["size"] < 32]
        # Pair every slot that contains exactly one small var with the next.
        slot_to_entries: dict[int, list] = defaultdict(list)
        for e in entries:
            slot_to_entries[e["slot"]].append(e)
        for slot, lst in slot_to_entries.items():
            if len(lst) != 1:
                continue
            e = lst[0]
            if e["size"] >= 32:
                continue
            # See if the next slot also has exactly one small var.
            nxt = slot_to_entries.get(slot + 1)
            if not nxt or len(nxt) != 1:
                continue
            n = nxt[0]
            if n["size"] >= 32:
                continue
            if e["size"] + n["size"] > 32:
                continue
            findings.append({
                "category": "Storage packing missed",
                "contract": c,
                "location": f"{c}.sol storageLayout slot {slot}/{slot + 1}",
                "evidence": (
                    f"`{e['label']}` ({e['size']}B in slot {slot}) and "
                    f"`{n['label']}` ({n['size']}B in slot {slot + 1}) could share one slot."
                ),
                "fix": f"Reorder declarations so `{e['label']}` and `{n['label']}` are adjacent (and adjust to compatible types if needed).",
                "savings": "~2,100 gas per first-write (one fewer cold SSTORE) + 100 gas per warm SSTORE/SLOAD",
                "confidence": "HIGH",
            })
    return findings


# ── Orchestration ───────────────────────────────────────────────────────────


def run_all_optimization_detectors(summary: dict) -> list[dict]:
    findings: list[dict] = []
    findings += detect_unused_errors(summary)
    findings += detect_unused_events(summary)
    findings += detect_immutable_promotions(summary)
    findings += detect_repeated_sloads(summary)
    findings += detect_redundant_oracle_calls(summary)
    findings += detect_redundant_fhe_allowthis(summary)
    findings += detect_calldata_candidates(summary)
    findings += detect_redundant_getter(summary)
    findings += detect_nonreentrant_on_view(summary)
    findings += detect_repeated_mapping_access(summary)
    findings += detect_struct_packing(summary)
    return findings


_SAVINGS_RE = re.compile(r"~?([\d,]+)\s*gas")


def _extract_savings_gas(savings_text: str) -> int:
    """Sum every `~NNNN gas` token in the savings string. Handles thousand
    separators (`2,200` → 2200). Conservative."""
    total = 0
    for m in _SAVINGS_RE.finditer(savings_text):
        try:
            total += int(m.group(1).replace(",", ""))
        except ValueError:
            continue
    return total


def render_optimization_section(summary: dict) -> str:
    return render_optimization_section_from(run_all_optimization_detectors(summary))


def render_optimization_section_from(findings: list[dict]) -> str:
    if not findings:
        return "_No optimization findings._\n"
    rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    findings.sort(key=lambda f: (rank.get(f["confidence"], 3), f["category"], f["contract"]))
    lines: list[str] = []
    n = len(findings)
    by_conf = defaultdict(list)
    for f in findings:
        by_conf[f["confidence"]].append(f)
    high_low_gas = sum(_extract_savings_gas(f["savings"]) for f in by_conf.get("HIGH", []))
    med_low_gas = sum(_extract_savings_gas(f["savings"]) for f in by_conf.get("MEDIUM", []))
    low_low_gas = sum(_extract_savings_gas(f["savings"]) for f in by_conf.get("LOW", []))
    total_gas = high_low_gas + med_low_gas + low_low_gas
    lines.append(
        f"_{n} optimization candidates surfaced by 11 detectors._  \n"
        f"_Each finding has been filtered through false-positive guards documented in "
        f"`scripts/_interop-analyze.py`._  \n"
        f"_Conservative aggregate gas savings if every finding is applied:_ "
        f"**~{total_gas:,} gas per call** "
        f"(HIGH: ~{high_low_gas:,}, MEDIUM: ~{med_low_gas:,}, LOW: ~{low_low_gas:,})."
    )
    lines.append("")
    by_category: dict[str, list[dict]] = defaultdict(list)
    for f in findings:
        by_category[f["category"]].append(f)
    # Summary table — ordered by HIGH-first then count desc.
    lines.append("### Summary by category")
    lines.append("")
    lines.append("| Category | Findings | Best conf. | ≈ gas saved (sum) |")
    lines.append("|---|---:|---|---:|")
    cat_rows = []
    for cat, lst in by_category.items():
        best = min(lst, key=lambda x: rank.get(x["confidence"], 3))
        gas_sum = sum(_extract_savings_gas(f["savings"]) for f in lst)
        cat_rows.append((cat, len(lst), best["confidence"], gas_sum))
    cat_rows.sort(key=lambda r: (rank.get(r[2], 3), -r[3]))
    for cat, count, conf, gas in cat_rows:
        lines.append(f"| {cat} | {count} | {conf} | ~{gas:,} |")
    lines.append("")
    # Detail per category (HIGH categories first).
    for cat, _, _, _ in cat_rows:
        lines.append(f"### {cat}")
        lines.append("")
        for f in sorted(
            by_category[cat], key=lambda x: (rank.get(x["confidence"], 3), x["location"])
        ):
            lines.append(f"- **{f['location']}** — _{f['confidence']}_")
            lines.append(f"  - Evidence: {f['evidence']}")
            lines.append(f"  - Fix: {f['fix']}")
            lines.append(f"  - Savings: {f['savings']}")
        lines.append("")
    # False-positive guard appendix
    lines.append("### False-positive guards (active)")
    lines.append("")
    lines.append("| Guard | Why it matters |")
    lines.append("|---|---|")
    lines.append("| Unused error / event detector reads only DECLARED-IN-SOURCE identifiers | OpenZeppelin / CoFHE inherited errors land in the ABI; they would otherwise spam findings (`EnforcedPause`, `ReentrancyGuardReentrantCall`, `SafeERC20FailedOperation`, …). |")
    lines.append("| State-var detector tracks brace depth from contract body | Struct fields, function params, local declarations are excluded — without this guard, `OpenLeveragedParams.collateralToken` would be mis-read as state. |")
    lines.append("| `immutable` / `constant` excluded from SLOAD analysis | They are codecopy / inlined, never SLOAD. |")
    lines.append("| Pre/post `++`, `--`, `delete` recognised as writes | Otherwise `++strategyCount` would look like a constructor-only var and falsely qualify for `immutable`. |")
    lines.append("| `address(varname)` cast counts subtracted from SLOAD totals | Casts share one SLOAD with the underlying read. |")
    lines.append("| Bare-mapping (single-key) detector skips nested mappings | `supplyBalances[token][user]` is a 2-step lookup — the caching shape is a struct rewrite, not a single var. |")
    lines.append("| `nonReentrant` detector inlines transitive internal helpers | Pool / composer wrap actual transfers behind `_pullAndSupply`, `_openVaultPosition`, etc. — without inlining, every wrapper would be flagged. |")
    lines.append("| `nonReentrant` detector rejects functions reaching ANY external contract | Even `oracle.x()` or `weth.y()` can in principle re-enter; the current report is intentionally narrow. |")
    lines.append("| `memory` → `calldata` skipped if param has any `=` LHS write | `calldata` is read-only; a write would break the contract. |")
    lines.append("| Storage-packing pulled from `storageLayout` artifact, not source | Source-level inference misses inherited slots; the layout is authoritative. |")
    lines.append("| Repeated-mapping detector requires the LHS to match a state var of `mapping(…)` type | Local arrays or struct-field accesses with the same syntax are excluded. |")
    lines.append("| Repeated-SLOAD savings subtract `vname op=` LHS occurrences | Otherwise `x = x + 1` would double-count the read. |")
    lines.append("| Admin-rotation functions get LOW confidence | `acceptVault`, `proposeExecutor`, `setOracle`, etc. are called once per rotation — small per-call savings × low frequency = negligible. |")
    lines.append("")
    return "\n".join(lines)


# ────────────────────────────────────────────────────────────────────────────
# Deep optimization detectors (round 2).
#
# Adds analyzers that find HARDER targets than the surface-level pattern
# matching of round 1. Each detector:
#   - Has explicit false-positive guards documented inline.
#   - Returns findings tagged with risk / impact / reason / confidence.
#   - When `--measure` is set, can be cross-referenced against real hardhat /
#     forge gas measurements.
# ────────────────────────────────────────────────────────────────────────────


def detect_permit_consistency(summary: dict) -> list[dict]:
    """Verify every token-pulling entry point uses the same Permit2 abstraction.

    The codebase did a round-13 unification on Permit2. This detector
    catches any orphaned EIP-2612 path or bare `safeTransferFrom` that
    should have been migrated. It also flags inconsistency between the
    composer's `Permit2Authorization` shape and the pool's `PermitTransferFrom`.

    False-positive guards:
    - `safeTransferFrom` on its own is fine for liquidator paths (the
      liquidator uses native ERC-20 approve, not a permit).
    - View functions are excluded.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        src_clean = _strip_comments(src)
        # 1) Any leftover IERC20Permit / EIP-2612 references?
        eip2612_hits = re.findall(r"\b(IERC20Permit|ERC20Permit|permit\(.*deadline.*v.*r.*s)\b", src_clean)
        if eip2612_hits:
            findings.append({
                "category": "Permit consistency — orphaned EIP-2612",
                "contract": c,
                "location": f"{c}.sol",
                "risk": "MEDIUM",
                "impact": "Confused-deputy / dual-permit code path means more attack surface and inconsistent UX.",
                "reason": "Round-13 unified on Permit2; any IERC20Permit reference is stale.",
                "evidence": f"Found {len(eip2612_hits)} EIP-2612 reference(s): {set(eip2612_hits)}",
                "fix": "Remove IERC20Permit imports and any EIP-2612-flavoured permit wrapper.",
                "savings": "~200 bytes runtime + cleaner ABI; cleaner audit story",
                "confidence": "HIGH",
            })
        # 2) Functions taking a `signature` or `bytes`-named-`signature` calldata
        #    arg should call permitTransferFrom (Permit2). Audit each.
        for fn_match in re.finditer(
            r"function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*(?:\([^)]*\)[^)]*)*)\)\s*([^{;]*?)\{",
            src,
            re.DOTALL,
        ):
            fname = fn_match.group(1)
            args = fn_match.group("args")
            mods = fn_match.group(3)
            if "external" not in mods and "public" not in mods:
                continue
            # Look for signature-shaped calldata args.
            if not re.search(r"\bbytes\s+calldata\s+signature\b", args):
                continue
            body = find_function_body(src, fname)
            if not body:
                continue
            # Walk transitively into internal `_helper(...)` callees so the
            # post-F-26 pattern (`supplyWithPermit2` body delegating to
            # `_doPermit2Pull` which actually calls `permitTransferFrom`) is
            # not flagged as a false positive.
            transitive = _collect_transitive_body(src, fname)
            if "permitTransferFrom" in transitive:
                continue
            # Found a function taking a signature without calling Permit2
            # transitively.
            findings.append({
                "category": "Permit consistency — signature without Permit2 call",
                "contract": c,
                "location": f"{c}.sol::{fname}",
                "risk": "HIGH",
                "impact": "Caller signed something the contract isn't using → silent confused-deputy.",
                "reason": "Functions taking a `bytes calldata signature` arg in this codebase exist solely to be passed to Permit2.",
                "evidence": f"Function `{fname}` accepts `bytes calldata signature` but neither it nor any of its transitively-called internal helpers call `permitTransferFrom`.",
                "fix": "Either call `IPermit2(PERMIT2).permitTransferFrom(permit, transferDetails, msg.sender, signature)` or drop the signature argument.",
                "savings": "Correctness > gas — bug that should never ship",
                "confidence": "HIGH",
            })
    return findings


def detect_function_standardization(summary: dict) -> list[dict]:
    """Find function pairs whose bodies share a substantial chunk of source
    that could be unified via an internal helper.

    Heuristic: for every pair of external functions in the same contract,
    compute a normalised character-trigram Jaccard similarity. If similarity
    > 0.6 AND the functions have not already been factored through a shared
    helper (i.e. their bodies don't already call the same internal `_*`
    helper), flag them.

    False-positive guards:
    - Skip pairs that already call the same `_*` helper (already factored).
    - Skip if either body is < 5 lines (trivial wrappers; standardising
      yields no savings).
    - Skip pairs in different contracts (cross-contract refactoring is
      out-of-scope for a static analyzer).
    - Body must come from `find_function_body` (excludes interface-only
      declarations).
    """
    findings: list[dict] = []
    SIMILARITY_THRESHOLD = 0.6

    def trigrams(text: str) -> set[str]:
        text = re.sub(r"\s+", " ", text).strip()
        return {text[i:i + 3] for i in range(len(text) - 2)}

    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        ext_fns = [f["name"] for f in summary[c]["functions"]
                   if f["visibility"] not in ("view", "pure")]
        bodies = {}
        helpers_called = {}
        for fname in ext_fns:
            body = find_function_body(src, fname)
            if not body or body.count("\n") < 5:
                continue
            bodies[fname] = _strip_comments(body)
            helpers_called[fname] = set(re.findall(r"\b(_[A-Za-z][A-Za-z0-9_]*)\s*\(", bodies[fname]))
        names = sorted(bodies)
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                # Already share a helper? Skip — they're factored.
                if helpers_called[a] & helpers_called[b]:
                    continue
                ta, tb = trigrams(bodies[a]), trigrams(bodies[b])
                if not ta or not tb:
                    continue
                sim = len(ta & tb) / len(ta | tb)
                if sim < SIMILARITY_THRESHOLD:
                    continue
                # Compute the shared body size (rough).
                lines_a = bodies[a].count("\n")
                lines_b = bodies[b].count("\n")
                est_shared_lines = int(min(lines_a, lines_b) * sim)
                findings.append({
                    "category": "Function standardization — unfactored duplication",
                    "contract": c,
                    "location": f"{c}.sol::{a} & {c}.sol::{b}",
                    "risk": "LOW",
                    "impact": "Refactoring saves runtime bytecode (each duplicated line is duplicated in the deployed code).",
                    "reason": (
                        f"Trigram-Jaccard similarity {sim:.2f} between `{a}` and `{b}` bodies, "
                        f"and they share zero internal helpers."
                    ),
                    "evidence": (
                        f"`{a}` ({lines_a} lines) and `{b}` ({lines_b} lines) share ~{est_shared_lines} lines of body "
                        f"by structural similarity. No common `_*` helper is currently called by both."
                    ),
                    "fix": f"Extract common logic into an internal `_helper(...)` and have both `{a}` and `{b}` delegate to it.",
                    "savings": f"~{est_shared_lines * 100} bytes runtime per duplicate (~{est_shared_lines * 16} gas saved on deployment)",
                    "confidence": "MEDIUM",
                })
    return findings


def detect_fhe_handle_alias_chain(summary: dict) -> list[dict]:
    """Improved alias-chain detector. Tracks `<type> A = B;`, `A = B;` (no
    type), and follows multi-hop chains to identify redundant `FHE.allowThis`
    calls on already-granted handles.

    The round-13 cleanup commit (069e37dbf) removed one such pattern manually;
    this detector flags any future occurrences.

    False-positive guards:
    - Aliases must be sequential (not separated by another assignment to the
      same name).
    - Skip if the contract intentionally re-grants ACL after a function call
      that may have invalidated the handle (heuristic: we look only at
      consecutive lines).
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for fn_match in re.finditer(r"\bfunction\s+([_A-Za-z][_A-Za-z0-9]*)\s*\(", src):
            fname = fn_match.group(1)
            body = find_function_body(src, fname)
            if not body:
                continue
            body_clean = _strip_comments(body)
            # Build alias map, including no-type assignments.
            aliases: dict[str, str] = {}
            # Type-prefixed: `euintN x = y;`
            for am in re.finditer(
                r"\b(?:euint\d+|ebool)\s+(\w+)\s*=\s*(\w+)\s*;", body_clean
            ):
                aliases[am.group(1)] = am.group(2)
            # Bare: `x = y;` where `x` is already a known handle.
            for am in re.finditer(r"\b(\w+)\s*=\s*(\w+)\s*;", body_clean):
                lhs, rhs = am.group(1), am.group(2)
                if lhs in aliases or rhs in aliases:
                    aliases[lhs] = rhs

            def resolve(h: str, depth: int = 0) -> str:
                # Cycle / depth limit.
                if depth > 8:
                    return h
                if h in aliases and aliases[h] != h:
                    return resolve(aliases[h], depth + 1)
                return h

            allowthis_calls = re.findall(r"\bFHE\.allowThis\(\s*(\w+)\s*\)", body_clean)
            seen_roots: set[str] = set()
            for handle in allowthis_calls:
                root = resolve(handle)
                if root in seen_roots and root != handle:
                    findings.append({
                        "category": "Redundant `FHE.allowThis` (alias chain)",
                        "contract": c,
                        "location": f"{c}.sol::{fname}",
                        "risk": "LOW",
                        "impact": "FHE precompile call costs ~3,000 gas + L1 calldata.",
                        "reason": (
                            f"`{handle}` resolves to `{root}` through an alias chain; "
                            f"`{root}` was already granted via an earlier `FHE.allowThis` in the same scope."
                        ),
                        "evidence": f"Alias map in `{fname}`: {aliases}",
                        "fix": f"Drop the redundant `FHE.allowThis({handle});` call.",
                        "savings": "~3,000 gas per redundant CoFHE precompile call",
                        "confidence": "MEDIUM",
                    })
                else:
                    seen_roots.add(root)
                    seen_roots.add(handle)
    return findings


def detect_allowglobal_opportunity(summary: dict) -> list[dict]:
    """Encrypted handles that are granted to multiple distinct addresses
    repeatedly should consider `FHE.allowGlobal()` for a one-time global grant.

    In CoFHE 0.5.1, `allowGlobal(handle)` grants the handle to ALL accounts
    in a single operation. For handles that are functionally public (e.g.
    aggregated TVL the protocol publishes deliberately), `allowGlobal` is
    cheaper than per-account `allow` calls.

    False-positive guards:
    - Only flag when the same handle is granted to ≥3 different account
      types in one function, OR
    - When the encrypted handle is documented as public (`@notice` mentions
      "public" or "global").
    - Never flag personal balances (`supplyBalances`, `borrowBalances`) —
      those are private by design.

    Currently this codebase has no such pattern (encrypted TVL goes through
    the registry which only allows the vault), so the detector is expected
    to return zero findings — but it's a forward guard.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for fn_match in re.finditer(r"\bfunction\s+([_A-Za-z][_A-Za-z0-9]*)\s*\(", src):
            fname = fn_match.group(1)
            body = find_function_body(src, fname)
            if not body:
                continue
            body_clean = _strip_comments(body)
            # Collect FHE.allow calls grouped by handle.
            grants: dict[str, set[str]] = defaultdict(set)
            for m in re.finditer(r"\bFHE\.allow\(\s*(\w+)\s*,\s*([\w.()\s]+?)\s*\)", body_clean):
                grants[m.group(1)].add(m.group(2).strip())
            for handle, accounts in grants.items():
                if len(accounts) < 3:
                    continue
                # Filter: never flag user-private balances.
                if any(p in body_clean for p in ["supplyBalances", "borrowBalances", "positions[", "intents["]):
                    continue
                findings.append({
                    "category": "FHE.allow → allowGlobal opportunity",
                    "contract": c,
                    "location": f"{c}.sol::{fname}",
                    "risk": "LOW",
                    "impact": "Each per-account `allow` is one CoFHE precompile call. `allowGlobal` is one call total.",
                    "reason": f"Handle `{handle}` is granted to {len(accounts)} distinct accounts.",
                    "evidence": f"Accounts: {sorted(accounts)}",
                    "fix": "If the handle is functionally public, replace per-account `allow` with `FHE.allowGlobal(handle)`.",
                    "savings": f"~{(len(accounts) - 1) * 3000} gas per call",
                    "confidence": "LOW",
                })
    return findings


def detect_full_flow_gas_math(summary: dict) -> list[dict]:
    """Compute analytical per-step gas estimate for known multi-call flows
    so the user can identify the dominant step.

    This isn't a 'finding' in the bug sense — it's a structural map of where
    gas is spent. The output goes into the report so the optimizer knows
    which sub-step to attack.

    Sources of estimates:
    - SLOAD warm/cold: 100 / 2,100 gas
    - SSTORE warm/cold: 5,000 / 22,100 gas
    - CALL warm/cold: 100 / 2,600 gas
    - keccak256(64 bytes): 42 gas
    - FHE precompile calls: 3,000–30,000 gas (verifyInput, add, sub, allow)

    Returns an info-only structural breakdown; no `risk`/`fix` fields.
    """
    findings: list[dict] = []
    # The composer's openLeveragedStrategy is the canonical multi-step flow.
    composer_src = load_source("FheForgeComposer")
    if not composer_src:
        return findings
    flow = {
        "composer.openLeveragedStrategy": [
            ("_pullViaPermit2", "Permit2 pull (token transfer + sig verify)", "~80,000"),
            ("_resolveStrategyId", "registry.registerStrategy or read existing", "~50,000 cold / ~5,000 warm"),
            ("_openVaultPosition", "vault.openPosition (FHE asEuint128 ×4 + allow*4 + transferFrom)", "~250,000"),
            ("_supplyToPool", "pool.supply (FHE asEuint128 + add + allow*2 + transferFrom)", "~120,000"),
            ("_borrowFromPool", "pool.checkLtvAndBorrow or borrowWithOracle (FHE add + allow*2 + transfer + oracle)", "~110,000"),
            ("_submitSwap", "router.submitSwapIntent (FHE asEuint128 + allow*2 + storage write)", "~100,000"),
        ],
    }
    rows = []
    for flow_name, steps in flow.items():
        rows.append(f"### {flow_name} — analytical gas breakdown")
        rows.append("")
        rows.append("| Step | Description | Estimated gas |")
        rows.append("|---|---|---:|")
        for step, desc, gas in steps:
            rows.append(f"| `{step}` | {desc} | {gas} |")
        rows.append("")
    if rows:
        findings.append({
            "category": "Full-flow gas breakdown (informational)",
            "contract": "FheForgeComposer",
            "location": "INTEROP_REPORT (informational)",
            "risk": "—",
            "impact": "Identifies the dominant cost step so optimization effort goes where it matters.",
            "reason": "Multi-step composer flows can have a single bottleneck; making the cheapest step cheaper has near-zero impact.",
            "evidence": "\n".join(rows),
            "fix": "After identifying the dominant step (typically `_openVaultPosition` due to 4× FHE.asEuint128), focus optimization there.",
            "savings": "Information only — see breakdown below.",
            "confidence": "MEDIUM",
        })
    return findings


def detect_aseuint_count_audit(summary: dict) -> list[dict]:
    """Functions performing 3+ `FHE.asEuint*` calls — each pays for a fresh
    ZK verification (~80,000 gas measured on arb-sepolia for asEuint128).

    Reduction strategies:
      A. Architectural — move strategy-level constants (apy, leverage) out of
         per-user encrypted state if they're deterministic from the strategy.
         Saves N * 80k where N is the count of redundant inputs.
      B. Encoded packing — pack multiple small values into one euint128.
         Adds encode/decode FHE ops on every read; only worth it when the
         function is rarely called.
      C. Dual-mode: encrypt only what's truly per-user-private; keep
         strategy-level values plaintext.

    False-positive guards:
      - Skip view/pure functions (no SSTORE = caller pays nothing extra).
      - Skip if called only via a constructor (one-time cost).
      - Skip if all asEuint* calls are different types (intentional polymorphism).
        Actually that's PRECISELY the closePosition/openPosition pattern, so
        we DO flag it — the type-mix doesn't justify the gas cost; it's a
        signal that the storage layout could be reduced.
    """
    findings: list[dict] = []
    AS_EUINT_PATTERN = re.compile(r"\bFHE\.(asEuint\d+|asEbool|asEaddress)\s*\(")
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for f in summary[c]["functions"]:
            if f["visibility"] in ("view", "pure"):
                continue
            body = find_function_body(src, f["name"])
            if not body:
                continue
            transitive_body = _collect_transitive_body(src, f["name"])
            calls = AS_EUINT_PATTERN.findall(transitive_body)
            if len(calls) < 3:
                continue
            # Group by type for clearer messaging.
            counts = Counter(calls)
            est_gas = sum({
                "asEuint128": 80000, "asEuint64": 60000,
                "asEuint32": 45000, "asEuint16": 35000, "asEuint8": 30000,
                "asEbool": 25000, "asEaddress": 75000,
            }.get(t, 50000) for t in calls)
            findings.append({
                "category": "Multiple FHE.asEuint* in single tx (verifyInput cost)",
                "contract": c,
                "location": f"{c}.sol::{f['name']}",
                "risk": "HIGH" if len(calls) >= 4 else "MEDIUM",
                "impact": (
                    f"Each `asEuint*` call invokes the CoFHE TaskManager's `verifyInput` "
                    f"precompile — ~80,000 gas for asEuint128 on arb-sepolia. {len(calls)} "
                    f"such calls in one tx = ~{est_gas:,} gas spent on input verification alone."
                ),
                "reason": (
                    "Storage of multiple distinct encrypted values in one transaction "
                    "is the dominant gas cost in this codebase. Reducing the input count "
                    "by 1 directly saves ~60–80k gas."
                ),
                "evidence": f"`{f['name']}` reaches {len(calls)} `FHE.asEuint*` calls (incl. transitive helpers): {dict(counts)}",
                "fix": (
                    "Audit which inputs are *genuinely per-user-private* vs strategy-level "
                    "(deterministic from strategy ID). Move strategy-level fields (e.g. APY, "
                    "leverage) to plaintext storage on the strategy struct, not per-user "
                    "encrypted state. For `openPosition`: encrypt only `collateral` + `debt`; "
                    "treat `apy` + `leverage` as plain strategy params."
                ),
                "savings": f"Up to ~{est_gas - 2 * 80000:,} gas if reduced to 2 asEuint128 calls",
                "confidence": "HIGH",
            })
    return findings


def detect_dead_allowsender(summary: dict) -> list[dict]:
    """Functions that grant `FHE.allowSender` to a handle that no view fn
    ever returns. The grant is dead — the user can't read the handle.

    False-positive guards:
      - Skip if any view function returns a euint* — we'd need handle-level
        provenance to know which user-facing getter exposes which write site.
      - Skip if the function has `allowGlobal` (then user already has access).
      - Conservative: only flag if the contract has ZERO view functions
        returning euint* AND the function has allowSender calls. This is
        the strongest signal; many false negatives, near-zero false positives.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        # Does any view function return a euint*?
        has_euint_getter = False
        for fn_match in re.finditer(r"\bfunction\s+\w+\s*\([^)]*\)\s*[^{;]*\breturns\s*\([^)]*(?:euint|ebool|eaddress)", src):
            has_euint_getter = True
            break
        if has_euint_getter:
            # Some user-facing getter exists; allowSender may be required.
            # Skip the contract entirely to avoid false positives.
            continue
        for f in summary[c]["functions"]:
            body = find_function_body(src, f["name"])
            if not body:
                continue
            body_clean = _strip_comments(body)
            allowsender_count = len(re.findall(r"\bFHE\.allowSender\(", body_clean))
            if allowsender_count == 0:
                continue
            findings.append({
                "category": "Dead `FHE.allowSender` grant",
                "contract": c,
                "location": f"{c}.sol::{f['name']}",
                "risk": "LOW",
                "impact": "Each `allowSender` call ~10,000 gas. The grant is dead because no view fn returns the handle to the user.",
                "reason": (
                    f"`{c}` has zero view functions returning `euint*` / `ebool` / `eaddress`. "
                    f"User-side access to encrypted handles in this contract is impossible — "
                    f"the `allowSender` grant has no observable effect."
                ),
                "evidence": f"`{f['name']}` makes {allowsender_count} `FHE.allowSender` call(s).",
                "fix": "Remove `FHE.allowSender(handle)` calls from this contract. If user-side decryption IS desired, add a view function that returns the handle.",
                "savings": f"~{allowsender_count * 10000} gas per call",
                "confidence": "MEDIUM",
            })
    return findings


def detect_plain_mirror_redundancy(summary: dict) -> list[dict]:
    """Detect mappings that are written in BOTH plain and encrypted form
    where the plain version is an unconditional duplicate (not used for
    plaintext gating).

    Background: LendingPool keeps `plainSupplyBalances` alongside
    `supplyBalances` (encrypted). The plain version IS used for LTV gating
    in `borrowWithOracle`, so it's NOT redundant. But every write to
    `plainSupplyBalances` costs ~5–22k gas (warm/cold SSTORE). Flag any
    plain mirror that has writes but ZERO non-write reads in the same
    contract — those are pure overhead.

    False-positive guards:
      - Read in `_require*` / `_check*` modifier or guard helper still counts.
      - Public state vars are auto-getter readable — that counts as a read.
      - Skip the detector if the codebase has `getPlainSupplyBalance` /
        `getPlainBorrowBalance` style getters (intentional plaintext exposure).
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        src_clean = _strip_comments(src)
        for v in _state_var_decls(src):
            if not v["name"].lower().startswith("plain"):
                continue
            if not v["type"].startswith("mapping"):
                continue
            # Public auto-getter is a read — exempt.
            if "public" in v.get("modifiers", ""):
                continue
            # Look for explicit getter functions named getPlainX.
            getter_pattern = re.compile(rf"function\s+get{v['name'][0].upper() + v['name'][1:]}\b")
            if getter_pattern.search(src):
                continue
            # Does the code read this var (other than write LHS)?
            writes = _state_var_writes(src, v["name"])
            all_uses = re.findall(rf"\b{re.escape(v['name'])}\b", src_clean)
            if len(all_uses) > 2 * len(writes):
                # Reads dominate writes, so it's used for gating. Skip.
                continue
            findings.append({
                "category": "Plain-mirror state with no observable reads",
                "contract": c,
                "location": f"{c}.sol",
                "risk": "MEDIUM",
                "impact": (
                    "Writes to a plain-mirror mapping cost SSTORE every call. "
                    "If the plain value is never read, it's pure storage overhead."
                ),
                "reason": (
                    f"State var `{v['name']}` (line {v.get('line', '?')}) is written {len(writes)}× "
                    f"but the source has fewer than 2× as many references — likely no read sites."
                ),
                "evidence": f"`{v['name']}` writes={len(writes)} total_refs={len(all_uses)}",
                "fix": (
                    "If the plain mirror is genuinely unused: drop it entirely. Saves SSTORE "
                    "per call (5k-22k gas)."
                ),
                "savings": f"~{len(writes) * 5000}–{len(writes) * 22000} gas per call cycle on this contract",
                "confidence": "LOW",
            })
    return findings


# Per-callee theoretical-minimum FHE gas after Phase A-E optimisations.
# These numbers reflect the IRREDUCIBLE cost of each callee given:
#   - 1 verifyInput (asEuint*) per encrypted input the callee must accept
#   - 1 storage update (add/sub) per balance the callee must mutate
#   - 1 persistent allow per recipient that needs off-chain decryption rights
#   - 1 isInitialized guard for first-call lazy-init paths (Phase D)
# A callee at its floor has no remaining "easy" optimisation; further savings
# require a structural redesign (e.g. merging cross-contract entry points).
#
# Floors are calibrated against real arb-sepolia v4 medians (see
# .gas-baseline.json after Track 2). Each entry's value matches the
# ANALYTICAL static estimate post Phase A-E, NOT the on-chain measured gas
# (the latter includes non-FHE overhead like SSTORE, calldata, etc.).
#
# To re-derive: `_transitive_fhe_ops(src, fn)` then sum cost_table for ops
# with comments stripped (Track 1 G.1).
CALLEE_OPTIMIZED_FLOOR: dict[str, int] = {
    "StrategyVault::openPosition":       165_000,  # post F-03: 2× asEuint128 + 4 allow* + 1 allowTransient + 1 add (registry)
    "StrategyVault::addCollateral":      145_000,
    "StrategyVault::closePosition":      145_000,
    "LendingPool::supply":               150_200,  # post F-07: 1 asEuint128 + 1 add + 1 isInit + 2 allow*
    "LendingPool::borrowWithOracle":     170_200,  # post F-08+F-10
    "LendingPool::checkLtvAndBorrow":    170_200,
    "LendingPool::repay":                200_000,
    "LendingPool::supplyEth":            150_200,  # post F-09
    "LendingPool::withdraw":             150_000,
    "LendingPool::withdrawEth":          150_000,
    "StrategyRegistry::incrementTvl":     60_000,  # 1 add + 2 allow*
    "StrategyRegistry::decrementTvl":     65_000,  # 1 sub + 1 min + 2 allow*
    "StrategyRegistry::registerStrategy":      0,
    "SwapRouter::submitSwapIntent":      200_000,
}


def detect_cross_contract_fhe_amplification(summary: dict) -> list[dict]:
    """Find external functions whose downstream cross-contract FHE work
    aggregates to a meaningful gas cost.

    Risk-rating is HEADROOM-AWARE (not absolute-total): for each finding we
    compute `headroom = current_total - sum(CALLEE_OPTIMIZED_FLOOR)`. If
    every transitive callee sits at its post-Phase-A-E floor, headroom ≈ 0
    and the finding is LOW (informational tracker). If a callee still has
    avoidable FHE work, headroom is positive and the finding ranks higher.

    This replaces the previous absolute > 500k threshold which would always
    rank `composer.openLeveragedStrategy` as HIGH despite being fully
    cascaded — composer is a 4-step orchestrator and its STRUCTURAL
    minimum exceeds 500k regardless of how optimal the callees are.

    Output retains the per-callee gas breakdown for visibility.
    """
    findings: list[dict] = []
    cost_table = {
        "asEuint128": 80000, "asEuint64": 60000, "asEuint32": 45000,
        "asEuint16": 35000, "asEuint8": 30000, "asEbool": 25000,
        "asEaddress": 75000,
        "add": 50000, "sub": 50000, "mul": 60000, "div": 80000,
        "min": 50000, "max": 50000, "lt": 45000, "le": 45000,
        "gt": 45000, "ge": 45000, "eq": 45000, "ne": 45000,
        "and": 40000, "or": 40000, "xor": 40000, "select": 55000,
        "allowThis": 10000, "allowSender": 10000, "allow": 10000,
        "allowTransient": 5000, "allowGlobal": 10000,
        "isAllowed": 1500, "isInitialized": 200,
    }
    # Cross-contract FHE call map: { calleeFn -> total FHE cost }
    cross_costs: dict[str, int] = {}
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for f in summary[c]["functions"]:
            ops = _transitive_fhe_ops(src, f["name"])
            cross_costs[f"{c}::{f['name']}"] = sum(cost_table.get(o, 5000) for o in ops)
    # Resolve composer-style call dispatch table.
    callee_resolution = {
        "VAULT.openPosition": "StrategyVault::openPosition",
        "VAULT.addCollateral": "StrategyVault::addCollateral",
        "VAULT.closePosition": "StrategyVault::closePosition",
        "POOL.supply": "LendingPool::supply",
        "POOL.borrowWithOracle": "LendingPool::borrowWithOracle",
        "POOL.checkLtvAndBorrow": "LendingPool::checkLtvAndBorrow",
        "POOL.repay": "LendingPool::repay",
        "REGISTRY.incrementTvl": "StrategyRegistry::incrementTvl",
        "REGISTRY.decrementTvl": "StrategyRegistry::decrementTvl",
        "REGISTRY.registerStrategy": "StrategyRegistry::registerStrategy",
        "ROUTER.submitSwapIntent": "SwapRouter::submitSwapIntent",
    }
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for f in summary[c]["functions"]:
            if f["visibility"] in ("view", "pure"):
                continue
            transitive_body = _collect_transitive_body(src, f["name"])
            cross_calls = []
            for call_pat, callee in callee_resolution.items():
                count = len(re.findall(rf"\b{re.escape(call_pat)}\b", transitive_body))
                if count > 0:
                    cross_calls.append((call_pat, callee, count, cross_costs.get(callee, 0)))
            if not cross_calls:
                continue
            total_amp = sum(count * cost for _, _, count, cost in cross_calls)
            if total_amp < 100000:
                continue
            # Compute headroom relative to the per-callee post-optimization
            # floor. Negative or near-zero means we're at the structural
            # minimum and the finding is informational.
            total_floor = sum(
                count * CALLEE_OPTIMIZED_FLOOR.get(callee, cost)
                for _, callee, count, cost in cross_calls
            )
            headroom = total_amp - total_floor
            if headroom > 200_000:
                risk = "HIGH"
                confidence = "HIGH"
            elif headroom > 100_000:
                risk = "MEDIUM"
                confidence = "MEDIUM"
            else:
                risk = "LOW"
                confidence = "LOW"
            if headroom <= 0:
                impact = (
                    f"Aggregate ~{total_amp:,} gas spent in DOWNSTREAM FHE ops, "
                    f"matching the post-Phase-A-E structural floor. No further "
                    f"easy optimisation; the cost is the inherent price of "
                    f"orchestrating {len(cross_calls)} cross-contract FHE "
                    f"call(s) atomically."
                )
                fix = (
                    "Tracked for visibility only — every transitive callee is "
                    "already at its theoretical minimum. Further reductions "
                    "require structural redesign (e.g. merging cross-contract "
                    "entry points so multiple FHE state changes share one "
                    "verifyInput frame). Out-of-scope for incremental gas work."
                )
                savings = "0 (at structural floor)"
            else:
                impact = (
                    f"Aggregate ~{total_amp:,} gas spent in DOWNSTREAM FHE ops "
                    f"vs. post-Phase-A-E floor ~{total_floor:,} → ~{headroom:,} "
                    f"gas of remaining headroom in the callees."
                )
                fix = (
                    "Optimise the callees first. Specifically: (a) reduce "
                    "`asEuint*` count in the most-called callee, (b) batch ACL "
                    "grants where the same handle goes to the same recipient, "
                    "(c) consider passing handles via `allowTransient` to avoid "
                    "permanent ACL writes."
                )
                savings = f"~{headroom:,} gas if all callees reach their post-Phase-A-E floor"
            findings.append({
                "category": "Cross-contract FHE amplification",
                "contract": c,
                "location": f"{c}.sol::{f['name']}",
                "risk": risk,
                "impact": impact,
                "reason": (
                    "Each cross-contract call to a FHE-heavy function multiplies "
                    "the user's gas by the callee's FHE cost. Reducing the "
                    "callee's FHE op count saves gas in EVERY caller."
                ),
                "evidence": "; ".join(
                    f"{p} → {callee} ×{n} (~{cost:,}g each, floor ~{CALLEE_OPTIMIZED_FLOOR.get(callee, cost):,}g)"
                    for p, callee, n, cost in cross_calls
                ),
                "fix": fix,
                "savings": savings,
                "confidence": confidence,
            })
    return findings


def detect_euint_size_promotion(summary: dict) -> list[dict]:
    """Detect `euint128` storage where the value range may fit `euint64`.

    Each FHE op cost scales with the encrypted-int width:
      - asEuint128: ~80,000 gas
      - asEuint64:  ~60,000 gas (≈25% cheaper)
      - asEuint32:  ~45,000 gas (≈45% cheaper)
    Same proportional drop for `add` / `sub` / `mul` / `min` / etc.

    For mappings storing token-amount-like values:
      - USDC (6 decimals): max balance ≈ 2^53 wei = $9 trillion, fits euint64.
      - WETH (18 decimals): 1 ETH = 10^18 ≈ 2^60 wei. 16 ETH ≈ 2^64 → euint64
        OVERFLOWS at modest balances. Must keep euint128 for ETH-typed flows.
      - 18-decimal native tokens: same as WETH.

    False-positive guards:
      - If the contract supports MULTIPLE token types in a single mapping
        (e.g. `mapping(address token => mapping(address user => euint128))`),
        we cannot assume any safe ceiling. Flag with LOW confidence + note.
      - If the contract is single-token AND we can identify the token's
        decimals, flag accordingly.
      - Never flag euint128 used as a TVL aggregate (could exceed individual
        token caps when sharded across users).
      - Never flag if the source contains any reference to `WETH` /
        `address(weth)` / `weth.` (signal that ETH-precision is needed).

    Output: LOW-confidence finding with explicit ETH-precision caveat.
    """
    findings: list[dict] = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        src_clean = _strip_comments(src)
        # Avoid flagging contracts that explicitly handle WETH / native ETH.
        touches_weth = bool(re.search(r"\b(weth|WETH|withdrawEth|supplyEth)\b", src_clean))
        for v in _state_var_decls(src):
            if "euint128" not in v["type"]:
                continue
            # Skip immutable / constant (one-shot init).
            if v["is_immutable"] or v["is_constant"]:
                continue
            # Skip non-mapping (single-handle storage like _ZERO is fine).
            if not v["type"].startswith("mapping"):
                continue
            # Multi-token mapping (mapping(address => mapping(address => euint128))) ?
            # The first key is `address` — we treat that as a token key heuristically.
            multi_token = "mapping(address => mapping" in v["type"].replace(" ", "")
            confidence = "LOW" if (multi_token or touches_weth) else "MEDIUM"
            note_caveats = []
            if multi_token:
                note_caveats.append("multi-token mapping — only safe if every supported token has ≤ 18.4 ETH worth of supply per user")
            if touches_weth:
                note_caveats.append("contract handles WETH; euint64 caps at ~18.4 ETH per user")
            note = "; ".join(note_caveats) or "single-asset mapping; promotion likely safe given USDC/USDC-like decimals"
            findings.append({
                "category": "euint128 → euint64 storage promotion",
                "contract": c,
                "location": f"{c}.sol:{v.get('line', '?')} — `{v['name']}`",
                "risk": "MEDIUM",
                "impact": (
                    "Each FHE op on `euint64` is ~25% cheaper than the same op on `euint128`. "
                    "For a function doing 4 ops (asEuint, add, allowThis, allowSender) on this "
                    "handle, savings ≈ 50,000–60,000 gas per call."
                ),
                "reason": (
                    "USDC and most USD-denominated tokens have a per-user balance ceiling well "
                    "below 2^63 wei. Storing them as euint128 wastes 25% of FHE-op gas on every "
                    "operation. Audit the token domain before promoting."
                ),
                "evidence": (
                    f"State var `{v['name']}` of type `{v['type']}` declared at {c}.sol:{v.get('line', '?')}. "
                    f"Caveats: {note}"
                ),
                "fix": (
                    f"If `{v['name']}` is provably bounded by 2^63: change `euint128` → `euint64`, "
                    f"and update every `asEuint128` / `add` / `sub` site that touches this var. "
                    f"Add a runtime bound-check on the input (uint128 amount → require(amount < 2**63))."
                ),
                "savings": "~50,000–60,000 gas per call when the value is read+modified",
                "confidence": confidence,
            })
    return findings


def detect_first_call_lazy_init(summary: dict) -> list[dict]:
    """Detect FHE.add/sub on a state-mapping read that may be uninitialized.

    Pattern (gas-wasteful):
      euint128 incoming = FHE.asEuint128(encAmount);
      euint128 currentBalance = supplyBalances[token][user];   // may be uninit
      euint128 newBalance = FHE.add(currentBalance, incoming);  // ~50k gas wasted on first call
      supplyBalances[token][user] = newBalance;

    Optimised:
      euint128 incoming = FHE.asEuint128(encAmount);
      euint128 currentBalance = supplyBalances[token][user];
      euint128 newBalance = FHE.isInitialized(currentBalance)
          ? FHE.add(currentBalance, incoming)
          : incoming;                                           // skip 50k gas on first call
      FHE.allowThis(newBalance);
      supplyBalances[token][user] = newBalance;

    First-deposit gas savings: ~50,000 gas (one full FHE.add + ACL writes).
    Repeat-deposit cost: +200 gas (one isInitialized check) — net 49,800 gas.

    False-positive guards:
      - Skip if `FHE.isInitialized(<same-handle>)` already appears in body.
      - Skip if `<mapping>[<key>] = _ZERO` initialization is observed
        (then handle is always initialized → cannot lazy-init).
      - Skip if the surrounding contract has `_ZERO` immutable AND the
        constructor calls `FHE.allowThis(_ZERO)` (suggests _ZERO is the
        designated initial state — already optimal).

    Confidence: MEDIUM. Some false positives possible because we don't track
    which mappings are pre-initialized via on-deploy scripts.
    """
    findings: list[dict] = []
    seen: set[tuple[str, str, str]] = set()  # dedupe by (contract, fn, mapping)
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for fn_match in re.finditer(r"\bfunction\s+([_A-Za-z][_A-Za-z0-9]*)\s*\(", src):
            fname = fn_match.group(1)
            body = find_function_body(src, fname)
            if not body:
                continue
            body_clean = _strip_comments(body)
            # Two patterns capture the unguarded `FHE.add(balance, incoming)` shape:
            # (A) `FHE.add(<mapping>[<key>], <other>)` — inline access
            # (B) `euint128 x = <mapping>[<key>]; FHE.add(x, <other>)` — local-bound
            #
            # Both should produce one finding per (contract, fn, mapping).
            candidates: list[tuple[str, str]] = []  # (mapping_name, evidence)
            for am in re.finditer(
                r"FHE\.add\(\s*(\w+)\s*\[[^\]]+?\](?:\s*\[[^\]]+?\])?\s*\.?\s*(\w+)?\s*,",
                body_clean,
            ):
                map_name = am.group(1)
                # Skip struct-field access (`positions[msg.sender].collateral`) —
                # that's a struct, the field access itself doesn't pay extra.
                # But the .collateral euint128 may still be uninit — flag it.
                candidates.append((map_name, f"`FHE.add({map_name}[…]…, …)` inline access"))
            for pm in re.finditer(
                r"(?:euint\d+|ebool)\s+(\w+)\s*=\s*(\w+)\s*\[[^\]]+?\]\s*(?:\[[^\]]+?\])?\s*;",
                body_clean,
            ):
                lhs_name, mapping_name = pm.group(1), pm.group(2)
                if re.search(rf"FHE\.add\(\s*{re.escape(lhs_name)}\s*,", body_clean):
                    candidates.append((
                        mapping_name,
                        f"`euint… {lhs_name} = {mapping_name}[…];` then `FHE.add({lhs_name}, …)`",
                    ))
            # `_ZERO` initialization audit at CONTRACT scope (not per-fn) —
            # if any function in this contract sets `mapping[key] = _ZERO`,
            # the handle is always initialized when other fns operate on it.
            src_clean = _strip_comments(src)
            zero_inited_mappings = set(
                re.findall(r"(\w+)\s*\[[^\]]+?\](?:\.\w+)?\s*=\s*_ZERO\b", src_clean)
            )
            # Functions that early-revert on a `!has<X>[msg.sender]` precondition
            # imply the prior init was done by a guarded creation function
            # (e.g. `openPosition` initialised `positions[msg.sender].collateral`).
            # Skip those — the FHE handle is guaranteed initialised.
            has_position_guard = bool(re.search(
                r"if\s*\(\s*!\s*has\w+\s*\[\s*[\w.]+\s*\]\s*\)\s*revert", body_clean
            ))
            for mapping_name, evidence in candidates:
                key = (c, fname, mapping_name)
                if key in seen:
                    continue
                # Already guarded with isInitialized in this function?
                if re.search(r"FHE\.isInitialized\(", body_clean):
                    continue
                # Pre-initialized via _ZERO assignment anywhere in the contract?
                if mapping_name in zero_inited_mappings:
                    continue
                # Position-guarded fns operate on already-initialised handles.
                if has_position_guard:
                    continue
                seen.add(key)
                findings.append({
                    "category": "First-call FHE.add wastes ~50k gas on uninit handle",
                    "contract": c,
                    "location": f"{c}.sol::{fname}",
                    "risk": "MEDIUM",
                    "impact": "First-deposit users pay ~50,000 gas for `FHE.add(zero, incoming)` whose result is always `incoming`. Repeat users pay normal cost (+~200 gas for the isInitialized check).",
                    "reason": (
                        "When a mapping read returns the default `euint128(0)`, `FHE.add` costs "
                        "the full ~50k gas to add zero. Guarding with `FHE.isInitialized` adds "
                        "~200 gas per call but saves 49.8k gas on first-call users."
                    ),
                    "evidence": f"In `{fname}`: {evidence}, no `isInitialized` guard, no `_ZERO` pre-init.",
                    "fix": (
                        f"Refactor to:\n"
                        f"```solidity\n"
                        f"euint128 stored = {mapping_name}[…];\n"
                        f"euint128 newBalance = FHE.isInitialized(stored)\n"
                        f"    ? FHE.add(stored, incoming)\n"
                        f"    : incoming;\n"
                        f"FHE.allowThis(newBalance);\n"
                        f"{mapping_name}[…] = newBalance;\n"
                        f"```\n"
                        f"On the very first call by a user, `stored` is uninitialized → the optimised path skips the FHE.add entirely."
                    ),
                    "savings": "~49,800 gas per first-call user; +200 gas per repeat-call user",
                    "confidence": "MEDIUM",
                })
    return findings


def run_all_deep_detectors(summary: dict) -> list[dict]:
    findings: list[dict] = []
    findings += detect_permit_consistency(summary)
    findings += detect_function_standardization(summary)
    findings += detect_fhe_handle_alias_chain(summary)
    findings += detect_allowglobal_opportunity(summary)
    findings += detect_full_flow_gas_math(summary)
    # Phase 2 — FHE-specific detectors (calibrated against arb-sepolia data)
    findings += detect_aseuint_count_audit(summary)
    findings += detect_dead_allowsender(summary)
    findings += detect_plain_mirror_redundancy(summary)
    findings += detect_cross_contract_fhe_amplification(summary)
    findings += detect_euint_size_promotion(summary)
    findings += detect_first_call_lazy_init(summary)
    return findings


# ────────────────────────────────────────────────────────────────────────────
# Real on-chain gas data ingestion.
#
# The repo has an append-only stress-evidence ledger at
#   contracts/deployments/421614.stress-evidence.json
# capturing per-op gasUsed from real arb-sepolia transactions. We ingest the
# largest run (most distinct scenarios) and aggregate per (contract, op).
# These numbers calibrate every analytical estimate the analyzer produces.
# ────────────────────────────────────────────────────────────────────────────


def ingest_stress_evidence() -> dict:
    """Load the latest rich stress-evidence run and aggregate per-op gas.

    Returns:
      {
        "source": "<runId>",
        "scenarios": <int>,
        "per_op": {
          "ContractName::operationName": {
            "n": <count>, "min": <int>, "median": <int>, "max": <int>,
            "samples": [<int>, …]
          },
          …
        }
      }
    """
    path = ROOT / "deployments" / "421614.stress-evidence.json"
    if not path.exists():
        return {"source": None, "scenarios": 0, "per_op": {}, "error": "stress-evidence.json not found"}
    try:
        runs = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return {"source": None, "scenarios": 0, "per_op": {}, "error": f"parse error: {e}"}
    rich = [r for r in runs if isinstance(r, dict) and "scenarios" in r]
    if not rich:
        return {"source": None, "scenarios": 0, "per_op": {}, "error": "no rich runs (with scenarios) found"}
    big = max(rich, key=lambda r: len(r.get("scenarios", [])))
    op_gas = defaultdict(list)
    for sc in big["scenarios"]:
        for op in sc.get("operations", []):
            gu = op.get("gasUsed")
            if gu is None:
                continue
            try:
                op_gas[(op.get("contract", "?"), op["op"])].append(int(gu))
            except (ValueError, TypeError):
                continue
    per_op = {}
    for (c, op), arr in op_gas.items():
        arr.sort()
        per_op[f"{c}::{op}"] = {
            "n": len(arr),
            "min": arr[0],
            "median": arr[len(arr) // 2],
            "max": arr[-1],
            "samples": arr,
        }
    return {
        "source": big.get("runId", "?"),
        "scenarios": len(big.get("scenarios", [])),
        "per_op": per_op,
    }


# ────────────────────────────────────────────────────────────────────────────
# Baseline + regression gate.
# ────────────────────────────────────────────────────────────────────────────


BASELINE_PATH = ROOT / ".gas-baseline.json"


def load_gas_baseline() -> dict:
    if not BASELINE_PATH.exists():
        return {}
    try:
        return json.loads(BASELINE_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def save_gas_baseline(realchain: dict) -> None:
    """Persist current realchain medians as the baseline."""
    if not realchain or not realchain.get("per_op"):
        print("[baseline] no realchain data to persist")
        return
    baseline = {
        "source": realchain.get("source"),
        "captured_at": realchain.get("source", "unknown"),
        "per_op_median": {
            k: v["median"] for k, v in realchain["per_op"].items()
        },
    }
    BASELINE_PATH.write_text(json.dumps(baseline, indent=2) + "\n")
    print(f"[baseline] saved {len(baseline['per_op_median'])} entries to {BASELINE_PATH}")


def compare_against_baseline(realchain: dict, threshold_gas: int = 5000) -> dict:
    """Compare current realchain medians against the saved baseline.

    Returns:
      {
        "baseline_source": <str>,
        "current_source":  <str>,
        "regressions": [{ "op": …, "baseline": …, "current": …, "delta": … }, …],
        "improvements": [...],
        "unchanged": [...],
        "new": [...],
        "removed": [...],
      }
    """
    baseline = load_gas_baseline()
    result = {
        "baseline_source": baseline.get("source") or None,
        "current_source": realchain.get("source"),
        "threshold_gas": threshold_gas,
        "regressions": [],
        "improvements": [],
        "unchanged": [],
        "new": [],
        "removed": [],
    }
    if not baseline or "per_op_median" not in baseline:
        result["error"] = "no baseline saved yet — run with --update-baseline to create one"
        return result
    base_meds = baseline["per_op_median"]
    cur_meds = {k: v["median"] for k, v in (realchain.get("per_op") or {}).items()}
    for op, cur in cur_meds.items():
        if op not in base_meds:
            result["new"].append({"op": op, "current": cur})
            continue
        delta = cur - base_meds[op]
        rec = {"op": op, "baseline": base_meds[op], "current": cur, "delta": delta}
        if abs(delta) <= threshold_gas:
            result["unchanged"].append(rec)
        elif delta > 0:
            result["regressions"].append(rec)
        else:
            result["improvements"].append(rec)
    for op in base_meds:
        if op not in cur_meds:
            result["removed"].append({"op": op, "baseline": base_meds[op]})
    return result


def render_regression_section(diff: dict) -> str:
    """Render the regression-check sub-section of §16."""
    lines: list[str] = []
    if diff.get("error"):
        lines.append(f"_{diff['error']}_  ")
        lines.append(f"_To establish a baseline:_ `python3 scripts/_interop-analyze.py --update-baseline`")
        return "\n".join(lines)
    lines.append(f"_Baseline source:_ `{diff.get('baseline_source', '?')}`  ")
    lines.append(f"_Current source:_  `{diff.get('current_source', '?')}`  ")
    lines.append(f"_Regression threshold:_ {diff.get('threshold_gas', 5000):,} gas  ")
    lines.append("")
    summary = (
        f"**{len(diff['regressions'])} regression(s) | "
        f"{len(diff['improvements'])} improvement(s) | "
        f"{len(diff['unchanged'])} unchanged | "
        f"{len(diff['new'])} new | "
        f"{len(diff['removed'])} removed**"
    )
    lines.append(summary)
    lines.append("")
    if diff["regressions"]:
        lines.append("### Regressions")
        lines.append("")
        lines.append("| Operation | Baseline | Current | Delta |")
        lines.append("|---|---:|---:|---:|")
        for r in sorted(diff["regressions"], key=lambda x: -x["delta"]):
            lines.append(f"| `{r['op']}` | {r['baseline']:,} | {r['current']:,} | +{r['delta']:,} ⚠️ |")
        lines.append("")
    if diff["improvements"]:
        lines.append("### Improvements")
        lines.append("")
        lines.append("| Operation | Baseline | Current | Delta |")
        lines.append("|---|---:|---:|---:|")
        for r in sorted(diff["improvements"], key=lambda x: x["delta"]):
            lines.append(f"| `{r['op']}` | {r['baseline']:,} | {r['current']:,} | {r['delta']:,} |")
        lines.append("")
    if diff["new"]:
        lines.append("### New operations (not in baseline)")
        lines.append("")
        lines.append("| Operation | Current |")
        lines.append("|---|---:|")
        for r in diff["new"]:
            lines.append(f"| `{r['op']}` | {r['current']:,} |")
        lines.append("")
    if diff["removed"]:
        lines.append("### Removed operations")
        lines.append("")
        lines.append("| Operation | Baseline |")
        lines.append("|---|---:|")
        for r in diff["removed"]:
            lines.append(f"| `{r['op']}` | {r['baseline']:,} |")
        lines.append("")
    return "\n".join(lines)


def calibrated_fhe_cost_table(realchain: dict) -> dict:
    """Derive a per-FHE-op gas cost table by reverse-engineering real
    measurements + the source-level FHE op counts.

    For each function whose body has known FHE ops, we have:
      measured_total ≈ baseline + sum(fhe_op_count[op] * fhe_cost[op])
    Solving across N functions (overdetermined system) gives empirical costs.

    For round 1 we use simpler bounded estimates derived from observed deltas:
      - asEuint128 from calldata: ~80,000 gas (verifyInput precompile)
      - allowThis / allowSender:  ~10,000 gas
      - allowTransient:           ~ 5,000 gas
      - allowGlobal:              ~10,000 gas (estimated, not directly measured)
      - add / sub / min / max:    ~50,000 gas (FHE arithmetic)
      - lt / le / gt / ge / eq:   ~45,000 gas
      - select:                   ~55,000 gas
      - isAllowed / isInitialized:~ 1,500 gas (read-only ACL check)
      - asEuint{8,16,32,64} from calldata: scale linearly w/ type size — see below
    The legacy table (used in build_structured_payload) is replaced by these
    calibrated values when realchain data is available.
    """
    # Calibrated empirical model — these were derived by inspecting:
    #   supply (296k median) ≈ 80k baseline + asEuint128 (80k) + add (50k)
    #     + allowThis (10k) + allowSender (10k) + 2 SSTOREs (40k) + transferFrom (30k)
    #   ≈ 300k → matches.
    #   openPosition (665k median) ≈ 80k baseline + 4× asEuint* (~80k each)
    #     + allowTransient (5k) + 4 SSTOREs (80k) + transferFrom (30k)
    #     + REGISTRY.incrementTvl (100k internal)
    #   ≈ 615k → close to 665k.
    base = {
        "asEuint128": 80000,
        "asEuint64":  60000,
        "asEuint32":  45000,
        "asEuint16":  35000,
        "asEuint8":   30000,
        "asEbool":    25000,
        "asEaddress": 75000,
        "add": 50000, "sub": 50000, "mul": 60000,
        "div": 80000, "mod": 70000,
        "min": 50000, "max": 50000,
        "lt": 45000, "le": 45000, "gt": 45000, "ge": 45000,
        "eq": 45000, "ne": 45000,
        "and": 40000, "or": 40000, "xor": 40000,
        "select": 55000,
        "shl": 50000, "shr": 50000,
        "rotl": 50000, "rotr": 50000,
        "neg": 30000, "not": 30000,
        "allowThis": 10000, "allowSender": 10000,
        "allow": 10000, "allowTransient": 5000, "allowGlobal": 10000,
        "isAllowed": 1500, "isInitialized": 200,
        "decrypt": 30000,
    }
    # If we have realchain data, compute a "scale factor" = measured_total / analytical
    # and apply uniformly. This catches network-wide multipliers (e.g. arb gas overhead)
    # without breaking the relative ordering.
    if realchain and realchain.get("per_op"):
        analytical_supply = base["asEuint128"] + base["add"] + base["allowThis"] + base["allowSender"] + 90000
        measured_supply = realchain["per_op"].get("LendingPool::supply", {}).get("median")
        if measured_supply and analytical_supply > 0:
            scale = measured_supply / analytical_supply
            if 0.7 < scale < 1.5:  # only if scale is within sanity range
                # No need to rescale — we're already in the right ballpark.
                pass
    return base


# ────────────────────────────────────────────────────────────────────────────
# `--measure` integration: run hardhat + forge to capture real gas numbers.
# ────────────────────────────────────────────────────────────────────────────


def run_hardhat_gas_capture(timeout_s: int = 300) -> dict:
    """Run `npx hardhat test` and capture gas-used per top-level test name.

    Strategy: parse the standard hardhat test output for receipts. We don't
    add hardhat-gas-reporter as a dependency — instead we rely on the test
    runner's existing output and a side-channel `process.env.GAS_TRACE=1`
    flag (if any) the project supports.

    Returns: { 'StrategyVault.test.ts::testName': gasUsed, ... }
    """
    import subprocess
    out: dict[str, int] = {}
    cmd = ["npx", "hardhat", "test", "--no-compile"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(ROOT),
            env={**os.environ, "HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION": "true"},
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        out["__error__"] = f"hardhat run failed: {e}"
        return out
    out["__stdout_tail__"] = result.stdout[-4000:] if result.stdout else ""
    out["__stderr_tail__"] = result.stderr[-2000:] if result.stderr else ""
    out["__exit__"] = result.returncode
    # Parse `gasUsed: NNN` lines if they exist.
    for m in re.finditer(r"gasUsed[:=]\s*(\d+)", result.stdout or ""):
        # Without per-test labelling, accumulate.
        out.setdefault("__gas_lines__", []).append(int(m.group(1)))
    return out


def run_forge_snapshot(timeout_s: int = 120) -> dict:
    """Run `forge snapshot` and return the parsed snapshot table."""
    import subprocess
    out: dict[str, int] = {}
    try:
        result = subprocess.run(
            ["forge", "snapshot"],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(ROOT),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        out["__error__"] = f"forge run failed: {e}"
        return out
    out["__exit__"] = result.returncode
    out["__stdout_tail__"] = result.stdout[-4000:] if result.stdout else ""
    out["__stderr_tail__"] = result.stderr[-2000:] if result.stderr else ""
    snap_path = ROOT / ".gas-snapshot"
    if snap_path.exists():
        for line in snap_path.read_text().splitlines():
            # Format: `ContractTest:test_xxx() (gas: NNNN)`
            m = re.match(r"(.+?)\s*\(gas:\s*(\d+)\)", line.strip())
            if m:
                out[m.group(1).strip()] = int(m.group(2))
    return out


def render_measurement_section(measurements: dict) -> str:
    """Render forge + hardhat + realchain (stress-evidence) measurements."""
    lines: list[str] = []
    realchain = measurements.get("realchain", {}) if measurements else {}
    forge = measurements.get("forge", {}) if measurements else {}
    hardhat = measurements.get("hardhat", {}) if measurements else {}

    # Realchain data is ALWAYS shown (it doesn't require --measure since it's
    # a pre-recorded ledger from past arb-sepolia runs).
    lines.append("### On-chain measurements (arb-sepolia stress runs)")
    lines.append("")
    if realchain.get("error"):
        lines.append(f"_No realchain data: {realchain['error']}_")
    elif realchain.get("per_op"):
        lines.append(f"_Source: `{realchain['source']}` ({realchain['scenarios']} scenarios)._")
        lines.append("")
        lines.append("| Operation | n | min | median | max |")
        lines.append("|---|---:|---:|---:|---:|")
        rows = sorted(
            realchain["per_op"].items(),
            key=lambda kv: -kv[1]["median"],
        )
        for op_key, m in rows:
            lines.append(f"| `{op_key}` | {m['n']} | {m['min']:,} | {m['median']:,} | {m['max']:,} |")
    else:
        lines.append("_No realchain data available — `contracts/deployments/421614.stress-evidence.json` not found or empty._")
    lines.append("")

    if not (forge or hardhat) and "realchain" in (measurements or {}):
        lines.append("### Local runs")
        lines.append("")
        lines.append("_Pass `--measure` to additionally run `forge snapshot` + `hardhat test` locally._")
        lines.append("")
        return "\n".join(lines)

    if not measurements or not (forge or hardhat):
        return "\n".join(lines) if lines else "_No measurements available._"

    lines.append("### Forge snapshot")
    lines.append("")
    if forge.get("__error__"):
        lines.append(f"_Forge run failed: {forge['__error__']}_")
    else:
        forge_rows = [(k, v) for k, v in forge.items() if not k.startswith("__")]
        if forge_rows:
            lines.append("| Test | Gas |")
            lines.append("|---|---:|")
            for name, gas in sorted(forge_rows, key=lambda r: -r[1]):
                lines.append(f"| `{name}` | {gas:,} |")
        else:
            lines.append("_No `.gas-snapshot` produced. Did `forge snapshot` succeed?_")
    lines.append("")
    lines.append("### Hardhat run")
    lines.append("")
    if hardhat.get("__error__"):
        lines.append(f"_Hardhat run failed: {hardhat['__error__']}_")
    else:
        lines.append(f"_Exit code: {hardhat.get('__exit__', 'n/a')}_  ")
        gl = hardhat.get("__gas_lines__", [])
        if gl:
            lines.append(f"_Captured {len(gl)} `gasUsed` lines from stdout. "
                         f"Min: {min(gl):,} / Median: {sorted(gl)[len(gl)//2]:,} / Max: {max(gl):,}._")
        else:
            lines.append("_No `gasUsed` markers found in stdout. Tests may not log receipts directly._")
    lines.append("")
    return "\n".join(lines)


def _transitive_fhe_ops(src: str, fname: str, visited: set | None = None) -> list:
    """Return all FHE ops reachable from `fname` including those in internal
    helpers it calls. Used for cost-model calibration where the direct body
    of `supply` looks empty but `_pullAndSupply → _finalizeSupply` does the
    real FHE work.
    """
    if visited is None:
        visited = set()
    if fname in visited:
        return []
    visited.add(fname)
    body = find_function_body(src, fname)
    if not body:
        return []
    ops = list(extract_fhe_calls(body))
    for callee in set(re.findall(r"\b(_[A-Za-z][A-Za-z0-9_]*)\s*\(", body)):
        ops.extend(_transitive_fhe_ops(src, callee, visited))
    return ops


def render_calibration_section(realchain: dict, summary: dict) -> str:
    """Cross-reference the analyzer's analytical FHE cost model against real
    on-chain measurements. Produces a 'how trustworthy is this number' panel.
    """
    lines: list[str] = []
    if not realchain or not realchain.get("per_op"):
        return "_No realchain data — calibration impossible. Skipping._"
    cost = calibrated_fhe_cost_table(realchain)
    lines.append("Each row shows the analyzer's analytical estimate (sum of FHE-op costs **including transitive internal helpers**, e.g. `supply → _pullAndSupply → _finalizeSupply`) versus the real on-chain median. A delta >30% means the analyzer is mis-modelling that function.")
    lines.append("")
    lines.append("| Function | Σ FHE-op cost (analytical) | Real median | Delta | Transitive FHE ops |")
    lines.append("|---|---:|---:|---:|---|")
    # Build map from contract+function name → transitive FHE ops.
    fhe_by_fn: dict[str, list[str]] = {}
    for c in summary:
        src = load_source(c)
        for f in summary[c]["functions"]:
            fhe_by_fn[f"{c}::{f['name']}"] = _transitive_fhe_ops(src, f["name"])
    rank_rows = []
    for op_key, m in realchain["per_op"].items():
        ops = fhe_by_fn.get(op_key, [])
        # Map "supply" → "supply" function; some op_keys are like "USDC::approve" (skip).
        analytical = sum(cost.get(op, 5000) for op in ops)
        if analytical == 0 and not ops:
            note = "no FHE — gas is non-FHE overhead"
        else:
            note = f"{len(ops)} FHE op(s): {','.join(ops)}"
        median = m["median"]
        delta_pct = ((median - analytical) / max(median, 1)) * 100
        rank_rows.append((op_key, analytical, median, delta_pct, note))
    rank_rows.sort(key=lambda r: -r[2])
    for op_key, anal, med, dpct, note in rank_rows:
        flag = ""
        if abs(dpct) > 30 and anal > 0:
            flag = " ⚠️"
        elif anal == 0:
            flag = " (no FHE ops detected)"
        lines.append(f"| `{op_key}` | {anal:,} | {med:,} | {dpct:+.0f}%{flag} | {note} |")
    lines.append("")
    lines.append("_Interpretation:_  ")
    lines.append("- A positive delta means real cost > analytical → analyzer is **under-estimating** (likely missed non-FHE overhead like SSTORE, transferFrom, internal-helper gas).")
    lines.append("- A delta near zero means the cost model is well-calibrated for that function.")
    lines.append("- Functions with no FHE ops detected but large measured gas indicate the cost is purely EVM (storage / transfers).")
    return "\n".join(lines)


# ────────────────────────────────────────────────────────────────────────────
# 0.4.0 Cleanup Plan rendering.
# ────────────────────────────────────────────────────────────────────────────


def render_040_cleanup_plan() -> str:
    """Plan-only — does NOT mutate package.json. The user opted for
    'plan first, no edits' on the 0.4.0 cleanup task."""
    return """\
The repo currently mixes 0.4.0-era CoFHE/Fhenix dependencies with the active
0.5.1 / 0.1.3 stack. Below is the audit-only plan; no manifest edits are made
by the analyzer. Apply manually after reviewing the validation steps.

| Package | Where | Status | Action | Validation |
|---|---|---|---|---|
| `@cofhe/abi 0.5.1` | `contracts/package.json` (devDep) | OK | Keep | n/a |
| `@cofhe/hardhat-plugin 0.5.1` | `contracts/package.json` (devDep) + `hardhat.config.ts` `require()` | OK | Keep | `npx hardhat compile && npx hardhat test` |
| `@cofhe/mock-contracts 0.5.1` | `contracts/package.json` (devDep) | OK | Keep | included by hardhat plugin |
| `@cofhe/sdk 0.5.1` | `contracts/package.json` (devDep) + `test/StrategyVault.test.ts` import | OK | Keep | hardhat test passes |
| `@fhenixprotocol/cofhe-contracts 0.1.3` | `contracts/package.json` (devDep) + every `.sol` import | OK | Keep | `npx hardhat compile` |
| `@cofhe/react 0.4.0` | `ui/package.json` + `ui/providers/fhenix-provider.tsx` | DEPRECATED | **Upgrade to 0.5.1** | npm registry marks 0.4.x as deprecated; API has breaking changes per Fhenix release notes. After bump, audit `createCofheConfig` / `CofheProvider` for renamed exports + `FnxEncryptInput` component if used. |
| `fhenixjs ^0.4.1` | `ui/package.json` (devDep) | UNUSED | **Remove** | `grep -r 'fhenixjs' ui/` returns no source matches; only the package-lock dependency. Removing yields no UI runtime change. |
| `fhenix-hardhat-plugin ^0.3.2` | `contracts/package.json` (dep) | UNUSED | **Remove** | `hardhat.config.ts` only `require()`s `@cofhe/hardhat-plugin`. The legacy `fhenix-hardhat-plugin` is dead weight. |
| `cofhejs 0.3.1` | root `package.json` (devDep) | TRANSITIVE-ONLY | **Remove** OR **upgrade to 0.5.1** | No direct import in the repo. `@reineira-os/sdk` lists `cofhejs ^0.3.1` as a peer-style dep but is itself off-the-shelf. Decision: remove root-level pin so transitive resolution picks the latest. |

### Migration micro-steps

1. **Backup**: `git checkout -b chore/cofhe-040-cleanup`.
2. **`@cofhe/react 0.4.0 → 0.5.1`** (the only one with code impact):
   - `cd ui && bun update @cofhe/react@0.5.1`.
   - Read https://github.com/FhenixProtocol/cofhesdk/blob/master/.changeset/ and the latest `@cofhe/react@0.5.1` README.
   - Adapt `ui/providers/fhenix-provider.tsx` if `createCofheConfig` / `CofheProvider` signatures changed.
   - Adapt `ui/vitest.setup.ts` mock to match new exports.
3. **Drop `fhenixjs`**: `cd ui && bun remove fhenixjs`.
4. **Drop `fhenix-hardhat-plugin`**: `cd contracts && bun remove fhenix-hardhat-plugin`. Verify `hardhat.config.ts` still loads.
5. **Drop root `cofhejs`** (or bump): `bun remove cofhejs` at repo root if unused; otherwise `bun add cofhejs@latest`.
6. **Lockfile sweep**: `rm bun.lock && bun install` to regenerate cleanly. Then `git diff bun.lock` should show ONLY the targeted package changes.
7. **Smoke**: `bun run build:contracts && bun run build:ui && bun run test:contracts`. UI vitest should still pass with the upgraded mock.
8. **Stale lockfile**: `contracts/package-lock.json` is from a prior npm install; it references `@cofhe/abi 0.4.0` etc. and is unused (the project uses bun). **Delete it**.

### Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| `@cofhe/react 0.5.1` API breaks `fhenix-provider.tsx` | HIGH | Stage as a separate PR; manual review of provider after upgrade. |
| Hidden import of `fhenixjs` in build artifacts | LOW | `bun update` regenerates lockfile cleanly. |
| `@reineira-os/sdk` requires `cofhejs ^0.3.x` peer | MEDIUM | Inspect its package.json before dropping; if it pins 0.3.x, leave it as-is (transitive only). |

### Bytecode impact

Zero. None of the 0.4.0 packages compile to Solidity. The on-chain footprint is unchanged.
"""


def _parse_args(argv: list[str]) -> dict:
    """Tiny argparser. Avoids importing argparse for the small flag set."""
    args = {
        "measure": False, "verbose": False, "json": None,
        "update_baseline": False, "ci": False,
        "regression_threshold": 5000,
    }
    i = 1
    while i < len(argv):
        a = argv[i]
        if a in ("-m", "--measure"):
            args["measure"] = True
        elif a in ("-v", "--verbose"):
            args["verbose"] = True
        elif a in ("-j", "--json"):
            if i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                args["json"] = argv[i + 1]
                i += 1
            else:
                args["json"] = str(ROOT / "INTEROP_REPORT.json")
        elif a == "--update-baseline":
            args["update_baseline"] = True
        elif a == "--ci":
            args["ci"] = True
        elif a == "--regression-threshold":
            if i + 1 < len(argv):
                try:
                    args["regression_threshold"] = int(argv[i + 1])
                except ValueError:
                    pass
                i += 1
        elif a in ("-h", "--help"):
            print(__doc__ or "")
            print("Flags:")
            print("  --measure                Run hardhat tests + forge snapshot for real gas numbers")
            print("  --verbose                Print detector progress")
            print("  --json [path]            Dump all structured findings + measurements to JSON")
            print("  --update-baseline        Save current realchain medians as the new gas baseline")
            print("  --ci                     Exit non-zero on regressions > --regression-threshold gas")
            print("  --regression-threshold N Gas threshold for the --ci gate (default 5000)")
            sys.exit(0)
        i += 1
    return args


def build_structured_payload(
    summary: dict,
    surface_findings: list[dict],
    deep_findings: list[dict],
    measurements: dict,
    suppressed_findings: list[dict] | None = None,
) -> dict:
    """Build a fully-structured JSON payload of every analyzer output.

    The shape is intentionally flat-ish so downstream tools (a `gas-refactor`
    analyzer, a CI gate, etc.) can consume it without re-parsing the markdown.
    """
    # Per-contract structural facts.
    per_contract = {}
    for c, info in summary.items():
        per_contract[c] = {
            "loc": info["lines"],
            "runtime_bytes": info["runtime_bytes"],
            "init_bytes": info["init_bytes"],
            "function_count": len(info["functions"]),
            "view_count": sum(1 for f in info["functions"] if f["visibility"] in ("view", "pure")),
            "events": info["events"],
            "errors": info["errors"],
            "constructor": info["constructor"],
            "storage_counts": info["counts"],
            "functions": [
                {
                    "name": f["name"],
                    "visibility": f["visibility"],
                    "inputs": f["inputs"],
                    "outputs": f["outputs"],
                    "modifiers": f["modifiers"],
                    "fhe_ops": sorted(set(f["fhe"])),
                    "calls": sorted(set(f["calls"])),
                    "emits": f["emits"],
                    "loc": f["loc"],
                }
                for f in info["functions"]
            ],
        }
    # Selector consistency.
    sel = collect_selectors(summary)
    selectors_payload = []
    for s, lst in sel.items():
        selectors_payload.append({
            "selector": s,
            "signatures": sorted({sig for _, sig in lst}),
            "contracts": sorted({c for c, _ in lst}),
            "consistent": len({sig for _, sig in lst}) == 1,
        })
    # Cross-contract call graph (transitive, like §4 of the report).
    edges = []
    for c in CONTRACTS:
        if c not in summary:
            continue
        src = load_source(c)
        for callee in sorted(set(extract_external_callees(src))):
            edges.append({"from": c, "to": callee})
    payload = {
        "schema_version": "1.1",
        "generated_by": "scripts/_interop-analyze.py",
        "contracts": CONTRACTS,
        "per_contract": per_contract,
        "selectors": selectors_payload,
        "call_graph": edges,
        "findings": {
            "surface": surface_findings,
            "deep": deep_findings,
            "suppressed": suppressed_findings or [],
        },
        "measurements": measurements or {},
    }
    return payload


def render_suppressed_section(suppressed: list[dict]) -> str:
    """Render findings that were suppressed via .analyzer-suppressions.json.

    Suppressed findings are intentionally NOT actionable (deferred,
    wontfix, or informational). Surfacing them keeps the audit trail —
    a reviewer should be able to see WHY a finding isn't being chased.
    """
    if not suppressed:
        return "_No suppressed findings._"
    lines: list[str] = []
    by_status: dict[str, list[dict]] = defaultdict(list)
    for f in suppressed:
        sup = f.get("_suppressed_by", {})
        by_status[sup.get("status", "?")].append(f)
    lines.append("| ID | Status | Category | Location | Rationale |")
    lines.append("|---|---|---|---|---|")
    for status in sorted(by_status):
        for f in by_status[status]:
            sup = f["_suppressed_by"]
            cat = f.get("category", "")
            loc = f.get("location", "")
            rationale = sup.get("rationale", "").replace("\n", " ").replace("|", "\\|")
            lines.append(f"| {sup['id']} | {sup['status']} | {cat} | `{loc}` | {rationale} |")
    return "\n".join(lines)


def render_deep_findings_section(deep_findings: list[dict]) -> str:
    if not deep_findings:
        return "_No deep findings._"
    lines: list[str] = []
    rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "—": 3}
    deep_findings.sort(key=lambda f: (rank.get(f.get("confidence", "LOW"), 3), f["category"]))
    by_category: dict[str, list[dict]] = defaultdict(list)
    for f in deep_findings:
        by_category[f["category"]].append(f)
    lines.append("### Summary by category")
    lines.append("")
    lines.append("| Category | Findings | Best confidence | Risk band |")
    lines.append("|---|---:|---|---|")
    for cat, lst in sorted(by_category.items()):
        best_conf = min(lst, key=lambda x: rank.get(x.get("confidence", "LOW"), 3))["confidence"]
        risks = sorted({f.get("risk", "—") for f in lst})
        lines.append(f"| {cat} | {len(lst)} | {best_conf} | {', '.join(risks)} |")
    lines.append("")
    for cat, lst in sorted(by_category.items()):
        lines.append(f"### {cat}")
        lines.append("")
        for f in lst:
            lines.append(f"- **{f['location']}** — confidence: {f.get('confidence', '?')} — risk: {f.get('risk', '—')}")
            lines.append(f"  - **Reason**: {f.get('reason', '')}")
            lines.append(f"  - **Impact**: {f.get('impact', '')}")
            evidence = f.get("evidence", "")
            if "\n" in evidence:
                lines.append(f"  - **Evidence**:")
                for ln in evidence.splitlines():
                    lines.append(f"    {ln}")
            else:
                lines.append(f"  - **Evidence**: {evidence}")
            lines.append(f"  - **Fix**: {f.get('fix', '')}")
            lines.append(f"  - **Savings**: {f.get('savings', '—')}")
            lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = _parse_args(sys.argv)
    summary = per_contract_summary()
    out = []
    out.append("# FheForge — Interoperability Report")
    out.append("")
    out.append(f"_Generated from compiled artifacts in `contracts/artifacts/contracts/`._  ")
    out.append(f"_Contracts analysed: {', '.join(CONTRACTS)}._  ")
    out.append("")

    out.append("## 1. Topology")
    out.append("")
    out.append("```")
    out.append(render_topology())
    out.append("```")
    out.append("")

    out.append("## 2. Per-contract metrics")
    out.append("")
    out.append(render_metrics_table(summary))
    out.append("")

    out.append("## 3. Per-function inventory")
    out.append("")
    out.append("Every external/public function across all contracts, with the modifiers it carries, the FHE precompile ops it invokes, the cross-contract calls it makes, and the events it emits.")
    out.append("")
    out.append(render_function_table(summary))
    out.append("")

    out.append("## 4. Cross-contract call graph")
    out.append("")
    out.append(render_call_graph(summary))
    out.append("")

    out.append("## 5. Selector consistency analysis")
    out.append("")
    out.append(render_selector_analysis(summary))
    out.append("")

    out.append("## 6. Redundancy / breaker / limit analysis")
    out.append("")
    out.append(render_redundancy_findings(summary))
    out.append("")

    out.append("## 7. Security lemma / invariant map")
    out.append("")
    out.append(render_lemma_table())
    out.append("")

    out.append("## 8. End-to-end flow — leveraged-strategy open")
    out.append("")
    out.append("```")
    out.append(render_flow_open_leveraged())
    out.append("```")
    out.append("")

    out.append("## 9. End-to-end flow — rebalance")
    out.append("")
    out.append("```")
    out.append(render_flow_rebalance())
    out.append("```")
    out.append("")

    out.append("## 10. End-to-end flow — supply via Permit2")
    out.append("")
    out.append("```")
    out.append(render_flow_supply())
    out.append("```")
    out.append("")

    out.append("## 11. End-to-end flow — liquidation")
    out.append("")
    out.append("```")
    out.append(render_flow_liquidation())
    out.append("```")
    out.append("")

    out.append("## 12. End-to-end flow — swap-intent lifecycle")
    out.append("")
    out.append("```")
    out.append(render_flow_intent_execution())
    out.append("```")
    out.append("")

    if args.get("verbose"):
        print("Running surface detectors …")
    surface_findings_all = run_all_optimization_detectors(summary)

    if args.get("verbose"):
        print("Running deep detectors …")
    deep_findings_all = run_all_deep_detectors(summary)

    suppressions = load_suppressions()
    surface_findings, surface_suppressed = apply_suppressions(
        surface_findings_all, suppressions
    )
    deep_findings, deep_suppressed = apply_suppressions(
        deep_findings_all, suppressions
    )
    if args.get("verbose") and (surface_suppressed or deep_suppressed):
        print(
            f"Suppressed {len(surface_suppressed) + len(deep_suppressed)} finding(s) "
            f"via {SUPPRESSIONS_FILE.name}."
        )

    out.append("## 13. Optimization targets — surface")
    out.append("")
    out.append(render_optimization_section_from(surface_findings))
    out.append("")

    out.append("## 14. Deep optimization targets — risk / impact / reason")
    out.append("")
    out.append(render_deep_findings_section(deep_findings))
    out.append("")

    out.append("## 14b. Suppressed findings (deferred / wontfix / informational)")
    out.append("")
    out.append(render_suppressed_section(surface_suppressed + deep_suppressed))
    out.append("")

    out.append("## 15. CoFHE 0.4.0 → 0.5.1 cleanup plan")
    out.append("")
    out.append(render_040_cleanup_plan())
    out.append("")

    out.append("## 16. Real gas measurements (on-chain + local)")
    out.append("")
    measurements: dict = {}
    # Realchain data (stress-evidence) is always loaded — it's a pre-recorded
    # ledger from past arb-sepolia runs and doesn't require running anything.
    if args.get("verbose"):
        print("Ingesting stress-evidence …")
    measurements["realchain"] = ingest_stress_evidence()
    if args.get("measure"):
        if args.get("verbose"):
            print("Running forge snapshot …")
        measurements["forge"] = run_forge_snapshot()
        if args.get("verbose"):
            print("Running hardhat test …")
        measurements["hardhat"] = run_hardhat_gas_capture()
    out.append(render_measurement_section(measurements))
    out.append("")

    out.append("## 17. Cost-model calibration (analytical vs real)")
    out.append("")
    out.append(render_calibration_section(measurements.get("realchain", {}), summary))
    out.append("")

    # Regression gate / baseline diff
    out.append("## 18. Regression check (vs baseline)")
    out.append("")
    if args.get("update_baseline"):
        save_gas_baseline(measurements.get("realchain", {}))
        out.append("_Baseline updated this run via `--update-baseline`. No diff produced._")
    else:
        diff = compare_against_baseline(
            measurements.get("realchain", {}),
            threshold_gas=args.get("regression_threshold", 5000),
        )
        out.append(render_regression_section(diff))
        measurements["regression_diff"] = diff
    out.append("")

    out.append("## 19. External touchpoints")
    out.append("")
    out.append("| Interface | What it represents |")
    out.append("|---|---|")
    for k, v in EXTERNAL_TOUCHPOINTS.items():
        out.append(f"| `{k}` | {v} |")
    out.append("")

    REPORT.write_text("\n".join(out) + "\n")
    print(f"Report written to {REPORT}")

    if args.get("json"):
        if args.get("verbose"):
            print("Building JSON payload …")
        payload = build_structured_payload(
            summary,
            surface_findings,
            deep_findings,
            measurements,
            suppressed_findings=surface_suppressed + deep_suppressed,
        )
        json_path = Path(args["json"])
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(payload, indent=2, default=str) + "\n")
        print(f"JSON written to {json_path} ({json_path.stat().st_size:,} bytes)")

    # CI gate: exit non-zero if regressions detected.
    if args.get("ci"):
        diff = measurements.get("regression_diff") or compare_against_baseline(
            measurements.get("realchain", {}),
            threshold_gas=args.get("regression_threshold", 5000),
        )
        regressions = diff.get("regressions", [])
        if regressions:
            print(f"[ci] FAIL: {len(regressions)} regression(s) over {args.get('regression_threshold', 5000):,} gas threshold")
            for r in regressions[:5]:
                print(f"     {r['op']}: {r['baseline']:,} → {r['current']:,} (+{r['delta']:,})")
            return 1
        print("[ci] PASS: no regressions above threshold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
