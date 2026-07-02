#!/usr/bin/env python3
"""
Calendar push — the Mac side of "approved appointments go on my Outlook calendar".

Jack approves items on his phone; the app syncs the decided list back to the broker.
This script (run on the Mac, where the Outlook token lives) reads that list, finds the
approved *appointments*, and creates them as events on his Outlook calendar via Graph.

It's idempotent: every event it creates is tagged in the body with its task id, and it
checks the calendar for that tag before creating, so re-running never duplicates.

Usage:
    ./.venv/bin/python sweep/calendar_push.py          # write approved appointments
    ./.venv/bin/python sweep/calendar_push.py --dry     # show what it would do, write nothing
"""

import argparse
import datetime as dt
import json
import os
import sys

import requests

import outlook_fetch as of  # reuse config + cached-token logic

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = "https://graph.microsoft.com/v1.0"
TAG = "WeeklySweep-id:"  # marker written into each event body for dedupe


def approved_appointments(broker):
    base = broker["url"].rstrip("/")
    h = {"X-Sweep-Pass": broker["pass"]}
    r = requests.get(base + "/candidates", headers=h, timeout=30)
    r.raise_for_status()
    items = r.json().get("items", [])
    out = []
    for it in items:
        if it.get("decision") != "approved":
            continue
        appt = it.get("appointment") or {}
        if it.get("type") != "appointment" or not appt.get("start"):
            continue
        out.append(it)
    return out


def existing_tags(token, window_start):
    """Return the set of task ids already on the calendar (from event bodies)."""
    headers = {"Authorization": "Bearer " + token, "Prefer": 'outlook.body-content-type="text"'}
    params = {
        "startDateTime": window_start,
        "endDateTime": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=120)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "$select": "subject,body",
        "$top": "200",
    }
    r = requests.get(GRAPH + "/me/calendarView", headers=headers, params=params, timeout=30)
    if r.status_code != 200:
        return set()
    tags = set()
    for ev in r.json().get("value", []):
        content = ((ev.get("body") or {}).get("content") or "")
        if TAG in content:
            tags.add(content.split(TAG, 1)[1].split()[0].strip())
    return tags


def create_event(token, it):
    appt = it["appointment"]
    start = appt["start"]
    # Default to a 1-hour event when no end time was captured.
    end = appt.get("end")
    if not end:
        s = dt.datetime.fromisoformat(start.replace("Z", "+00:00"))
        end = (s + dt.timedelta(hours=1)).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = (it.get("detail") or "") + f"\n\n{TAG}{it['id']} · added by Weekly Sweep"
    payload = {
        "subject": it["title"],
        "body": {"contentType": "text", "content": body},
        "start": {"dateTime": start.replace("Z", ""), "timeZone": "UTC"},
        "end": {"dateTime": end.replace("Z", ""), "timeZone": "UTC"},
    }
    if appt.get("location"):
        payload["location"] = {"displayName": appt["location"]}
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    r = requests.post(GRAPH + "/me/events", headers=headers, data=json.dumps(payload), timeout=30)
    return r.status_code, r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="show what would be written, write nothing")
    args = ap.parse_args()

    broker = json.load(open(os.path.join(HERE, "broker_config.json")))
    appts = approved_appointments(broker)
    if not appts:
        print("No approved appointments to write.")
        return

    cfg = of.load_config()
    token = of.get_token(cfg)
    window = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    already = existing_tags(token, window)

    created = skipped = failed = 0
    for it in appts:
        if it["id"] in already:
            print(f"  · already on calendar: {it['title']}")
            skipped += 1
            continue
        when = it["appointment"]["start"]
        if args.dry:
            print(f"  + would add: {it['title']}  @ {when}")
            created += 1
            continue
        code, r = create_event(token, it)
        if code in (200, 201):
            print(f"  ✓ added: {it['title']}  @ {when}")
            created += 1
        else:
            print(f"  ✗ FAILED ({code}): {it['title']} — {r.text[:160]}")
            failed += 1

    verb = "would add" if args.dry else "added"
    print(f"\nCalendar: {created} {verb}, {skipped} already there, {failed} failed.")


if __name__ == "__main__":
    main()
