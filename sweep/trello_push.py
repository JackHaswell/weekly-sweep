#!/usr/bin/env python3
"""
Push approved Weekly Sweep items to Trello.

Routing (per item's "board" field):
  • "DEEP"          → Jack's DEEP board, into "CAPTURE — DUMP NEW TASKS HERE"
                      (Operating Manual Rule 2), with labels from the item.
  • "Weekly Sweep"  → the personal Weekly Sweep board, into its suggestedTrelloList.

Idempotent: skips a card whose title already exists on the target board.

Usage:
    ./.venv/bin/python sweep/trello_push.py            # push approved
    ./.venv/bin/python sweep/trello_push.py --dry-run
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

WS_LISTS = ["This Week", "Appointments", "Inbox", "Later"]  # personal board lists


def cfg():
    c = json.load(open(CONFIG))
    return c["key"], c["token"]


def call(method, path, key, token, **params):
    params["key"] = key
    params["token"] = token
    r = requests.request(method, API + path, params=params, timeout=30)
    if r.status_code >= 300:
        sys.exit(f"Trello error {r.status_code} on {method} {path}: {r.text[:300]}")
    return r.json() if r.text else {}


def board_context(key, token, board_name, create_if_missing):
    boards = call("GET", "/members/me/boards", key, token, fields="name")
    match = next((b for b in boards if b["name"].strip().lower() == board_name.strip().lower()), None)
    if not match:
        if not create_if_missing:
            sys.exit(f"Board '{board_name}' not found (and won't auto-create it).")
        match = call("POST", "/boards", key, token, name=board_name, defaultLists="false")
    bid = match["id"]
    lists = call("GET", f"/boards/{bid}/lists", key, token, fields="name")
    labels = call("GET", f"/boards/{bid}/labels", key, token, fields="name,color")
    cards = call("GET", f"/boards/{bid}/cards", key, token, fields="name")
    label_ids = {}
    for l in labels:
        label_ids.setdefault((l.get("name") or "").strip().lower(), l["id"])  # first match wins
    list_ids = {l["name"].strip().lower(): l["id"] for l in lists}
    have = {c["name"].strip().lower() for c in cards}
    return {"id": bid, "lists": list_ids, "labels": label_ids, "have": have, "raw_lists": lists}


def ensure_ws_lists(ctx, key, token):
    for name in WS_LISTS:
        if name.lower() not in ctx["lists"]:
            created = call("POST", "/lists", key, token, name=name, idBoard=ctx["id"])
            ctx["lists"][name.lower()] = created["id"]


def capture_list_id(ctx):
    for name, lid in ctx["lists"].items():
        if "capture" in name and "dump" in name:
            return lid
    for name, lid in ctx["lists"].items():
        if "capture" in name:
            return lid
    sys.exit("board has no 'CAPTURE' list.")


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

    key, token = cfg()
    data = json.load(open(CANDIDATES))
    items = [i for i in data["items"] if i.get("decision") == args.decision]
    if not items:
        print(f"No items with decision='{args.decision}'.")
        return

    if args.dry_run:
        for it in items:
            board = it.get("board", "Weekly Sweep")
            where = "CAPTURE" if board == "DEEP" else it.get("suggestedTrelloList", "Inbox")
            print(f"  [{board} · {where}] {it['title']}")
            if it.get("labels"):
                print("        labels:", ", ".join(it["labels"]))
        return

    contexts = {}  # board name -> context
    created = skipped = 0

    for it in items:
        board = it.get("board", "Weekly Sweep")
        if board not in contexts:
            contexts[board] = board_context(key, token, board, create_if_missing=(board == "Weekly Sweep"))
            if board == "Weekly Sweep":
                ensure_ws_lists(contexts[board], key, token)
        ctx = contexts[board]

        if it["title"].strip().lower() in ctx["have"]:
            skipped += 1
            continue

        if board == "Weekly Sweep":
            list_id = ctx["lists"].get(it.get("suggestedTrelloList", "Inbox").lower()) or ctx["lists"].get("inbox")
            label_ids = []
        else:  # DEEP, REACTIVE, or any board → CAPTURE intake + labels
            list_id = capture_list_id(ctx)
            label_ids = [ctx["labels"][n.strip().lower()] for n in it.get("labels", [])
                         if n.strip().lower() in ctx["labels"]]
            missing = [n for n in it.get("labels", []) if n.strip().lower() not in ctx["labels"]]
            if missing:
                print(f"    (note: labels not found on {board}, skipped: {missing})")

        params = {"idList": list_id, "name": it["title"], "desc": card_desc(it)}
        if it.get("appointment", {}) and it["appointment"].get("start"):
            params["due"] = it["appointment"]["start"]
        elif it.get("due"):
            params["due"] = it["due"]

        card = call("POST", "/cards", key, token, **params)
        for lid in label_ids:  # attach labels via the dedicated endpoint (reliable)
            call("POST", f"/cards/{card['id']}/idLabels", key, token, value=lid)
        ctx["have"].add(it["title"].strip().lower())
        created += 1
        tag = ("DEEP/CAPTURE → " + ", ".join(it.get("labels", []))) if board == "DEEP" else ("Weekly Sweep/" + it.get("suggestedTrelloList", "Inbox"))
        print(f"  ✓ {it['title'][:45]}  [{tag}]")

    print(f"\nDone — {created} created, {skipped} already existed.")


if __name__ == "__main__":
    main()
