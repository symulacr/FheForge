#!/usr/bin/env bash
#
# check-forge-immutable.sh — Verify 13 forge files have not been modified.
#
# Computes sha256sum of each forge file in ui/ and compares against
# known-good checksums recorded at Phase 3 verification time.
# Exits 0 if all checksums match, 1 if any mismatch (file modified).
#

set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
errors=0

# Known-good SHA256 checksums for the 13 immutable forge files
# Generated at Phase 3 verification time (2026-06-02)
declare -A CHECKSUMS=(
    ["ui/FheForge.html"]="ad6c7e1b8659f1bd9c954319b8ca4a6ed948b31ef50232b7935fc9b3fa32e3fb"
    ["ui/theme.css"]="c5de67f3f5e642dd59ba8cfafe8d1c77ec8aa8b15d1cd4772e28af13154cabb8"
    ["ui/app.jsx"]="66014ebfa75f43bf20cf7f2ac741b03eb62cd2033e05ab6f5ce83490454f65a2"
    ["ui/components.jsx"]="c045e96190af375145fcdebc79e36e5ac03a3af2bb2733e4eb107bb0e6c23c0a"
    ["ui/screens/landing.jsx"]="bf92cd9148fe7928ed21b4305baf10ec4d5c58f129b4510867b3884265109292"
    ["ui/screens/dashboard.jsx"]="683d48306c9886bd28a471f64baa30bbe9f8dd0086982ea4bdbe60070e4b0662"
    ["ui/screens/lending.jsx"]="0b91a3f9426a11f2d0090331220ab9e8bfc5e66aab8b03d46bf87384503290d5"
    ["ui/screens/market.jsx"]="65c043bee1ec2a41f8b06dce78fb7d777115dafed8643d6c703f3612fd358533"
    ["ui/screens/builder-workspace.jsx"]="9b77fd92a70169e8c7a26eab5d41af58f964f98d2db584e8a42a03a003838fff"
    ["ui/screens/governance.jsx"]="3178ed74dac3f687c342a0e40a3d60ead750c30fd5263bb5ebe3b0cdecd35044"
    ["ui/screens/connect-modal.jsx"]="35b65962f519887b6388d4dd619a9b825f260a2f573f2066d04a616fdc9bb7b9"
    ["ui/tweaks-panel.jsx"]="7f64c6909a8b4f1700043a0998563f2412f8228823b940e22f2da40ff41851ac"
    ["ui/uploads/MOCKUP_HANDOFF.md"]="7c036954e301d6f17dad6ee1ef3dca43da0648c98a1a9b3a62bd9e74c273d188"
)

echo "============================================================"
echo "  check-forge-immutable.sh — Verify forge file integrity"
echo "============================================================"
echo ""

# Ensure all files exist before checking
all_exist=true
for file_rel in "${!CHECKSUMS[@]}"; do
    full_path="$REPO_ROOT/$file_rel"
    if [ ! -f "$full_path" ]; then
        echo "  ERROR: File not found: $file_rel"
        errors=$((errors + 1))
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    echo ""
    echo "RESULT: FAILED — $errors file(s) missing"
    exit 1
fi

# Verify checksums
check_count=0
for file_rel in "${!CHECKSUMS[@]}"; do
    full_path="$REPO_ROOT/$file_rel"
    expected="${CHECKSUMS[$file_rel]}"
    actual=$(sha256sum "$full_path" | cut -d' ' -f1)

    if [ "$actual" = "$expected" ]; then
        echo "  OK   $file_rel"
        check_count=$((check_count + 1))
    else
        echo "  MODIFIED  $file_rel"
        echo "    Expected: $expected"
        echo "    Actual:   $actual"
        errors=$((errors + 1))
    fi
done

echo ""
echo "  Checked: $check_count files"
if [ "$errors" -eq 0 ]; then
    echo "  RESULT: All 13 forge files are intact and unmodified ✓"
    echo "============================================================"
    exit 0
else
    echo "  RESULT: FAILED — $errors file(s) have been modified"
    echo "  (Forge files in ui/ must not be changed)"
    echo "============================================================"
    exit 1
fi
