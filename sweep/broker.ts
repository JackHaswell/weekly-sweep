// Weekly Sweep — cloud broker (Val.town HTTP val)
//
// Holds the Trello secret + the latest sweep server-side so the public PWA
// never sees secrets and can fetch/push from any network.
//
// Env vars (Val.town → Env vars):
//   TRELLO_KEY    – the Power-Up API key
//   TRELLO_TOKEN  – the user token (read,write)
//   SWEEP_PASS    – shared passphrase; the PWA + the Mac uploader send it
//
// Endpoints (all but GET / require header  X-Sweep-Pass: <SWEEP_PASS>):
//   GET  /                → health check (open)
//   GET  /candidates      → latest sweep JSON (for the phone to review)
//   POST /candidates      → the Mac uploads a fresh sweep here
//   POST /push            → body {items:[...]} → creates Trello cards
//
// Routing per item.board:  "DEEP" → DEEP board / CAPTURE list + item.labels;
//                          "Weekly Sweep" → personal board / suggestedTrelloList.

import { blob } from "https://esm.town/v/std/blob";

const TRELLO = "https://api.trello.com/1";
const BLOB_KEY = "sweep_candidates";
const WS_LISTS = ["This Week", "Appointments", "Inbox", "Later"];

const ALLOWED_ORIGIN = "https://jackhaswell.github.io";
const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sweep-Pass",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authed(req: Request) {
  const given = req.headers.get("X-Sweep-Pass") || "";
  const ok = safeEqual(given, Deno.env.get("SWEEP_PASS") || "\0");
  if (!ok) await sleep(600);
  return ok;
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

function cardDesc(it: any) {
  const bits = [it.detail || ""];
  if (it.sourceRef || it.source) bits.push(`\n— Source: ${it.sourceRef || it.source}`);
  if (it.from) bits.push(`From: ${it.from}`);
  bits.push(`Confidence: ${Math.round((it.confidence || 0) * 100)}%  ·  added by Weekly Sweep`);
  return bits.filter(Boolean).join("\n");
}

async function boardContext(boardName: string, createIfMissing: boolean) {
  const boards = await trello("GET", "/members/me/boards", { fields: "name" });
  let match = boards.find((b: any) => b.name.trim().toLowerCase() === boardName.trim().toLowerCase());
  if (!match) {
    if (!createIfMissing) throw new Error("board not found: " + boardName);
    match = await trello("POST", "/boards", { name: boardName, defaultLists: "false" });
  }
  const bid = match.id;
  const lists = await trello("GET", `/boards/${bid}/lists`, { fields: "name" });
  const labels = await trello("GET", `/boards/${bid}/labels`, { fields: "name,color" });
  const cards = await trello("GET", `/boards/${bid}/cards`, { fields: "name" });
  const listIds: Record<string, string> = {};
  for (const l of lists) listIds[l.name.trim().toLowerCase()] = l.id;
  const labelIds: Record<string, string> = {};
  for (const l of labels) {
    const k = (l.name || "").trim().toLowerCase();
    if (k && !(k in labelIds)) labelIds[k] = l.id;
  }
  const have = new Set(cards.map((c: any) => c.name.trim().toLowerCase()));
  return { id: bid, lists: listIds, labels: labelIds, have };
}

async function ensureWsLists(ctx: any) {
  for (const name of WS_LISTS) {
    if (!ctx.lists[name.toLowerCase()]) {
      const created = await trello("POST", "/lists", { name, idBoard: ctx.id });
      ctx.lists[name.toLowerCase()] = created.id;
    }
  }
}

function captureListId(ctx: any) {
  // "CAPTURE — DUMP NEW TASKS HERE" (may have an emoji prefix on Josh's board)
  for (const name of Object.keys(ctx.lists)) if (name.includes("capture") && name.includes("dump")) return ctx.lists[name];
  for (const name of Object.keys(ctx.lists)) if (name.includes("capture")) return ctx.lists[name];
  throw new Error("board has no CAPTURE list");
}

async function pushItems(items: any[]) {
  const contexts: Record<string, any> = {};
  let created = 0, skipped = 0;
  for (const it of items) {
    const board = it.board || "Weekly Sweep";
    if (!contexts[board]) {
      contexts[board] = await boardContext(board, board === "Weekly Sweep");
      if (board === "Weekly Sweep") await ensureWsLists(contexts[board]);
    }
    const ctx = contexts[board];
    if (ctx.have.has((it.title || "").trim().toLowerCase())) { skipped++; continue; }

    let listId: string, labelIds: string[] = [];
    if (board === "Weekly Sweep") {
      listId = ctx.lists[(it.suggestedTrelloList || "Inbox").toLowerCase()] || ctx.lists["inbox"];
    } else {
      // DEEP, REACTIVE, or any other Trello board → CAPTURE intake + labels
      listId = captureListId(ctx);
      labelIds = (it.labels || []).map((n: string) => ctx.labels[n.trim().toLowerCase()]).filter(Boolean);
    }
    const params: Record<string, string> = { idList: listId, name: it.title, desc: cardDesc(it) };
    if (it.appointment?.start) params.due = it.appointment.start;
    else if (it.due) params.due = it.due;
    const card = await trello("POST", "/cards", params);
    for (const lid of labelIds) await trello("POST", `/cards/${card.id}/idLabels`, { value: lid });
    ctx.have.add((it.title || "").trim().toLowerCase());
    created++;
  }
  const boardUrls: Record<string, string> = {};
  for (const [name, ctx] of Object.entries(contexts)) {
    const b = await trello("GET", `/boards/${(ctx as any).id}`, { fields: "url" });
    boardUrls[name] = b.url;
  }
  return { created, skipped, boards: boardUrls };
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const path = new URL(req.url).pathname;

  if (req.method === "GET" && (path === "/" || path === "")) {
    return json({ ok: true, service: "weekly-sweep-broker" });
  }

  if (!(await authed(req))) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET" && path.endsWith("/candidates")) {
    const data = await blob.getJSON(BLOB_KEY).catch(() => null);
    return json(data || { sweep: null, items: [] });
  }

  if (req.method === "POST" && path.endsWith("/candidates")) {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    await blob.setJSON(BLOB_KEY, body);
    return json({ ok: true, items: (body.items || []).length });
  }

  if (req.method === "POST" && path.endsWith("/push")) {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const items = (body.items || []).filter(Boolean);
    if (!items.length) return json({ created: 0, message: "no items" });
    try {
      return json(await pushItems(items));
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  return json({ error: "not found" }, 404);
}
