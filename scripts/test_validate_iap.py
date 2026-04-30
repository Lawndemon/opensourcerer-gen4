"""
test_validate_iap.py — smoke test for the Validate IAP endpoint.

Reads a transcript fixture, POSTs it to the deployed `/api/incidents/{id}/validate-iap` endpoint,
and prints a human-readable summary of the response (Scene Summary, traffic-light counts, items
list, forms generated).

Usage:
    # Test one fixture
    python scripts/test_validate_iap.py --host <host> --token <token> --fixture 1

    # Test all three fixtures in sequence
    python scripts/test_validate_iap.py --host <host> --token <token> --all

    # Use a token file so you don't have to paste it on every run
    python scripts/test_validate_iap.py --host <host> --token-file ~/.iap_token --all

Where to get --host:
    Run `azd env get-values | grep BACKEND_URI` in the project root, or look at the URL of the
    deployed app when you sign in. Pass it without the protocol (no "https://").

Where to get --token (one-time per browser session):
    1. Sign into the deployed app in your browser with a Fire Officer (or any) account.
    2. Press F12 to open DevTools, click the Network tab.
    3. Send any chat message in the app to trigger a network request.
    4. Click the row labelled "chat" (the /chat request).
    5. In the right panel, find "Request Headers" and look for the line:
           Authorization: Bearer eyJ0eXAi...
    6. Copy everything AFTER "Bearer " (the token starts with `eyJ` and is ~1500 characters).

Dependencies: only the `requests` library, which the data-science Python you have already
includes. If not, `pip install requests`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

FIXTURES_DIR = Path(__file__).parent.parent / "app" / "backend" / "fixtures" / "transcripts"

STATUS_BADGE = {
    "conforming": "[GREEN check ]",
    "deviating_safe": "[YELLOW !   ]",
    "deviating_unsafe": "[RED   X    ]",
}


def run_fixture(
    host: str,
    fixture_path: Path,
    incident_id: str,
    *,
    token: str | None = None,
    cookie: str | None = None,
) -> bool:
    """Run one fixture against the deployed endpoint. Returns True on success.

    Auth: pass either `token` (a JWT for Authorization: Bearer ...) OR `cookie`
    (the AppServiceAuthSession value from the browser session).
    """
    print(f"\n{'=' * 78}")
    print(f"FIXTURE  {fixture_path.name}")
    print(f"{'=' * 78}")

    with open(fixture_path) as f:
        fixture = json.load(f)

    print(f"Scenario: {fixture['description']}")
    print()

    body = {
        "transcript": fixture["transcript"],
        "actingRole": "fire-officer",
    }

    url = f"https://{host}/api/incidents/{incident_id}/validate-iap"
    print(f"POST {url}")

    headers = {"Content-Type": "application/json"}
    cookies: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if cookie:
        cookies["AppServiceAuthSession"] = cookie

    try:
        resp = requests.post(
            url,
            json=body,
            headers=headers,
            cookies=cookies,
            timeout=120,
        )
    except requests.exceptions.RequestException as e:
        print(f"FAILED: network error — {e}")
        return False

    if resp.status_code != 200:
        print(f"FAILED: HTTP {resp.status_code}")
        try:
            print(json.dumps(resp.json(), indent=2)[:2000])
        except ValueError:
            print(resp.text[:2000])
        return False

    data = resp.json()

    print()
    print("--- SCENE SUMMARY ---")
    print(data["sceneSummary"]["text"])
    print()

    items = data.get("sceneConditionsAndActions", [])
    counts = {"conforming": 0, "deviating_safe": 0, "deviating_unsafe": 0}
    print(f"--- SCENE CONDITIONS AND ACTIONS  ({len(items)} items) ---")
    for item in items:
        badge = STATUS_BADGE.get(item["status"], item["status"])
        type_label = item["type"].upper().ljust(9)
        print(f"  {badge}  ({type_label})  {item['text']}")
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    print()
    print(
        f"Counts:  green={counts['conforming']}  "
        f"yellow={counts['deviating_safe']}  "
        f"red={counts['deviating_unsafe']}"
    )

    forms = data.get("forms", [])
    print()
    print(f"--- FORMS  ({len(forms)} forms) ---")
    for form in forms:
        kind = form["content"]["kind"]
        if kind == "ics_201":
            content = form["content"]
            print(f"  [{form['status']}]  ICS 201")
            print(f"        Incident name:    {content['incidentName']}")
            print(f"        Initiated:        {content['dateTimeInitiated']}")
            print(f"        Situation:        {content['situationSummary'][:80]}")
            print(f"        Objectives:       {content['currentObjectives'][:80]}")
            print(f"        Current actions:  {content['currentActions'][:80]}")
            print(f"        Resources:        {content['resourceSummary'][:80]}")
            print(f"        Prepared by:      {content['preparedBy']}")
        else:
            sections = form["content"].get("sections", [])
            print(
                f"  [{form['status']}]  {form['title']}  ({form['content']['formType']}, {len(sections)} sections)"
            )

    print()
    print("Full response saved to:", _save_response(data, fixture_path.stem, incident_id))
    return True


def _save_response(data: dict, fixture_name: str, incident_id: str) -> Path:
    """Save the full JSON response next to the fixtures so you can inspect it later."""
    out_dir = Path(__file__).parent.parent / "app" / "backend" / "fixtures" / "transcripts" / "_responses"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{fixture_name}__{incident_id}.json"
    out_path.write_text(json.dumps(data, indent=2))
    return out_path


def _resolve_auth(args: argparse.Namespace) -> tuple[str | None, str | None]:
    """Returns (token, cookie). Exactly one is non-None."""
    if args.cookie:
        return None, args.cookie
    if args.cookie_file:
        path = Path(args.cookie_file).expanduser()
        if not path.exists():
            sys.exit(f"--cookie-file not found: {path}")
        return None, path.read_text().strip()
    if args.token:
        return args.token, None
    if args.token_file:
        path = Path(args.token_file).expanduser()
        if not path.exists():
            sys.exit(f"--token-file not found: {path}")
        return path.read_text().strip(), None
    sys.exit(
        "must provide one of: --token / --token-file (Bearer auth), "
        "or --cookie / --cookie-file (Easy Auth session cookie)"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke-test the Validate IAP endpoint against deployed fixtures.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--host", required=True, help="Deployed host (no protocol)")
    parser.add_argument("--token", help="Bearer token (JWT) for the Authorization header")
    parser.add_argument("--token-file", help="Path to a file containing the bearer token")
    parser.add_argument(
        "--cookie",
        help="AppServiceAuthSession cookie value (from Easy Auth session). "
             "Use this if the deployed app authenticates via session cookie rather than Bearer token.",
    )
    parser.add_argument("--cookie-file", help="Path to a file containing the AppServiceAuthSession cookie value")
    parser.add_argument(
        "--fixture",
        type=int,
        choices=[1, 2, 3],
        help="Which fixture to run (1=conforming, 2=mixed, 3=life-risk)",
    )
    parser.add_argument("--all", action="store_true", help="Run all three fixtures in sequence")
    args = parser.parse_args()

    if not args.fixture and not args.all:
        parser.error("must specify --fixture <1|2|3> or --all")

    token, cookie = _resolve_auth(args)

    fixtures = sorted(FIXTURES_DIR.glob("*.json"))
    if not fixtures:
        sys.exit(f"no fixtures found in {FIXTURES_DIR}")

    to_run = fixtures if args.all else [fixtures[args.fixture - 1]]

    failures = 0
    for i, fixture_path in enumerate(to_run, 1):
        ok = run_fixture(
            args.host,
            fixture_path,
            f"smoke-test-{i:03d}",
            token=token,
            cookie=cookie,
        )
        if not ok:
            failures += 1

    print()
    print("=" * 78)
    if failures == 0:
        print(f"All {len(to_run)} fixture(s) returned 200. Eyeball the output above for the SME criteria:")
        print("  Fixture 1 (conforming):  mostly green, no red")
        print("  Fixture 2 (mixed):       at least one yellow (vehicle not chocked)")
        print("  Fixture 3 (life-risk):   at least one red (RIT not in place / continued offensive)")
    else:
        print(f"{failures} of {len(to_run)} fixture(s) FAILED.")
    print("=" * 78)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
