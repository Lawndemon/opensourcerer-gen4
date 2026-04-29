# create_lab_users_test.ps1 — LOW-FRICTION test user creation.
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
#   az rest --method PATCH `
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" `
#     --headers "Content-Type=application/json" `
#     --body '{"isEnabled": false}'
#
# To re-enable security defaults later, pass --body '{"isEnabled": true}'.
#
# For production-style account setup (forced password change, MFA kept on),
# use create_lab_users_prod.ps1 instead.
#
# Requires: `az login` completed, and the signed-in account must have
# permission to create users in the target Entra tenant.
#
# Usage:
#   ./scripts/create_lab_users_test.ps1                     # uses defaults below
#   ./scripts/create_lab_users_test.ps1 -Domain mylab.com   # override domain

param(
    [string]$Domain = "emc1.ca",
    [string]$TempPassword = "TempPass2026!"
)

$users = @(
    # Generic — for deployments without role-based plumbing (Entra groups absent
    # or client scenario too simple for full role taxonomy)
    @{ principal = "generic_user";               display = "Test - Generic User" }

    # ICS Command
    @{ principal = "incident_commander";         display = "Test - Incident Commander" }

    # ICS Command Staff
    @{ principal = "safety_officer";             display = "Test - Safety Officer" }
    @{ principal = "liaison_officer";            display = "Test - Liaison Officer" }
    @{ principal = "information_officer";        display = "Test - Information Officer (PIO)" }

    # ICS General Staff (Section Chiefs)
    @{ principal = "section_chief_operations";   display = "Test - Section Chief, Operations" }
    @{ principal = "section_chief_planning";     display = "Test - Section Chief, Planning" }
    @{ principal = "section_chief_logistics";    display = "Test - Section Chief, Logistics" }
    @{ principal = "section_chief_finance";      display = "Test - Section Chief, Finance/Admin" }

    # Field
    @{ principal = "fireofficer";                display = "Test - Fire Officer" }

    # Incident Management Team — one account, user picks ICS role at login
    @{ principal = "incident_management_team";   display = "Test - Incident Management Team" }

    # App-level admin (not an ICS role; gates collation/report/close powers)
    @{ principal = "site_administrator";         display = "Test - Site Administrator" }
)

Write-Host "Creating $($users.Count) test users in domain '$Domain'..." -ForegroundColor Cyan

foreach ($u in $users) {
    $upn = "$($u.principal)@$Domain"
    Write-Host "  - $upn"
    az ad user create `
        --display-name $u.display `
        --user-principal-name $upn `
        --password $TempPassword `
        --force-change-password-next-sign-in false | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Failed to create $upn (already exists? check output above)"
    }
}

Write-Host ""
Write-Host "Done. Password for all users: $TempPassword" -ForegroundColor Green
Write-Host "(Not forced to change on first sign-in — lab-only convenience.)" -ForegroundColor Green
Write-Host ""
Write-Host "Note: 'Other' is intentionally skipped — it's a fill-in option in the" -ForegroundColor Yellow
Write-Host "role dropdown, not a distinct persona requiring a test user." -ForegroundColor Yellow
