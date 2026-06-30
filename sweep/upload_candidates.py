#!/usr/bin/env python3
"""
Upload the latest sweep (data/candidates.json) to the cloud broker so the phone
can review it from any network. Run this at the end of the Sunday sweep, after
the AI has built data/candidates.json from the fetched sources.

Usage:
    ./.venv/bin/python sweep/upload_candidates.py
"""

import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(HERE, "broker_config.json")
CANDIDATES = os.path.join(ROOT, "data", "candidates.json")


def main():
    with open(CONFIG) as f:
        cfg = json.load(f)
    with open(CANDIDATES) as f:
        data = json.load(f)

    r = requests.post(
        cfg["url"].rstrip("/") + "/candidates",
        headers={"Content-Type": "application/json", "X-Sweep-Pass": cfg["pass"]},
        data=json.dumps(data),
        timeout=30,
    )
    if r.status_code != 200:
        sys.exit(f"Upload failed {r.status_code}: {r.text[:300]}")
    print(f"Uploaded {len(data.get('items', []))} items to the broker — ready on your phone.")


if __name__ == "__main__":
    main()
