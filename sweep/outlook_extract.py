#!/usr/bin/env python3
"""
Extract the fetched Outlook work email (sweep/raw/outlook_<week>.json) into
candidate tasks (same rules as the Gmail sweep) and MERGE them into the broker
so they appear on the phone — keeping the other sources (gmail/whatsapp/imessage).

Run after sweep/outlook_fetch.py.
"""

import json
import os
import re
import sys
import datetime as dt

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PROPERTIES = [
    ("8 station road", "8 Station Road"),
    ("northgate", "100-104 High Northgate"),
    ("alderson", "33 Alderson Street"),
    ("elwick", "Elwick Road"),
    ("kilwick", "23 Kilwick Street"),
]
NOISE = re.compile(r"no-?reply|noreply|donotreply|newsletter|notifications?|mailer|updates@|automated|inventorybase", re.I)
PERSONAL = re.compile(r"premierinn|premier inn|booking\.com|airbnb|trainline|hotel|facebook|instagram", re.I)


def iso_week():
    y, w, _ = dt.date.today().isocalendar()
    return f"{y}-W{w:02d}"


def extract(m):
    frm = m.get("from", "")
    name = (re.match(r'\s*"?([^"<]+?)"?\s*<', frm) or [None, frm]).__getitem__(1).strip()
    subject = m.get("subject") or (m.get("snippet") or "")[:60] or "(no subject)"
    snippet = m.get("snippet") or ""
    hay = (subject + " " + snippet + " " + frm).lower()
    noise = bool(NOISE.search(frm))
    personal = bool(PERSONAL.search(frm) or PERSONAL.search(subject))
    prop = next((p for k, p in PROPERTIES if k in hay), None)
    conf = 0.12 if noise else 0.5
    if prop:
        conf = max(conf, 0.6)
    board = "Weekly Sweep" if (personal or noise) else "DEEP"
    labels = []
    if board == "DEEP":
        labels = ["Owner: Jack"]
        if prop:
            labels.append(prop)
        if conf >= 0.5:
            labels.append("THIS WEEK")
    return {
        "id": "ol_" + (m.get("id") or "")[:24],
        "title": subject, "detail": snippet[:280], "type": "task",
        "source": "outlook", "sourceRef": "Outlook · " + (name or "email"),
        "from": name or frm, "receivedAt": m.get("date"), "due": None, "appointment": None,
        "confidence": conf, "needsDecision": False, "board": board, "labels": labels,
        "suggestedTrelloList": "Inbox", "decision": "pending",
    }


def main():
    cfg = json.load(open(os.path.join(HERE, "broker_config.json")))
    raw_path = os.path.join(HERE, "raw", f"outlook_{iso_week()}.json")
    if not os.path.exists(raw_path):
        sys.exit("No Outlook raw for this week — run sweep/outlook_fetch.py first.")
    raw = json.load(open(raw_path))
    # Work inbox has lots of automated noise — keep only the potentially-actionable ones.
    items = [it for it in (extract(m) for m in raw["messages"]) if it["confidence"] >= 0.4]

    base = cfg["url"].rstrip("/")
    h = {"X-Sweep-Pass": cfg["pass"], "Content-Type": "application/json"}
    existing = requests.get(base + "/candidates", headers=h, timeout=30).json()
    kept = [i for i in existing.get("items", []) if i.get("source") != "outlook"]
    merged = items + kept
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sweep": {"id": iso_week(), "generatedAt": now.isoformat(),
                  "sources": sorted({i["source"] for i in merged}), "status": "live"},
        "items": merged,
    }
    r = requests.post(base + "/candidates", headers=h, data=json.dumps(payload), timeout=30)
    print(f"Merged {len(items)} Outlook items + {len(kept)} kept → uploaded={r.ok}. Total {len(merged)} on phone.")


if __name__ == "__main__":
    main()
