# create_lab_users_prod.ps1 — PRODUCTION-STYLE test user creation.
#
# Creates a cohort of Entra users with the auth friction a real deployment
# would impose: forced password change on first sign-in, and MFA enrollment
# (assuming tenant security defaults are on, which is the default).
#
# Use this to validate that the app behaves correctly for users going through
# the full first-login experience a real client's responders would encounter.
#
# For low-friction developer iteration (no forced password change), use
# create_lab_users_test.ps1 instead.
#
# THIS SCRIPT ASSUMES TENANT SECURITY DEFAULTS ARE ENABLED. If you've
# previously turned them off for test accounts, re-enable before running:
#
#   az rest --method PATCH `
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" `
#     --headers "Content-Type=application/json" `
#     --body '{"isEnabled": true}'
#
# Verify with:
#
#   az rest --method GET `
#     --url "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy" `
#     --query "isEnabled"
#
# Requires: `az login` completed, and the signed-in account must have
# permission to create users in the target Entra tenant.
#
# Usage:
#   ./scripts/create_lab_users_prod.ps1                     # uses defaults below
#   ./scripts/create_lab_users_prod.ps1 -Domain mylab.com   # override domain

param(
    [string]$Domain = "emc1.ca",
    [string]$TempPassword = "TempPass2026!"
)

$users = @(
    # Generic — for deployments without role-based plumbing
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
    @{ principal = "firefighter";                display = "Test - Firefighter" }

    # Incident Management Team — one account, user picks ICS role at login
    @{ principal = "incident_management_team";   display = "Test - Incident Management Team" }

    # App-level admin (not an ICS role; gates collation/report/close powers)
    @{ principal = "site_administrator";         display = "Test - Site Administrator" }
)

Write-Host "Creating $($users.Count) test users in domain '$Domain' (production-style auth)..." -ForegroundColor Cyan

foreach ($u in $users) {
    $upn = "$($u.principal)@$Domain"
    Write-Host "  - $upn"
    az ad user create `
        --display-name $u.display `
        --user-principal-name $upn `
        --password $TempPassword `
        --force-change-password-next-sign-in true | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Failed to create $upn (already exists? check output above)"
    }
}

Write-Host ""
Write-Host "Done. Temporary password for all users: $TempPassword" -ForegroundColor Green
Write-Host "(Each user will be forced to change this on first sign-in.)" -ForegroundColor Green
Write-Host ""
Write-Host "If tenant security defaults are ON (the default), each user will also" -ForegroundColor Green
Write-Host "be forced to enroll MFA via Microsoft Authenticator on first sign-in." -ForegroundColor Green
Write-Host ""
Write-Host "Note: 'Other' is intentionally skipped — it's a fill-in option in the" -ForegroundColor Yellow
Write-Host "role dropdown, not a distinct persona requiring a test user." -ForegroundColor Yellow
