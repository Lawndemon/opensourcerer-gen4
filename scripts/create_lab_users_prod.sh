#!/bin/bash
# create_lab_users_prod.sh — PRODUCTION-STYLE test user creation.
#
# Creates a cohort of Entra users with the auth friction a real deployment
# would impose: forced password change on first sign-in, and MFA enrollment
# (assuming tenant security defaults are on, which is the default).
#
# Use this to validate that the app behaves correctly for users going through
# the full first-login experience a real client's responders would encounter.
#
# For low-friction developer iteration (no forced password change), use
# create_lab_users_test.sh instead.
#
# THIS SCRIPT ASSUMES TENANT SECURITY DEFAULTS ARE ENABLED. If you've
# previously turned them off for test accounts, re-enable before running:
#
#   az rest --method PATCH \
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" \
#     --headers "Content-Type=application/json" \
#     --body '{"isEnabled": true}'
#
# Verify with:
#
#   az rest --method GET \
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" \
#     --query "isEnabled"
#
# Requires: `az login` completed, and the signed-in account must have
# permission to create users in the target Entra tenant.
#
# Usage:
#   ./scripts/create_lab_users_prod.sh                    # uses defaults
#   ./scripts/create_lab_users_prod.sh mylab.com          # override domain
#   ./scripts/create_lab_users_prod.sh mylab.com MyPass1! # override both

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

echo "Creating ${#USERS[@]} test users in domain '${DOMAIN}' (production-style auth)..."

for user in "${USERS[@]}"; do
    IFS='|' read -r principal display <<< "$user"
    upn="${principal}@${DOMAIN}"
    echo "  - $upn"

    if ! az ad user create \
        --display-name "$display" \
        --user-principal-name "$upn" \
        --password "$TEMP_PASSWORD" \
        --force-change-password-next-sign-in true > /dev/null 2>&1; then
        echo "    WARN: Failed to create $upn (already exists? run with verbose az for details)"
    fi
done

echo ""
echo "Done. Temporary password for all users: ${TEMP_PASSWORD}"
echo "(Each user will be forced to change this on first sign-in.)"
echo ""
echo "If tenant security defaults are ON (the default), each user will also be"
echo "forced to enroll MFA via Microsoft Authenticator on first sign-in."
echo ""
echo "Note: 'Other' is intentionally skipped — it's a fill-in option in the"
echo "role dropdown, not a distinct persona requiring a test user."
