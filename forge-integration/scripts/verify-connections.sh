#!/usr/bin/env bash
#
# verify-connections.sh
# Wave 3: Verify connections.json cross-reference consistency.
#
# Validates:
#  1. Every connection's backendRef exists as an id in backend-manifest.json
#  2. Every connection's forgeFile exists in forge-manifest.json
#  3. All required fields are present and populated
#  4. All JSON files are syntactically valid
#
# Exit code: 0 = all pass, 1 = any failure
#

set -o pipefail
errors=0

BASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CONNECTIONS="$BASE_DIR/forge-integration/connections.json"
BACKEND_MANIFEST="$BASE_DIR/forge-integration/backend-manifest.json"
FORGE_MANIFEST="$BASE_DIR/forge-integration/forge-manifest.json"

echo "=== verify-connections.sh ==="
echo ""

# ------------------------------------------------------------------
# Check required files exist
# ------------------------------------------------------------------
for f in "$CONNECTIONS" "$BACKEND_MANIFEST" "$FORGE_MANIFEST"; do
    if [ ! -f "$f" ]; then
        echo "ERROR: Required file not found: $f"
        errors=$((errors+1))
    fi
done

if [ "$errors" -gt 0 ]; then
    echo ""
    echo "FAILED: $errors prerequisite error(s)"
    exit 1
fi

# ------------------------------------------------------------------
# Validate JSON syntax using jq
# ------------------------------------------------------------------
echo "--- Validating JSON syntax ---"
for f in "$CONNECTIONS" "$BACKEND_MANIFEST" "$FORGE_MANIFEST"; do
    if ! jq empty "$f" 2>/dev/null; then
        echo "ERROR: Invalid JSON in $(basename "$f")"
        errors=$((errors+1))
    else
        echo "  ✓ $(basename "$f") — valid JSON"
    fi
done

