#!/usr/bin/env python3
"""
Gmail fetcher for the Weekly Sweep.

Stage 1 of the sweep: pull the last N days of inbox mail and dump it raw to
sweep/raw/gmail_<week>.json. It does NO interpretation — turning emails into
candidate tasks is the AI step that runs afterward.

Usage:
    ./.venv/bin/python sweep/gmail_fetch.py            # last 7 days
    ./.venv/bin/python sweep/gmail_fetch.py --days 10 --max 150

First run opens a browser to authorise (read-only). Token is cached in
sweep/token.json so later runs are silent.
"""

import argparse
import base64
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS = os.path.join(HERE, "credentials.json")
TOKEN = os.path.join(HERE, "token.json")
RAW_DIR = os.path.join(HERE, "raw")
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def get_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    if not os.path.exists(CREDENTIALS):
        sys.exit(
            "\n  Missing sweep/credentials.json.\n"
            "  Follow sweep/SETUP-GMAIL.md to create it, then re-run.\n"
        )

    creds = None
    if os.path.exists(TOKEN):
        creds = Credentials.from_authorized_user_file(TOKEN, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN, "w") as f:
            f.write(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def _decode(data):
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", "replace")


def extract_body(payload):
    """Best-effort plain-text body, truncated."""
    def walk(part):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return _decode(part["body"]["data"])
        for sub in part.get("parts", []) or []:
            txt = walk(sub)
            if txt:
                return txt
        return ""
    body = walk(payload) or ""
    body = re.sub(r"\r\n?", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body[:1500]


def header(headers, name):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def iso_week_id(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--max", type=int, default=120)
    args = ap.parse_args()

    service = get_service()
    query = f"newer_than:{args.days}d -in:chats -in:sent category:primary"

    msgs, page = [], None
    while len(msgs) < args.max:
        resp = service.users().messages().list(
            userId="me", q=query, maxResults=min(100, args.max - len(msgs)),
            pageToken=page,
        ).execute()
        msgs.extend(resp.get("messages", []))
        page = resp.get("nextPageToken")
        if not page:
            break

    items = []
    for m in msgs[: args.max]:
        full = service.users().messages().get(
            userId="me", id=m["id"], format="full",
        ).execute()
        payload = full.get("payload", {})
        hs = payload.get("headers", [])
        items.append({
            "id": m["id"],
            "threadId": full.get("threadId"),
            "from": header(hs, "From"),
            "to": header(hs, "To"),
            "subject": header(hs, "Subject"),
            "date": header(hs, "Date"),
            "snippet": full.get("snippet", ""),
            "body": extract_body(payload),
            "labels": full.get("labelIds", []),
            "link": f"https://mail.google.com/mail/u/0/#inbox/{m['id']}",
        })

    os.makedirs(RAW_DIR, exist_ok=True)
    week = iso_week_id(dt.date.today())
    out = os.path.join(RAW_DIR, f"gmail_{week}.json")
    with open(out, "w") as f:
        json.dump({
            "source": "gmail",
            "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "days": args.days,
            "count": len(items),
            "messages": items,
        }, f, indent=2)

    print(f"Fetched {len(items)} messages -> {os.path.relpath(out, os.path.dirname(HERE))}")


if __name__ == "__main__":
    main()
