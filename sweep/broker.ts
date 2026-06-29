// Weekly Sweep — cloud broker (Val.town HTTP val)
//
// Holds the Trello secret server-side so the public PWA never sees it.
// The PWA POSTs approved items here; the broker creates Trello cards.
//
// Env vars to set in Val.town (Settings → Environment Variables):
//   TRELLO_KEY    – the Power-Up API key
//   TRELLO_TOKEN  – the user token (read,write)
//   SWEEP_PASS    – a shared passphrase; the PWA sends it, the broker checks it
//
// Endpoints:
//   GET  /            → health check
//   POST /push        → body {items:[...]} → creates a Trello card per item
//                       (header  X-Sweep-Pass: <SWEEP_PASS>)

const TRELLO = "https://api.trello.com/1";
const BOARD_NAME = "Weekly Sweep";
const LISTS = ["This Week", "Appointments", "Inbox", "Later"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sweep-Pass",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function trello(method: string, path: string, params: Record<string, string>) {
  const key = Deno.env.get("TRELLO_KEY")!;
  const token = Deno.env.get("TRELLO_TOKEN")!;
  const url = new URL(TRELLO + path);
  url.search = new URLSearchParams({ ...params, key, token }).toString();
  const r = await fetch(url, { method });
  if (!r.ok) throw new Error(`Trello ${r.status} on ${method} ${path}: ${await r.text()}`);
  return r.status === 204 ? {} : r.json();
}

async function ensureBoard() {
  const boards = await trello("GET", "/members/me/boards", { fields: "name" });
  const found = boards.find((b: any) => b.name.toLowerCase() === BOARD_NAME.toLowerCase());
  if (found) return found.id;
  const board = await trello("POST", "/boards", { name: BOARD_NAME, defaultLists: "false" });
  return board.id;
}

async function ensureLists(boardId: string) {
  const existing = await trello("GET", `/boards/${boardId}/lists`, { fields: "name" });
  const byName: Record<string, string> = {};
  for (const l of existing) byName[l.name.toLowerCase()] = l.id;
  for (const name of LISTS) {
    if (!byName[name.toLowerCase()]) {
      const created = await trello("POST", "/lists", { name, idBoard: boardId });
      byName[name.toLowerCase()] = created.id;
    }
  }
  return byName;
}

function cardDesc(it: any) {
  const bits = [it.detail || ""];
  if (it.sourceRef || it.source) bits.push(`\n— Source: ${it.sourceRef || it.source}`);
  if (it.from) bits.push(`From: ${it.from}`);
  bits.push(`Confidence: ${Math.round((it.confidence || 0) * 100)}%  ·  added by Weekly Sweep`);
  return bits.filter(Boolean).join("\n");
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET") return json({ ok: true, service: "weekly-sweep-broker" });

  if (req.method === "POST" && url.pathname.endsWith("/push")) {
    if (req.headers.get("X-Sweep-Pass") !== Deno.env.get("SWEEP_PASS")) {
      return json({ error: "unauthorized" }, 401);
    }
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const items = (body.items || []).filter(Boolean);
    if (!items.length) return json({ created: 0, message: "no items" });

    try {
      const boardId = await ensureBoard();
      const lists = await ensureLists(boardId);
      const existing = await trello("GET", `/boards/${boardId}/cards`, { fields: "name" });
      const have = new Set(existing.map((c: any) => c.name.trim().toLowerCase()));

      let created = 0, skipped = 0;
      for (const it of items) {
        if (have.has((it.title || "").trim().toLowerCase())) { skipped++; continue; }
        const listName = (it.suggestedTrelloList || "Inbox").toLowerCase();
        const params: Record<string, string> = {
          idList: lists[listName] || lists["inbox"],
          name: it.title,
          desc: cardDesc(it),
        };
        if (it.appointment?.start) params.due = it.appointment.start;
        else if (it.due) params.due = it.due;
        await trello("POST", "/cards", params);
        created++;
      }
      const board = await trello("GET", `/boards/${boardId}`, { fields: "url" });
      return json({ created, skipped, board: board.url });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  return json({ error: "not found" }, 404);
}
