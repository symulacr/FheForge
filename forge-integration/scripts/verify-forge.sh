#!/usr/bin/env bash
#
# verify-forge.sh — Validate forge-manifest.json against codebase sources.
#
# Reads forge-integration/forge-manifest.json and performs these checks:
#   1. JSON Schema conformance (if jsonschema CLI or python3 jsonschema available)
#   2. All 13 file entries exist on disk at the declared paths
#   3. Each file entry has all required fields (id, name, path, type, description, sections, integrationReadiness)
#   4. All sections have required fields (name, description, mockData, integrationReadiness)
#   5. Mock data arrays have required fields (name, fields)
#   6. Builder features count matches actual features array length
#   7. Each builder feature has all required fields
#   8. Tweaks panel controls are complete
#   9. Integration readiness labels are valid enums
#   10. File IDs are unique
#
# Exits 0 if all checks pass, 1 if any failure.
#

set -o pipefail

MANIFEST="forge-integration/forge-manifest.json"
SCHEMA="forge-integration/schemas/forge-manifest.schema.json"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

errors=0
warnings=0

err() {
    echo "  ERROR: $*"
    errors=$((errors + 1))
}

warn() {
    echo "  WARN: $*"
    warnings=$((warnings + 1))
}

pass() {
    echo "  PASS: $*"
}

echo "============================================================"
echo "  forge-integration: verify-forge.sh"
echo "============================================================"

# --- Check jq is available ---
if ! command -v jq &>/dev/null; then
    err "jq is required but not installed"
    echo "RESULT: FAILED (jq missing)"
    exit 1
fi

# --- Load manifest ---
if [ ! -f "$MANIFEST" ]; then
    err "Manifest not found: $MANIFEST"
    echo "RESULT: FAILED"
    exit 1
fi

echo ""
echo "Loaded manifest: version=$(jq -r '.version' "$MANIFEST"), files=$(jq '.files | length' "$MANIFEST"), features=$(jq '.builderFeatures.features | length' "$MANIFEST")"

# --- Check 1: JSON Schema Validation ---
echo ""
echo "--- JSON Schema Validation ---"

if command -v python3 &>/dev/null; then
    if python3 -c "import jsonschema" 2>/dev/null; then
        if [ -f "$SCHEMA" ]; then
            if python3 -c "
import json, sys
from jsonschema import validate, ValidationError
with open('$MANIFEST') as f:
    manifest = json.load(f)
with open('$SCHEMA') as f:
    schema = json.load(f)
try:
    validate(instance=manifest, schema=schema)
    print('PASS: JSON Schema validation')
except ValidationError as e:
    print(f'ERROR: JSON Schema validation failed: {e.message}')
    sys.exit(1)
"; then
                pass "JSON Schema validation"
            else
                err "JSON Schema validation failed"
            fi
        else
            warn "Schema file not found at $SCHEMA — skipping schema validation"
        fi
    else
        warn "jsonschema Python package not installed — skipping schema validation"
    fi
else
    warn "python3 not available — skipping schema validation"
fi

# --- Check 2: All file entries exist on disk ---
echo ""
echo "--- File Existence ---"

file_count=$(jq '.files | length' "$MANIFEST")
if [ "$file_count" -ne 13 ]; then
    err "Expected 13 files, found $file_count"
else
    pass "File count: $file_count"
fi

while read -r path; do
    full_path="$REPO_ROOT/$path"
    if [ -f "$full_path" ]; then
        pass "File exists: $path"
    else
        err "File not found: $path"
    fi
done < <(jq -r '.files[].path' "$MANIFEST")

# --- Check 3: All file entries have required fields ---
echo ""
echo "--- File Entry Required Fields ---"

file_ids=""
duplicate_found=0
while read -r id; do
    if echo "$file_ids" | grep -q "^$id$"; then
        err "Duplicate file id: $id"
        duplicate_found=1
    fi
    file_ids="$file_ids
$id"
done < <(jq -r '.files[].id' "$MANIFEST")

if [ "$duplicate_found" -eq 0 ]; then
    pass "All file IDs are unique"
fi

for field in id name path type description integrationReadiness; do
    missing=$(jq -r ".files[] | select(has(\"$field\") | not) | .id // \"unknown\"" "$MANIFEST")
    if [ -n "$missing" ]; then
        while IFS= read -r fid; do
            err "File '$fid' missing required field '$field'"
        done <<< "$missing"
    else
        pass "All files have field: $field"
    fi
done

# --- Check 4: Integration readiness labels are valid ---
echo ""
echo "--- Integration Readiness Labels ---"

valid_readiness='["ready-to-wire","needs-api","needs-contract","needs-redesign","mock-only"]'
while read -r line; do
    fid=$(echo "$line" | cut -d'|' -f1)
    label=$(echo "$line" | cut -d'|' -f2)
    if ! echo "$valid_readiness" | grep -q "\"$label\""; then
        err "File '$fid' has invalid integrationReadiness: '$label'"
    fi
done < <(jq -r '.files[] | "\(.id)|\(.integrationReadiness)"' "$MANIFEST")

# Check section readiness labels
while read -r line; do
    fid=$(echo "$line" | cut -d'|' -f1)
    secname=$(echo "$line" | cut -d'|' -f2)
    label=$(echo "$line" | cut -d'|' -f3)
    if ! echo "$valid_readiness" | grep -q "\"$label\""; then
        err "File '$fid' section '$secname' has invalid integrationReadiness: '$label'"
    fi
done < <(jq -r '.files[] | .id as $fid | .sections[] | "\($fid)|\(.name)|\(.integrationReadiness)"' "$MANIFEST")

