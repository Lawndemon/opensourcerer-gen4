#!/bin/bash
# create_lab_users_test.sh — LOW-FRICTION test user creation.
#
# Creates a cohort of Entra users for developer testing of role flows. Tuned
# for minimum auth friction: no forced password change on first sign-in.
#
# Each user represents one of the functional roles defined in the application
# (ICS positions, a field role, site administrator) plus a "generic" user with
# no role affinity. Useful for validating authentication flow and later for
# exercising role-based RAG retrieval once that system is built.
#
# THIS SCRIPT INTENTIONALLY DOES NOT ALTER TENANT SECURITY SETTINGS. If you
# also want to skip MFA enrollment for these users, you must separately turn
# OFF security defaults at the tenant level. This is a TENANT-WIDE change
# that also drops MFA for your admin account — use with care, and only in a
# personal lab. Copy-paste:
#
#   az rest --method PATCH \
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" \
#     --headers "Content-Type=application/json" \
#     --body '{"isEnabled": false}'
#
# To re-enable security defaults later:
#
#   az rest --method PATCH \
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" \
#     --headers "Content-Type=application/json" \
#     --body '{"isEnabled": true}'
#
# For production-style account setup (forced password change, MFA kept on),
# use create_lab_users_prod.sh instead.
#
# Requires: `az login` completed, and the signed-in account must have
# permission to create users in the target Entra tenant.
#
# Usage:
#   ./scripts/create_lab_users_test.sh                    # uses defaults
#   ./scripts/create_lab_users_test.sh mylab.com          # override domain
#   ./scripts/create_lab_users_test.sh mylab.com MyPass1! # override both

DOMAIN="${1:-emc1.ca}"
TEMP_PASSWORD="${2:-TempPass2026!}"

# Format: "principal|display name"
USERS=(
    # Generic — for deployments without role-based plumbing
    "generic_user|Test - Generic User"

    # ICS Command
    "incident_commander|Test - Incident Commander"

    # ICS Command Staff
    "safety_officer|Test - Safety Officer"
    "liaison_officer|Test - Liaison Officer"
    "information_officer|Test - Information Officer (PIO)"

    # ICS General Staff (Section Chiefs)
    "section_chief_operations|Test - Section Chief, Operations"
    "section_chief_planning|Test - Section Chief, Planning"
    "section_chief_logistics|Test - Section Chief, Logistics"
    "section_chief_finance|Test - Section Chief, Finance/Admin"

    # Field
    "firefighter|Test - Firefighter"

    # Incident Management Team — one account, user picks ICS role at login
    "incident_management_team|Test - Incident Management Team"

    # App-level admin (not an ICS role; gates collation/report/close powers)
    "site_administrator|Test - Site Administrator"
)

echo "Creating ${#USERS[@]} test users in domain '${DOMAIN}'..."

for user in "${USERS[@]}"; do
    IFS='|' read -r principal display <<< "$user"
    upn="${principal}@${DOMAIN}"
    echo "  - $upn"

    if ! az ad user create \
        --display-name "$display" \
        --user-principal-name "$upn" \
        --password "$TEMP_PASSWORD" \
        --force-change-password-next-sign-in false > /dev/null 2>&1; then
        echo "    WARN: Failed to create $upn (already exists? run with verbose az for details)"
    fi
done

echo ""
echo "Done. Password for all users: ${TEMP_PASSWORD}"
echo "(Not forced to change on first sign-in — lab-only convenience.)"
echo ""
echo "Note: 'Other' is intentionally skipped — it's a fill-in option in the"
echo "role dropdown, not a distinct persona requiring a test user."