# ------------------------------------------------------------------
# Collect all valid backend IDs
# ------------------------------------------------------------------
BACKEND_IDS=$(jq -r '
    (.smartContracts // [])[].id,
    (.apiEndpoints // [])[].id
' "$BACKEND_MANIFEST" | sort -u)

FORGE_FILE_PATHS=$(jq -r '(.files // [])[].path' "$FORGE_MANIFEST" | sort -u)

# ------------------------------------------------------------------
# Validate each connection
# ------------------------------------------------------------------
echo ""
echo "--- Validating connections ---"

CONNECTION_COUNT=$(jq '.connections | length' "$CONNECTIONS")
echo "  Found $CONNECTION_COUNT connections"

for i in $(seq 0 $((CONNECTION_COUNT - 1))); do
    ID=$(jq -r ".connections[$i].id" "$CONNECTIONS")
    FORGE_FILE=$(jq -r ".connections[$i].forgeFile" "$CONNECTIONS")
    BACKEND_REF=$(jq -r ".connections[$i].backendRef" "$CONNECTIONS")
    FORGE_TYPE=$(jq -r ".connections[$i].forgeType" "$CONNECTIONS")
    BACKEND_TYPE=$(jq -r ".connections[$i].backendType" "$CONNECTIONS")
    EFFORT=$(jq -r ".connections[$i].effort" "$CONNECTIONS")
    LOADING=$(jq -r ".connections[$i].loadingState" "$CONNECTIONS")
    ERROR_ST=$(jq -r ".connections[$i].errorState" "$CONNECTIONS")
    EMPTY=$(jq -r ".connections[$i].emptyState" "$CONNECTIONS")
    FHE_PATH=$(jq -r ".connections[$i].fhePath" "$CONNECTIONS")
    PUBLIC_PATH=$(jq -r ".connections[$i].publicPath" "$CONNECTIONS")

    # Check that id is well-formed
    if [[ ! "$ID" =~ ^conn- ]]; then
        echo "  ERROR [$i]: id \"$ID\" does not start with 'conn-'"
        errors=$((errors+1))
    fi

    # Check forgeFile exists in forge-manifest
    if ! echo "$FORGE_FILE_PATHS" | grep -Fxq "$FORGE_FILE"; then
        echo "  ERROR [$i:$ID]: forgeFile \"$FORGE_FILE\" not found in forge-manifest.json"
        errors=$((errors+1))
    fi

    # Check that backendRef is valid (string, array of strings, or null)
    REF_TYPE=$(jq -r ".connections[$i].backendRef | type" "$CONNECTIONS")
    if [ "$REF_TYPE" = "string" ]; then
        REF_VALUE=$(jq -r ".connections[$i].backendRef" "$CONNECTIONS")
        if [ "$REF_VALUE" != "null" ]; then
            if ! echo "$BACKEND_IDS" | grep -Fxq "$REF_VALUE"; then
                echo "  ERROR [$i:$ID]: backendRef \"$REF_VALUE\" not found in backend-manifest.json"
                errors=$((errors+1))
            fi
        fi
    elif [ "$REF_TYPE" = "array" ]; then
        REF_LEN=$(jq ".connections[$i].backendRef | length" "$CONNECTIONS")
        for j in $(seq 0 $((REF_LEN - 1))); do
            REF_VALUE=$(jq -r ".connections[$i].backendRef[$j]" "$CONNECTIONS")
            if ! echo "$BACKEND_IDS" | grep -Fxq "$REF_VALUE"; then
                echo "  ERROR [$i:$ID]: backendRef[$j] \"$REF_VALUE\" not found in backend-manifest.json"
                errors=$((errors+1))
            fi
        done
    elif [ "$REF_TYPE" = "null" ]; then
        # null backendRef is valid (e.g., direct hook integrations like wagmi/cofhe)
        :
    else
        echo "  ERROR [$i:$ID]: backendRef has unexpected type: $REF_TYPE"
        errors=$((errors+1))
    fi

    # Check required state fields are non-empty
    for field_pair in "loadingState:$LOADING" "errorState:$ERROR_ST" "emptyState:$EMPTY"; do
        field_name="${field_pair%%:*}"
        field_val="${field_pair#*:}"
        if [ -z "$field_val" ] || [ "$field_val" = "null" ]; then
            echo "  WARN [$i:$ID]: $field_name is empty"
        fi
    done

    # Check effort format
    if ! [[ "$EFFORT" =~ ^[0-9]+(\.[0-9]+)?[hd]$ ]]; then
        echo "  WARN [$i:$ID]: effort \"$EFFORT\" does not match pattern (e.g., 1d, 1.5d, 4h)"
    fi

    # Check fhePath and publicPath are booleans
    if [ "$FHE_PATH" != "true" ] && [ "$FHE_PATH" != "false" ]; then
        echo "  ERROR [$i:$ID]: fhePath is not boolean: $FHE_PATH"
        errors=$((errors+1))
    fi
    if [ "$PUBLIC_PATH" != "true" ] && [ "$PUBLIC_PATH" != "false" ]; then
        echo "  ERROR [$i:$ID]: publicPath is not boolean: $PUBLIC_PATH"
        errors=$((errors+1))
    fi
done

# ------------------------------------------------------------------
# Validate walletContextMapping
# ------------------------------------------------------------------
echo ""
echo "--- Validating walletContextMapping ---"
WCM_FIELDS=$(jq '.walletContextMapping.fields | length' "$CONNECTIONS")
echo "  Found $WCM_FIELDS wallet context fields"
for i in $(seq 0 $((WCM_FIELDS - 1))); do
    FIELD_ID=$(jq -r ".walletContextMapping.fields[$i].id" "$CONNECTIONS")
    if [[ ! "$FIELD_ID" =~ ^wallet-ctx- ]]; then
        echo "  ERROR [fields[$i]]: id \"$FIELD_ID\" does not start with 'wallet-ctx-'"
        errors=$((errors+1))
    fi
done

# ------------------------------------------------------------------
# Validate connectModalSteps
# ------------------------------------------------------------------
echo ""
echo "--- Validating connectModalSteps ---"
STEPS_COUNT=$(jq '.connectModalSteps.steps | length' "$CONNECTIONS")
echo "  Found $STEPS_COUNT modal steps"
for i in $(seq 0 $((STEPS_COUNT - 1))); do
    STEP_ID=$(jq -r ".connectModalSteps.steps[$i].id" "$CONNECTIONS")
    if [[ ! "$STEP_ID" =~ ^conn-modal-step ]]; then
        echo "  ERROR [steps[$i]]: id \"$STEP_ID\" does not start with 'conn-modal-step'"
        errors=$((errors+1))
    fi
done

# ------------------------------------------------------------------
# Validate gaps
# ------------------------------------------------------------------
echo ""
echo "--- Validating gaps ---"
GAPS_COUNT=$(jq '.gaps.items | length' "$CONNECTIONS")
echo "  Found $GAPS_COUNT gaps"
for i in $(seq 0 $((GAPS_COUNT - 1))); do
    GAP_ID=$(jq -r ".gaps.items[$i].id" "$CONNECTIONS")
    if [[ ! "$GAP_ID" =~ ^gap- ]]; then
        echo "  ERROR [gaps[$i]]: id \"$GAP_ID\" does not start with 'gap-'"
        errors=$((errors+1))
    fi
done

# ------------------------------------------------------------------
# Validate dependencyGraph edges
# ------------------------------------------------------------------
echo ""
echo "--- Validating dependencyGraph ---"
EDGES_COUNT=$(jq '.dependencyGraph.edges | length' "$CONNECTIONS")
echo "  Found $EDGES_COUNT dependency edges"
VALID_TYPES=("ui" "data" "tx" "wallet" "auth")
for i in $(seq 0 $((EDGES_COUNT - 1))); do
    EDGE_TYPE=$(jq -r ".dependencyGraph.edges[$i].type" "$CONNECTIONS")
    EDGE_FROM=$(jq -r ".dependencyGraph.edges[$i].from" "$CONNECTIONS")
    valid=0
    for vt in "${VALID_TYPES[@]}"; do
        if [ "$EDGE_TYPE" = "$vt" ]; then
            valid=1
            break
        fi
    done
    if [ "$valid" -eq 0 ]; then
        echo "  ERROR [edges[$i]:$EDGE_FROM]: invalid type \"$EDGE_TYPE\" (must be ui|data|tx|wallet|auth)"
        errors=$((errors+1))
    fi
done

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "=== Results ==="
if [ "$errors" -eq 0 ]; then
    echo "All checks passed"
    exit 0
else
    echo "FAILED: $errors error(s)"
    exit 1
fi
