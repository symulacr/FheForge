#!/usr/bin/env python3
"""
verify-backend.py — Validate backend-manifest.json against codebase sources.

Reads forge-integration/backend-manifest.json and performs these checks:
  1. JSON Schema conformance
  2. All smart contract source files exist
  3. All ABI files exist
  4. All contract addresses are valid 0x…40 hex
  5. All write functions have description
  6. All API endpoint source files exist
  7. Every endpoint has required metadata
  8. FHE markers have consistent structure
  9. No duplicate IDs among contracts or endpoints

Exits 0 if all checks pass, 1 if any failure.
"""

import json
import os
import re
import sys

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "backend-manifest.json")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "..", "schemas", "backend-manifest.schema.json")
REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))

errors = []
warnings = []


def err(msg: str) -> None:
    errors.append(msg)
    print(f"  ERROR: {msg}")


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"  WARN: {msg}")


def file_exists(path: str) -> bool:
    full = os.path.join(REPO_ROOT, path)
    return os.path.isfile(full)


def is_valid_address(addr: str) -> bool:
    return bool(re.match(r"^0x[a-fA-F0-9]{40}$", addr))


def check_json_schema() -> None:
    """Validate manifest JSON Schema conformance."""
    try:
        from jsonschema import validate, ValidationError
    except ImportError:
        warn("jsonschema package not installed — skipping schema validation")
        return

    if not os.path.isfile(SCHEMA_PATH):
        warn(f"Schema file not found at {SCHEMA_PATH} — skipping schema validation")
        return

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)

    try:
        validate(instance=manifest, schema=schema)
        print("  PASS: JSON Schema validation")
    except ValidationError as e:
        err(f"JSON Schema validation failed: {e.message}")


def check_contracts(manifest: dict) -> None:
    """Validate every smart contract entry."""
    seen_ids = set()
    for i, contract in enumerate(manifest.get("smartContracts", [])):
        cid = contract.get("id", f"<index {i}>")

        # --- Duplicate IDs ---
        if cid in seen_ids:
            err(f"Contract '{cid}' — duplicate id")
        seen_ids.add(cid)

        # --- Required fields ---
        for field in ("id", "name", "address", "abiPath", "sourceFile", "description"):
            if field not in contract:
                err(f"Contract '{cid}' — missing required field '{field}'")

        # --- Address format ---
        addr = contract.get("address", "")
        if addr and not is_valid_address(addr):
            err(f"Contract '{cid}' — invalid address '{addr}'")

        # --- Source file exists ---
        src = contract.get("sourceFile", "")
        if src and not file_exists(src):
            err(f"Contract '{cid}' — source file not found: {src}")

        # --- ABI file exists ---
        abi = contract.get("abiPath", "")
        if abi and not file_exists(abi):
            err(f"Contract '{cid}' — ABI file not found: {abi}")

        # --- Functions ---
        for ftype in ("readFunctions", "writeFunctions"):
            for fn in contract.get(ftype, []):
                fn_name = fn.get("name", "<?>")
                if "signature" not in fn:
                    err(f"Contract '{cid}' — {ftype}.{fn_name} missing 'signature'")
                if "params" not in fn:
                    err(f"Contract '{cid}' — {ftype}.{fn_name} missing 'params'")
                if "fheEncrypted" not in fn:
                    err(f"Contract '{cid}' — {ftype}.{fn_name} missing 'fheEncrypted'")
                if "stateMutability" not in fn:
                    err(f"Contract '{cid}' — {ftype}.{fn_name} missing 'stateMutability'")
                else:
                    sm = fn["stateMutability"]
                    if sm not in ("view", "pure", "nonpayable", "payable"):
                        err(f"Contract '{cid}' — {ftype}.{fn_name} invalid stateMutability '{sm}'")
                # Write functions should have descriptions
                if ftype == "writeFunctions" and "description" not in fn:
                    warn(f"Contract '{cid}' — {ftype}.{fn_name} missing 'description'")

        # --- Events ---
        seen_events = set()
        for ev in contract.get("events", []):
            ev_name = ev.get("name", "<?>")
            if ev_name in seen_events:
                err(f"Contract '{cid}' — duplicate event '{ev_name}'")
            seen_events.add(ev_name)
            if "signature" not in ev:
                err(f"Contract '{cid}' — event '{ev_name}' missing 'signature'")
            if "params" not in ev:
                err(f"Contract '{cid}' — event '{ev_name}' missing 'params'")
            for p in ev.get("params", []):
                if "type" not in p:
                    err(f"Contract '{cid}' — event '{ev_name}' param missing 'type'")

        # --- FHE Markers ---
        fhe = contract.get("fheMarkers", {})
        if not isinstance(fhe, dict):
            err(f"Contract '{cid}' — fheMarkers must be an object")
        else:
            for fhe_field in ("encryptedTypes", "fheOperations", "aclPatterns"):
                if fhe_field not in fhe:
                    warn(f"Contract '{cid}' — fheMarkers missing '{fhe_field}'")
                elif not isinstance(fhe[fhe_field], list):
                    err(f"Contract '{cid}' — fheMarkers.{fhe_field} must be an array")

        # --- Error codes ---
        for ec in contract.get("errorCodes", []):
            if "name" not in ec:
                err(f"Contract '{cid}' — errorCode missing 'name'")
            if "description" not in ec:
                err(f"Contract '{cid}' — errorCode '{ec.get('name', '<?>')}' missing 'description'")


