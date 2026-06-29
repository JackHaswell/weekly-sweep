#!/usr/bin/env python3
"""
Outlook / Microsoft 365 fetcher for the Weekly Sweep.

Stage 1 (read-only): pull the last N days of inbox mail via Microsoft Graph and
dump it raw to sweep/raw/outlook_<week>.json. No interpretation here — turning
mail into candidate tasks is the AI step that runs afterward.

Setup: see sweep/SETUP-OUTLOOK.md. Needs sweep/ms_config.json with:
    { "client_id": "...", "tenant_id": "..." }

First run prints a microsoft.com/devicelogin code to sign in + consent (read mail
+ read/write calendar). Token is cached in sweep/ms_token.json so later runs are silent.

Usage:
    ./.venv/bin/python sweep/outlook_fetch.py            # last 7 days
    ./.venv/bin/python sweep/outlook_fetch.py --days 10 --max 150
"""

import argparse
import datetime as dt
import json
import os
import sys

import msal
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "ms_config.json")
TOKEN_CACHE = os.path.join(HERE, "ms_token.json")
RAW_DIR = os.path.join(HERE, "raw")
GRAPH = "https://graph.microsoft.com/v1.0"
# Calendars.ReadWrite is requested now so approved appointments can be written later.
SCOPES = ["Mail.Read", "Calendars.ReadWrite", "User.Read"]


def load_config():
    if not os.path.exists(CONFIG):
        sys.exit("\n  Missing sweep/ms_config.json — see sweep/SETUP-OUTLOOK.md.\n")
    with open(CONFIG) as f:
        c = json.load(f)
    if not c.get("client_id") or not c.get("tenant_id"):
        sys.exit("\n  ms_config.json needs both client_id and tenant_id.\n")
    return c


def get_token(cfg):
    cache = msal.SerializableTokenCache()
    if os.path.exists(TOKEN_CACHE):
        cache.deserialize(open(TOKEN_CACHE).read())

    app = msal.PublicClientApplication(
        cfg["client_id"],
        authority="https://login.microsoftonline.com/" + cfg["tenant_id"],
        token_cache=cache,
    )

    result = None
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(SCOPES, account=accounts[0])

    if not result:
        flow = app.initiate_device_flow(scopes=SCOPES)
        if "user_code" not in flow:
            sys.exit("Failed to start device flow: " + json.dumps(flow, indent=2))
        # This message line is parsed by the harness to drive the sign-in.
        print("DEVICE_LOGIN: " + flow["message"], flush=True)
        result = app.acquire_token_by_device_flow(flow)

    if "access_token" not in result:
        sys.exit("Auth failed: " + result.get("error_description", json.dumps(result)))

    if cache.has_state_changed:
        with open(TOKEN_CACHE, "w") as f:
            f.write(cache.serialize())
        os.chmod(TOKEN_CACHE, 0o600)
    return result["access_token"]


def iso_week_id(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def fetch_messages(token, days, max_msgs):
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = {"Authorization": "Bearer " + token, "Prefer": 'outlook.body-content-type="text"'}
    params = {
        "$filter": f"receivedDateTime ge {since}",
        "$select": "subject,from,toRecipients,receivedDateTime,bodyPreview,webLink,isRead,importance",
        "$orderby": "receivedDateTime desc",
        "$top": "50",
    }
    url = GRAPH + "/me/messages"
    items, first = [], True
    while url and len(items) < max_msgs:
        resp = requests.get(url, headers=headers, params=(params if first else None), timeout=30)
        first = False
        if resp.status_code != 200:
            sys.exit(f"Graph error {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
        for m in data.get("value", []):
            frm = (m.get("from") or {}).get("emailAddress", {})
            items.append({
                "id": m.get("id"),
                "from": f'{frm.get("name", "")} <{frm.get("address", "")}>'.strip(),
                "subject": m.get("subject", ""),
                "date": m.get("receivedDateTime", ""),
                "snippet": (m.get("bodyPreview") or "")[:600],
                "importance": m.get("importance"),
                "isRead": m.get("isRead"),
                "link": m.get("webLink", ""),
            })
        url = data.get("@odata.nextLink")
    return items[:max_msgs]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--max", type=int, default=120)
    args = ap.parse_args()

    cfg = load_config()
    token = get_token(cfg)
    items = fetch_messages(token, args.days, args.max)

    os.makedirs(RAW_DIR, exist_ok=True)
    week = iso_week_id(dt.date.today())
    out = os.path.join(RAW_DIR, f"outlook_{week}.json")
    with open(out, "w") as f:
        json.dump({
            "source": "outlook",
            "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "days": args.days,
            "count": len(items),
            "messages": items,
        }, f, indent=2)
    print(f"Fetched {len(items)} messages -> {os.path.relpath(out, os.path.dirname(HERE))}")


if __name__ == "__main__":
    main()
