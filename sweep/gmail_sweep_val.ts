// Weekly Sweep — CLOUD Gmail sweep (Val.town CRON val)
//
// Runs every Sunday with no dependence on Jack's Mac: refreshes the Gmail token,
// pulls the last 7 days, turns each email into a candidate task with smart rules
// (board routing + labels), merges with the existing sweep (keeping WhatsApp/iMessage
// items), and stores it on the broker so it's waiting on the phone.
//
// Env vars (Val.town → Env vars):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN  – Gmail OAuth
//   BROKER_URL   – the broker base URL
//   SWEEP_PASS   – broker passphrase

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

function header(headers: any[], name: string) {
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

function extract(msg: any) {
  const hs = msg.payload?.headers || [];
  const subject = header(hs, "Subject") || (msg.snippet || "").slice(0, 60) || "(no subject)";
  const fromRaw = header(hs, "From");
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
    id: "gm_" + msg.id,
    title: subject,
    detail: snippet.slice(0, 280),
    type: "task",
    source: "gmail",
    sourceRef: "Gmail · " + (fromName || "email"),
    from: fromName || fromRaw,
    receivedAt: new Date(Number(msg.internalDate || Date.now())).toISOString(),
    due: null,
    appointment: null,
    confidence,
    needsDecision: false,
    board,
    labels,
    suggestedTrelloList: "Inbox",
    decision: "pending",
  };
}

export default async function () {
  const token = await gmailToken();
  const auth = { Authorization: "Bearer " + token };
  const q = encodeURIComponent("newer_than:7d -in:chats -in:sent category:primary");
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`,
    { headers: auth },
  ).then((r) => r.json());

  const items: any[] = [];
  for (const m of list.messages || []) {
    const msg = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: auth },
    ).then((r) => r.json());
    items.push(extract(msg));
  }

  // Merge: keep any non-Gmail items already on the broker (WhatsApp/iMessage).
  const base = Deno.env.get("BROKER_URL")!.replace(/\/$/, "");
  const pass = { "X-Sweep-Pass": Deno.env.get("SWEEP_PASS")!, "Content-Type": "application/json" };
  const existing = await fetch(base + "/candidates", { headers: pass }).then((r) => r.json()).catch(() => ({ items: [] }));
  const kept = (existing.items || []).filter((i: any) => i.source !== "gmail");
  const merged = [...items, ...kept];

  const now = new Date();
  const sources = [...new Set(merged.map((i: any) => i.source))];
  const payload = {
    sweep: { id: isoWeek(now), generatedAt: now.toISOString(), sources, status: "live", via: "cloud-gmail" },
    items: merged,
  };
  const put = await fetch(base + "/candidates", { method: "POST", headers: pass, body: JSON.stringify(payload) });
  return `Cloud Gmail sweep: ${items.length} Gmail items, ${kept.length} kept (other sources) → stored=${put.ok}`;
}