def check_api_endpoints(manifest: dict) -> None:
    """Validate every API endpoint entry."""
    seen_ids = set()
    valid_methods = {"GET", "POST", "PUT", "PATCH", "DELETE"}
    for i, ep in enumerate(manifest.get("apiEndpoints", [])):
        eid = ep.get("id", f"<index {i}>")

        # --- Duplicate IDs ---
        if eid in seen_ids:
            err(f"Endpoint '{eid}' — duplicate id")
        seen_ids.add(eid)

        # --- Required fields ---
        for field in ("id", "name", "method", "path", "auth", "sourceFile", "description"):
            if field not in ep:
                err(f"Endpoint '{eid}' — missing required field '{field}'")

        # --- Valid HTTP method ---
        method = ep.get("method", "")
        if method and method not in valid_methods:
            err(f"Endpoint '{eid}' — invalid HTTP method '{method}'")

        # --- Valid auth ---
        auth = ep.get("auth", "")
        if auth and auth not in ("public", "jwt"):
            warn(f"Endpoint '{eid}' — unusual auth value '{auth}'")

        # --- Source file exists ---
        src = ep.get("sourceFile", "")
        if src and not file_exists(src):
            err(f"Endpoint '{eid}' — source file not found: {src}")

        # --- Path format ---
        path = ep.get("path", "")
        if path and not path.startswith("/"):
            err(f"Endpoint '{eid}' — path must start with '/': '{path}'")

        # --- Error codes ---
        for ec in ep.get("errorCodes", []):
            if "code" not in ec:
                err(f"Endpoint '{eid}' — errorCode missing 'code'")
            if "description" not in ec:
                err(f"Endpoint '{eid}' — errorCode missing 'description'")

        # --- Request shape ---
        if "requestShape" not in ep:
            warn(f"Endpoint '{eid}' — missing 'requestShape'")

        # --- Response shape ---
        if "responseShape" not in ep:
            warn(f"Endpoint '{eid}' — missing 'responseShape'")


def main() -> int:
    print("=" * 60)
    print("  forge-integration: verify-backend.py")
    print("=" * 60)

    # --- Load manifest ---
    if not os.path.isfile(MANIFEST_PATH):
        err(f"Manifest not found: {MANIFEST_PATH}")
        return 1

    with open(MANIFEST_PATH) as f:
        try:
            manifest = json.load(f)
        except json.JSONDecodeError as e:
            err(f"Invalid JSON in manifest: {e}")
            return 1

    print(f"\nLoaded manifest: version={manifest.get('version')}, "
          f"contracts={len(manifest.get('smartContracts', []))}, "
          f"endpoints={len(manifest.get('apiEndpoints', []))}")

    # --- Check 1: JSON Schema ---
    print("\n--- Schema Validation ---")
    check_json_schema()

    # --- Check 2: Smart Contracts ---
    print("\n--- Smart Contracts ---")
    check_contracts(manifest)

    # --- Check 3: API Endpoints ---
    print("\n--- API Endpoints ---")
    check_api_endpoints(manifest)

    # --- Summary ---
    print("\n" + "=" * 60)
    total = len(errors) + len(warnings)
    if total == 0:
        print("  RESULT: All checks passed ✓")
        print(f"  Contracts: {len(manifest.get('smartContracts', []))} verified")
        print(f"  Endpoints: {len(manifest.get('apiEndpoints', []))} verified")
        print("=" * 60)
        return 0
    else:
        if errors:
            print(f"  FAILURES: {len(errors)} error(s)")
        if warnings:
            print(f"  WARNINGS: {len(warnings)} warning(s)")
        print("=" * 60)
        return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
