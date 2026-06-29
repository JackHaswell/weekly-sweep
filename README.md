# Weekly Sweep — Task Capture

One button each Sunday → I read your week (Outlook, Gmail, WhatsApp, iMessage, meeting notes)
→ you get a single list to **Keep / Later / Bin** → approved items go to **Trello**, and approved
appointments also go to your **Outlook calendar**.

## The app (live, always-on)

**https://jackhaswell.github.io/weekly-sweep/**

Hosted on GitHub Pages — permanent HTTPS URL, reachable from any network, anytime, no laptop needed.
On your iPhone: open it in Safari → Share → **Add to Home Screen**.

### Deploy an update
Pages auto-deploys on every push to `main`:

```bash
cd "Task Capture App"
git add -A && git commit -m "your change" && git push
```
(The GitHub CLI lives at `./bin/gh`; auth is already set up.)

### Local dev (optional, while editing)
```bash
python3 -m http.server 8731   # then http://localhost:8731
```

## Architecture

```
 [ Sunday button (PWA) ]
          │
          ▼
 [ The Sweep ]  ── API sources: Outlook, Gmail, meeting notes (can be automated)
          │      ── Local sources: WhatsApp Web + iMessage (need your logged-in Mac)
          ▼
 data/candidates.json   ← shared store: one normalised list of candidate tasks
          │
          ▼
 [ Review screen (PWA) ]  Keep / Later / Bin per item
          │
          ▼
 approved → Trello card   ·   approved appointment → Trello + Outlook calendar
 binned   → dismissed log (recoverable)   ·   later → carried to next week
```

## The data model (`data/candidates.json`)

Every source normalises into one item shape — this is the contract the whole app runs on:

| field | meaning |
|---|---|
| `title` | short actionable task |
| `detail` | original context / snippet |
| `type` | `task` or `appointment` |
| `source` | outlook · gmail · whatsapp · imessage · meeting |
| `from`, `receivedAt`, `due` | provenance + timing |
| `appointment` | `{start, end, location}` when it's a calendar event |
| `confidence` | 0–1, how sure I am it's a real task |
| `needsDecision` | true = too vague, flagged for you |
| `suggestedTrelloList` | where the card should land |
| `decision` | pending · approved · snoozed · rejected |

## Status / roadmap

- [x] **Day 1** — PWA shell: button, review list, Keep/Later/Bin, summary, data model (mock data)
- [x] **My Tasks** — manual quick-capture for tasks & appointments, persists per-device (localStorage)
- [ ] **Day 2** — Gmail live → real items → Trello card on approve
- [ ] **Day 3** — Microsoft 365: read Outlook email + write calendar appointments *(needs your auth + IT check)*
- [ ] **Day 4** — WhatsApp Web + iMessage sweep via your Mac
- [ ] **Day 5** — dedup, confidence tuning, dismissed-log view, automate the Sunday trigger

Currently runs on **mock data** so the UX is real before any account is connected. "Confirm & push"
records the decision locally; live push to Trello/Outlook lands Day 2–3.
