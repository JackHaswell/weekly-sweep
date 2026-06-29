#!/usr/bin/env python3
"""
Push approved Weekly Sweep items to Trello.

Reads data/candidates.json, takes items whose decision == the chosen status
(default "approved"), and creates a Trello card for each on the matching list
of a "Weekly Sweep" board (created on first run). Idempotent: skips a card if
one with the same title already exists on the board.

Approved *appointments* are tagged here too; writing them to the Outlook
calendar happens in the (pending) outlook step.

Usage:
    ./.venv/bin/python sweep/trello_push.py                 # push approved
    ./.venv/bin/python sweep/trello_push.py --dry-run       # show, don't create
    ./.venv/bin/python sweep/trello_push.py --decision snoozed
"""

import argparse
import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(HERE, "trello_config.json")
CANDIDATES = os.path.join(ROOT, "data", "candidates.json")
API = "https://api.trello.com/1"

# suggestedTrelloList value -> Trello list name (created in this order)
LISTS = ["This Week", "Appointments", "Inbox", "Later"]


def cfg():
    with open(CONFIG) as f:
        c = json.load(f)
    return c["key"], c["token"], c.get("board_name", "Weekly Sweep")


def call(method, path, key, token, **params):
    params["key"] = key
    params["token"] = token
    r = requests.request(method, API + path, params=params, timeout=30)
    if r.status_code >= 300:
        sys.exit(f"Trello error {r.status_code} on {method} {path}: {r.text[:300]}")
    return r.json() if r.text else {}


def ensure_board(key, token, name):
    boards = call("GET", "/members/me/boards", key, token, fields="name")
    for b in boards:
        if b["name"].lower() == name.lower():
            return b["id"]
    board = call("POST", "/boards", key, token, name=name, defaultLists="false")
    return board["id"]


def ensure_lists(key, token, board_id):
    existing = call("GET", f"/boards/{board_id}/lists", key, token, fields="name")
    by_name = {l["name"].lower(): l["id"] for l in existing}
    for name in LISTS:
        if name.lower() not in by_name:
            created = call("POST", "/lists", key, token, name=name, idBoard=board_id)
            by_name[name.lower()] = created["id"]
    return by_name


def existing_card_names(key, token, board_id):
    cards = call("GET", f"/boards/{board_id}/cards", key, token, fields="name")
    return {c["name"].strip().lower() for c in cards}


def card_desc(it):
    bits = [it.get("detail", "")]
    src = it.get("sourceRef") or it.get("source", "")
    if src:
        bits.append(f"\n— Source: {src}")
    if it.get("from"):
        bits.append(f"From: {it['from']}")
    bits.append(f"Confidence: {round(it.get('confidence', 0) * 100)}%  ·  added by Weekly Sweep")
    return "\n".join(b for b in bits if b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decision", default="approved")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key, token, board_name = cfg()
    data = json.load(open(CANDIDATES))
    items = [i for i in data["items"] if i.get("decision") == args.decision]
    if not items:
        print(f"No items with decision='{args.decision}'. Nothing to push.")
        return

    if args.dry_run:
        print(f"[dry run] would push {len(items)} card(s):")
        for it in items:
            print(f"  • [{it.get('suggestedTrelloList','Inbox')}] {it['title']}")
        return

    board_id = ensure_board(key, token, board_name)
    lists = ensure_lists(key, token, board_id)
    have = existing_card_names(key, token, board_id)

    created, skipped = 0, 0
    for it in items:
        if it["title"].strip().lower() in have:
            skipped += 1
            continue
        list_name = it.get("suggestedTrelloList", "Inbox")
        list_id = lists.get(list_name.lower(), lists["inbox"])
        params = {"idList": list_id, "name": it["title"], "desc": card_desc(it)}
        appt = it.get("appointment")
        if appt and appt.get("start"):
            params["due"] = appt["start"]
        elif it.get("due"):
            params["due"] = it["due"]
        call("POST", "/cards", key, token, **params)
        created += 1
        print(f"  ✓ {list_name}: {it['title']}")

    url = call("GET", f"/boards/{board_id}", key, token, fields="url").get("url", "")
    print(f"\nDone — {created} card(s) created, {skipped} already existed.")
    if url:
        print(f"Board: {url}")


if __name__ == "__main__":
    main()
