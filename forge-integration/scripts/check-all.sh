#!/usr/bin/env bash
#
# check-all.sh — Master verification runner for forge-integration.
#
# Runs all verification scripts and checks:
#   1. check-forge-immutable.sh  — Verify 13 forge files are unmodified
#   2. verify-backend.py          — Validate backend-manifest.json against source code
#   3. verify-forge.sh            — Validate forge-manifest.json against files
#   4. verify-connections.sh      — Validate connections.json cross-references
#   5. JSON Schema validation     — Validate all 3 JSON files against their schemas (optional)
#
# Exits 0 if ALL checks pass, non-zero if any check fails.
#

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FORGE_DIR="$REPO_ROOT/forge-integration"

passed=0
failed=0
skipped=0
failed_tests=""

pass() {
    local label="$1"
    passed=$((passed + 1))
    echo "  [PASS] $label"
}

fail() {
    local label="$1"
    failed=$((failed + 1))
    failed_tests="$failed_tests  - $label"$'\n'
    echo "  [FAIL] $label"
}

skip() {
    local label="$1"
    skipped=$((skipped + 1))
    echo "  [SKIP] $label"
}

echo "============================================================"
echo "  Forge Integration — Complete Verification Suite"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"
echo ""

# ============================================================
# Helper: run a check and report pass/fail
# ============================================================
run_check() {
    local desc="$1"
    shift
    local cmd=("$@")

    echo "--- $desc ---"
    echo "  Running: ${cmd[*]}"
    echo ""

    if "${cmd[@]}"; then
        pass "$desc"
    else
        local rc=$?
        # Exit code 127 means command not found
        if [ "$rc" -eq 127 ]; then
            fail "$desc (command not found)"
        else
            fail "$desc (exit code $rc)"
        fi
    fi
    echo ""
}

# ============================================================
# 1. Forge File Immutability
# ============================================================
echo "============================================================"
echo "  CHECK 1: Forge File Immutability"
echo "============================================================"
echo ""

run_check "Forge files unmodified (check-forge-immutable.sh)" \
    bash "$SCRIPT_DIR/check-forge-immutable.sh"

# ============================================================
# 2. Backend Manifest Verification
# ============================================================
echo "============================================================"
echo "  CHECK 2: Backend Manifest Verification"
echo "============================================================"
echo ""

if command -v python3 &>/dev/null; then
    run_check "Backend manifest (verify-backend.py)" \
        python3 "$SCRIPT_DIR/verify-backend.py"
else
    skip "Backend manifest (python3 not available)"
fi

# ============================================================
# 3. Forge Manifest Verification
# ============================================================
echo "============================================================"
echo "  CHECK 3: Forge Manifest Verification"
echo "============================================================"
echo ""

run_check "Forge manifest (verify-forge.sh)" \
    bash "$SCRIPT_DIR/verify-forge.sh"

# ============================================================
# 4. Connections Verification
# ============================================================
echo "============================================================"
echo "  CHECK 4: Connections Verification"
echo "============================================================"
echo ""

run_check "Connections (verify-connections.sh)" \
    bash "$SCRIPT_DIR/verify-connections.sh"

# ============================================================
# 5. JSON Schema Validation (optional)
# ============================================================
echo "============================================================"
echo "  CHECK 5: JSON Schema Validation (optional)"
echo "============================================================"
echo ""

if command -v python3 &>/dev/null && python3 -c "import jsonschema" 2>/dev/null; then
    echo "--- Validate backend-manifest.json against schema ---"
    if python3 -c "
import json, sys
from jsonschema import validate, ValidationError
with open('$FORGE_DIR/backend-manifest.json') as f:
    manifest = json.load(f)
with open('$FORGE_DIR/schemas/backend-manifest.schema.json') as f:
    schema = json.load(f)
try:
    validate(instance=manifest, schema=schema)
    print('  PASS: backend-manifest.json conforms to schema')
except ValidationError as e:
    print(f'  FAIL: {e.message}')
    sys.exit(1)
"; then
        pass "backend-manifest.json schema validation"
    else
        fail "backend-manifest.json schema validation"
    fi
    echo ""

    echo "--- Validate forge-manifest.json against schema ---"
    if python3 -c "
import json, sys
from jsonschema import validate, ValidationError
with open('$FORGE_DIR/forge-manifest.json') as f:
    manifest = json.load(f)
with open('$FORGE_DIR/schemas/forge-manifest.schema.json') as f:
    schema = json.load(f)
try:
    validate(instance=manifest, schema=schema)
    print('  PASS: forge-manifest.json conforms to schema')
except ValidationError as e:
    print(f'  FAIL: {e.message}')
    sys.exit(1)
"; then
        pass "forge-manifest.json schema validation"
    else
        fail "forge-manifest.json schema validation"
    fi
    echo ""

    echo "--- Validate connections.json against schema ---"
    if python3 -c "
import json, sys
from jsonschema import validate, ValidationError
with open('$FORGE_DIR/connections.json') as f:
    manifest = json.load(f)
with open('$FORGE_DIR/schemas/connections.schema.json') as f:
    schema = json.load(f)
try:
    validate(instance=manifest, schema=schema)
    print('  PASS: connections.json conforms to schema')
except ValidationError as e:
    print(f'  FAIL: {e.message}')
    sys.exit(1)
"; then
        pass "connections.json schema validation"
    else
        fail "connections.json schema validation"
    fi
    echo ""
else
    skip "JSON Schema validation (jsonschema Python package not available)"
fi

# ============================================================
# Summary
# ============================================================
echo "============================================================"
echo "  VERIFICATION SUMMARY"
echo "============================================================"
echo ""
echo "  Passed:  $passed"
echo "  Failed:  $failed"
echo "  Skipped: $skipped"
echo ""

if [ "$failed" -eq 0 ]; then
    echo "  RESULT: ALL CHECKS PASSED ✓"
    echo "============================================================"
    exit 0
else
    echo "  RESULT: $failed CHECK(S) FAILED ✗"
    echo ""
    echo "Failed checks:"
    echo "$failed_tests"
    echo "============================================================"
    exit 1
fi
