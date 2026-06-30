// Weekly Sweep — cloud broker + cloud Gmail sweep (Val.town val)
//
// HTTP: holds the Trello secret + the latest sweep so the public PWA can
// fetch/push from any network. CRON: every Sunday it refreshes Gmail, builds
// the labelled list with rules, merges with WhatsApp/iMessage, stores it.
//
// Env vars (Val.town → Env vars):
//   TRELLO_KEY, TRELLO_TOKEN, SWEEP_PASS                      – broker
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN – cloud Gmail sweep
//
// Endpoints (all but GET / require header  X-Sweep-Pass: <SWEEP_PASS>):
//   GET / ; GET/POST /candidates ; POST /push
// Routing per item.board: "DEEP"/"REACTIVE"/any → that board's CAPTURE list + labels;
//                         "Weekly Sweep" → personal board / suggestedTrelloList.

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

/* ---------------- cloud Gmail sweep (CRON) ---------------- */

const PROPERTIES: [string, string][] = [
  ["8 station road", "8 Station Road"],
  ["northgate", "100-104 High Northgate"],
  ["alderson", "33 Alderson Street"],
  ["elwick", "Elwick Road"],
  ["kilwick", "23 Kilwick Street"],
];
const NOISE = /no-?reply|noreply|donotreply|do-not-reply|newsletter|notifications?|mailer|updates@|info@|marketing|digest/i;
const PERSONAL = /premierinn|premier inn|booking\.com|airbnb|trainline|hotel|google-?noreply|accounts\.google|facebook|instagram|amazon\.co/i;

async function gmailToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error("Gmail token refresh failed: " + (await r.text()));
  return (await r.json()).access_token;
}

function gh(headers: any[], name: string) {
  return (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || "";
}

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function extractEmail(msg: any) {
  const hs = msg.payload?.headers || [];
  const subject = gh(hs, "Subject") || (msg.snippet || "").slice(0, 60) || "(no subject)";
  const fromRaw = gh(hs, "From");
  const fromName = (fromRaw.match(/^"?([^"<]+?)"?\s*</) || [, fromRaw])[1].trim();
  const snippet = (msg.snippet || "").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const hay = (subject + " " + snippet + " " + fromRaw).toLowerCase();
  const noise = NOISE.test(fromRaw) || (msg.labelIds || []).includes("CATEGORY_PROMOTIONS");
  const personal = PERSONAL.test(fromRaw) || PERSONAL.test(subject);
  const prop = PROPERTIES.find(([k]) => hay.includes(k));
  let confidence = noise ? 0.12 : 0.5;
  if (prop) confidence = Math.max(confidence, 0.6);
  const board = (personal || noise) ? "Weekly Sweep" : "DEEP";
  const labels: string[] = [];
  if (board === "DEEP") {
    labels.push("Owner: Jack");
    if (prop) labels.push(prop[1]);
    if (confidence >= 0.5) labels.push("THIS WEEK");
  }
  return {
    id: "gm_" + msg.id, title: subject, detail: snippet.slice(0, 280), type: "task",
    source: "gmail", sourceRef: "Gmail · " + (fromName || "email"), from: fromName || fromRaw,
    receivedAt: new Date(Number(msg.internalDate || Date.now())).toISOString(),
    due: null, appointment: null, confidence, needsDecision: false,
    board, labels, suggestedTrelloList: "Inbox", decision: "pending",
  };
}

async function runGmailSweep() {
  const token = await gmailToken();
  const auth = { Authorization: "Bearer " + token };
  const q = encodeURIComponent("newer_than:7d -in:chats -in:sent category:primary");
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`, { headers: auth }).then((r) => r.json());
  const items: any[] = [];
  for (const m of list.messages || []) {
    const msg = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth }).then((r) => r.json());
    items.push(extractEmail(msg));
  }
  const existing: any = await blob.getJSON(BLOB_KEY).catch(() => ({ items: [] }));
  const kept = (existing.items || []).filter((i: any) => i.source !== "gmail");
  const merged = [...items, ...kept];
  const now = new Date();
  await blob.setJSON(BLOB_KEY, {
    sweep: { id: isoWeek(now), generatedAt: now.toISOString(), sources: [...new Set(merged.map((i: any) => i.source))], status: "live", via: "cloud-gmail" },
    items: merged,
  });
  return `Cloud Gmail sweep: ${items.length} Gmail items + ${kept.length} kept (other sources).`;
}

/* ---------------- entry point (HTTP or CRON) ---------------- */

export default async function (input: any): Promise<Response | string> {
  // CRON invocation: Val.town passes a non-Request trigger object → run the sweep.
  if (!(input instanceof Request)) {
    try { return await runGmailSweep(); } catch (e) { return "Cloud Gmail sweep error: " + String(e); }
  }

  const req = input as Request;
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
  // Manual trigger of the Gmail sweep for testing: POST /run-gmail (authed).
  if (req.method === "POST" && path.endsWith("/run-gmail")) {
    try { return json({ ok: true, result: await runGmailSweep() }); }
    catch (e) { return json({ error: String(e) }, 500); }
  }
  if (req.method === "POST" && path.endsWith("/push")) {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const items = (body.items || []).filter(Boolean);
    if (!items.length) return json({ created: 0, message: "no items" });
    try { return json(await pushItems(items)); }
    catch (e) { return json({ error: String(e) }, 500); }
  }

  return json({ error: "not found" }, 404);
}