# Check builder feature readiness labels
while read -r line; do
    fname=$(echo "$line" | cut -d'|' -f1)
    label=$(echo "$line" | cut -d'|' -f2)
    if ! echo "$valid_readiness" | grep -q "\"$label\""; then
        err "Builder feature '$fname' has invalid integrationReadiness: '$label'"
    fi
done < <(jq -r '.builderFeatures.features[] | "\(.name)|\(.integrationReadiness)"' "$MANIFEST")

pass "Integration readiness label checks complete"

# --- Check 5: Sections have required fields ---
echo ""
echo "--- Section Required Fields ---"

for field in name description integrationReadiness; do
    missing=$(jq -r '.files[] | .id as $fid | .sections[] | select(has("'$field'") | not) | "\($fid)/\(.name // "<?>")"' "$MANIFEST")
    if [ -n "$missing" ]; then
        while IFS= read -r sect; do
            err "Section '$sect' missing required field '$field'"
        done <<< "$missing"
    fi
done

# Check sections have mockData array
missing_md=$(jq -r '.files[] | .id as $fid | .sections[] | select(has("mockData") | not) | "\($fid)/\(.name // "<?>")"' "$MANIFEST")
if [ -n "$missing_md" ]; then
    while IFS= read -r sect; do
        err "Section '$sect' missing required field 'mockData'"
    done <<< "$missing_md"
fi

pass "Section field checks complete"

# --- Check 6: Mock data arrays ---
echo ""
echo "--- Mock Data Arrays ---"

# Top-level mock data arrays
top_count=$(jq '.mockDataArrays | length' "$MANIFEST")
pass "Top-level mock data arrays: $top_count"

# Top-level mock data arrays have required fields
for field in name fields; do
    missing=$(jq -r ".mockDataArrays[] | select(has(\"$field\") | not) | .name // \"unknown\"" "$MANIFEST")
    if [ -n "$missing" ]; then
        while IFS= read -r mda; do
            err "Top-level mock data '$mda' missing required field '$field'"
        done <<< "$missing"
    fi
done

# Embedded mock data in sections
embedded_count=$(jq '[.files[].sections[].mockData[] | select(length > 0)] | length' "$MANIFEST")
pass "Embedded mock data arrays: $embedded_count"

# --- Check 7: Builder features ---
echo ""
echo "--- Builder Features ---"

feature_count=$(jq '.builderFeatures.features | length' "$MANIFEST")
declared_count=$(jq '.builderFeatures.count' "$MANIFEST")

if [ "$feature_count" -eq "$declared_count" ]; then
    pass "Builder features count matches: $feature_count"
else
    err "Builder features count mismatch: declared=$declared_count actual=$feature_count"
fi

# Check all builder features have required fields
for field in name exists implementation integrationReadiness description; do
    missing=$(jq -r ".builderFeatures.features[] | select(has(\"$field\") | not) | .name // \"unknown\"" "$MANIFEST")
    if [ -n "$missing" ]; then
        while IFS= read -r bf; do
            err "Builder feature '$bf' missing required field '$field'"
        done <<< "$missing"
    fi
done

# Check all features have exists=true
not_exists=$(jq -r '.builderFeatures.features[] | select(.exists != true) | .name' "$MANIFEST")
if [ -n "$not_exists" ]; then
    while IFS= read -r bf; do
        warn "Builder feature '$bf' has exists != true"
    done <<< "$not_exists"
fi

pass "Builder feature checks complete"

# --- Check 8: Tweaks Panel ---
echo ""
echo "--- Tweaks Panel ---"

tp_controls=$(jq '.tweaksPanel.controls | length' "$MANIFEST")
pass "Tweaks panel controls: $tp_controls"

for field in name type description; do
    missing=$(jq -r ".tweaksPanel.controls[] | select(has(\"$field\") | not) | .name // \"unknown\"" "$MANIFEST")
    if [ -n "$missing" ]; then
        while IFS= read -r ctrl; do
            err "Tweaks control '$ctrl' missing required field '$field'"
        done <<< "$missing"
    fi
done

# Check tweaks panel integration readiness is mock-only
tp_ir=$(jq -r '.tweaksPanel.integrationReadiness' "$MANIFEST")
if [ "$tp_ir" != "mock-only" ]; then
    err "Tweaks panel integrationReadiness should be 'mock-only', got '$tp_ir'"
fi

pass "Tweaks panel checks complete"

# --- Check 9: Verify file type enumeration ---
echo ""
echo "--- File Type Enumeration ---"

valid_types='["html-shell","styles","root-app","shared-components","screen","utility","documentation"]'
while read -r line; do
    fid=$(echo "$line" | cut -d'|' -f1)
    ftype=$(echo "$line" | cut -d'|' -f2)
    if ! echo "$valid_types" | grep -q "\"$ftype\""; then
        err "File '$fid' has invalid type: '$ftype'"
    fi
done < <(jq -r '.files[] | "\(.id)|\(.type)"' "$MANIFEST")

pass "File type enumeration checks complete"

# --- Summary ---
echo ""
echo "============================================================"
total=$((errors + warnings))
if [ "$total" -eq 0 ]; then
    echo "  RESULT: All checks passed ✓"
    echo "  Files: $(jq '.files | length' "$MANIFEST") entries verified"
    echo "  Features: $(jq '.builderFeatures.features | length' "$MANIFEST") verified"
    echo "  Mock data arrays: $((top_count + embedded_count)) verified"
    echo "============================================================"
    exit 0
else
    if [ "$errors" -gt 0 ]; then
        echo "  FAILURES: $errors error(s)"
    fi
    if [ "$warnings" -gt 0 ]; then
        echo "  WARNINGS: $warnings warning(s)"
    fi
    echo "============================================================"
    exit 1
fi
