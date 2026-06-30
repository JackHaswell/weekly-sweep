"use strict";

const SRC_LABEL = {
  outlook: "Outlook", gmail: "Gmail", whatsapp: "WhatsApp",
  imessage: "iMessage", meeting: "Meeting"
};

let STATE = { sweep: null, items: [] };

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/* ---------- data ---------- */
const BROKER = "https://jackhaswell--d2797fbe73eb11f1b6dd1607ee4eb77e.web.val.run";

function getPass(force) {
  let p = localStorage.getItem("sweep_pass");
  if (!p || force) {
    p = window.prompt("Enter your Weekly Sweep passphrase");
    if (p) { p = p.trim(); localStorage.setItem("sweep_pass", p); }
  }
  return p ? p.trim() : null;
}

async function loadCandidates() {
  // Prefer the live sweep from the cloud broker (real data, any network).
  let pass = getPass();
  for (let attempt = 0; attempt < 2 && pass; attempt++) {
    try {
      const res = await fetch(BROKER + "/candidates", { headers: { "X-Sweep-Pass": pass }, cache: "no-store" });
      if (res.status === 401) {                 // wrong/old passphrase — ask again once
        localStorage.removeItem("sweep_pass");
        pass = getPass(true);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        if (data && data.items && data.items.length) return data;
      }
      break;
    } catch (_) { break; } // offline / not set up — fall back to bundled demo
  }
  const res = await fetch("data/candidates.json", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function decisionsKey(id) { return "sweep_decisions_" + id; }
function saveDecisions() {
  if (!STATE.sweep) return;
  const map = {};
  STATE.items.forEach((it) => (map[it.id] = it.decision));
  localStorage.setItem(decisionsKey(STATE.sweep.id), JSON.stringify(map));
}
function restoreDecisions() {
  if (!STATE.sweep) return;
  try {
    const map = JSON.parse(localStorage.getItem(decisionsKey(STATE.sweep.id)) || "{}");
    STATE.items.forEach((it) => { if (map[it.id]) it.decision = map[it.id]; });
  } catch (_) {}
}

/* ---------- formatting ---------- */
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) +
    " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function confColor(c) { return c >= 0.7 ? "var(--ok)" : c >= 0.4 ? "var(--snooze)" : "var(--no)"; }

/* ---------- home ---------- */
function renderHome() {
  if (STATE.sweep) {
    $("#sweep-week").textContent =
      "Week of " + fmtDate(STATE.sweep.weekStart) + " – " + fmtDate(STATE.sweep.weekEnd);
    $("#home-meta").textContent =
      STATE.items.length + " items found across " +
      STATE.sweep.sources.map((s) => SRC_LABEL[s]).join(", ");
  }
}

/* ---------- review ---------- */
function renderReview() {
  const list = $("#list");
  list.innerHTML = "";
  $("#review-title").textContent = "This week's list";
  $("#review-sub").textContent = STATE.items.length + " items to review";

  STATE.items.forEach((it) => list.appendChild(renderCard(it)));
  updateBars();
}

function renderCard(it) {
  const card = el("div", "card");
  card.dataset.decision = it.decision;
  card.dataset.id = it.id;

  const top = el("div", "card__top");
  top.appendChild(el("span", "badge src-" + it.source, SRC_LABEL[it.source]));
  if (it.type === "appointment") top.appendChild(el("span", "badge appt", "📅 Appointment"));
  if (it.needsDecision) top.appendChild(el("span", "badge flag", "⚠︎ Needs you"));
  card.appendChild(top);

  card.appendChild(el("h3", "card__title", escapeHtml(it.title)));
  card.appendChild(el("p", "card__detail", escapeHtml(it.detail)));

  const meta = el("div", "card__meta");
  meta.appendChild(el("span", null, "From <b>" + escapeHtml(it.from) + "</b>"));
  if (it.appointment) meta.appendChild(el("span", null, "🕒 <b>" + fmtDateTime(it.appointment.start) + "</b>"));
  if (it.due) meta.appendChild(el("span", null, "Due <b>" + fmtDate(it.due) + "</b>"));
  meta.appendChild(el("span", "conf",
    '<span class="conf__dot" style="background:' + confColor(it.confidence) + '"></span>' +
    Math.round(it.confidence * 100) + "% match"));
  card.appendChild(meta);

  const actions = el("div", "actions");
  actions.appendChild(mkAct("yes", "✅ Keep", it, "approved"));
  actions.appendChild(mkAct("later", "🕓 Later", it, "snoozed"));
  actions.appendChild(mkAct("no", "❌ Bin", it, "rejected"));
  card.appendChild(actions);
  return card;
}

function mkAct(kind, label, it, decision) {
  const b = el("button", "act " + kind, label);
  if (it.decision === decision) b.classList.add("sel");
  b.addEventListener("click", () => setDecision(it, decision));
  return b;
}

function setDecision(it, decision) {
  it.decision = (it.decision === decision) ? "pending" : decision;
  saveDecisions();
  const card = document.querySelector('.card[data-id="' + it.id + '"]');
  card.dataset.decision = it.decision;
  card.querySelectorAll(".act").forEach((b) => b.classList.remove("sel"));
  if (it.decision !== "pending") {
    const map = { approved: ".yes", snoozed: ".later", rejected: ".no" };
    card.querySelector(map[it.decision]).classList.add("sel");
  }
  updateBars();
}

function counts() {
  const c = { approved: 0, rejected: 0, snoozed: 0, pending: 0, appts: 0 };
  STATE.items.forEach((it) => {
    c[it.decision]++;
    if (it.decision === "approved" && it.type === "appointment") c.appts++;
  });
  return c;
}

function updateBars() {
  const c = counts();
  const done = STATE.items.length - c.pending;
  $("#progress-bar").style.width = (STATE.items.length ? (done / STATE.items.length) * 100 : 0) + "%";
  $("#counts").innerHTML =
    "<b>" + c.approved + "</b> keep · <b>" + c.rejected + "</b> bin · <b>" + c.snoozed + "</b> later" +
    (c.pending ? " · " + c.pending + " left" : "");
  $("#btn-submit").disabled = c.approved === 0;
  $("#btn-submit").textContent = "Send " + c.approved + " approved →";
}

/* ---------- summary ---------- */
function openSummary() {
  const approved = STATE.items.filter((i) => i.decision === "approved");
  const body = $("#summary-body");
  body.innerHTML = "";

  body.appendChild(el("div", "sumhead", "→ Trello cards (" + approved.length + ")"));
  approved.forEach((it) => {
    body.appendChild(el("div", "sumrow",
      '<span class="tick">✓</span><span>' + escapeHtml(it.title) +
      ' <span style="color:var(--muted)">· ' + it.suggestedTrelloList + "</span></span>"));
  });

  const appts = approved.filter((i) => i.type === "appointment");
  body.appendChild(el("div", "sumhead", "→ Outlook calendar (" + appts.length + ")"));
  if (!appts.length) body.appendChild(el("div", "sumrow", '<span style="color:var(--muted)">No appointments approved</span>'));
  appts.forEach((it) => {
    body.appendChild(el("div", "sumrow",
      '<span class="cal">📅</span><span>' + escapeHtml(it.title) + "<br><span style='color:var(--muted)'>" +
      fmtDateTime(it.appointment.start) + (it.appointment.location ? " · " + escapeHtml(it.appointment.location) : "") +
      "</span></span>"));
  });

  const binned = STATE.items.filter((i) => i.decision === "rejected").length;
  const later = STATE.items.filter((i) => i.decision === "snoozed").length;
  body.appendChild(el("div", "sumrow",
    '<span style="color:var(--muted)">' + binned + " binned (kept in dismissed log) · " + later + " snoozed to next week</span>"));

  $("#summary").classList.remove("hidden");
}

async function confirmPush() {
  const approved = STATE.items.filter((i) => i.decision === "approved");
  if (!approved.length) { $("#summary").classList.add("hidden"); return; }
  const pass = getPass();
  const btn = $("#btn-confirm");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Pushing…";
  try {
    const res = await fetch(BROKER + "/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sweep-Pass": pass || "" },
      body: JSON.stringify({ items: approved }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem("sweep_pass"); throw new Error("Wrong passphrase — tap Confirm to re-enter it."); }
    if (!res.ok) throw new Error(data.error || ("Push failed (HTTP " + res.status + ")"));
    $("#summary").classList.add("hidden");
    showView("home");
    const boards = data.boards || {};
    const url = boards["DEEP"] || boards["Weekly Sweep"] || Object.values(boards)[0] || "#";
    $("#home-meta").innerHTML =
      "✓ Sent <b>" + (data.created || 0) + "</b> card(s) to Trello" +
      (data.skipped ? " (" + data.skipped + " already there)" : "") + ".<br>" +
      "<a href='" + url + "' target='_blank' style='color:var(--accent);font-weight:700'>Open Trello →</a>";
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---------- manual tasks ---------- */
const MANUAL_KEY = "manual_tasks_v1";

function loadManual() {
  try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || "[]"); }
  catch (_) { return []; }
}
function saveManual(tasks) { localStorage.setItem(MANUAL_KEY, JSON.stringify(tasks)); }

function newId() { return "man_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function addManualTask() {
  const title = $("#qa-input").value.trim();
  if (!title) { $("#qa-input").focus(); return; }
  const isAppt = $("#qa-isappt").checked;
  const when = $("#qa-when").value;
  const due = $("#qa-due").value;
  const loc = $("#qa-loc").value.trim();

  const task = {
    id: newId(),
    title,
    detail: $("#qa-detail").value.trim(),
    type: isAppt ? "appointment" : "task",
    source: "manual",
    due: (!isAppt && due) ? due : null,
    appointment: (isAppt && when)
      ? { start: new Date(when).toISOString(), end: null, location: loc }
      : null,
    createdAt: new Date().toISOString(),
    done: false,
  };
  const tasks = loadManual();
  tasks.unshift(task);
  saveManual(tasks);
  resetQuickAdd();
  renderTasks();
}

function resetQuickAdd() {
  ["qa-input", "qa-detail", "qa-due", "qa-when", "qa-loc"].forEach((id) => ($("#" + id).value = ""));
  $("#qa-isappt").checked = false;
  applyApptToggle();
  $("#qa-details").classList.add("hidden");
  $("#qa-toggle").textContent = "+ date / appointment";
  $("#qa-input").focus();
}

function toggleDone(id) {
  const tasks = loadManual();
  const t = tasks.find((x) => x.id === id);
  if (t) { t.done = !t.done; saveManual(tasks); renderTasks(); }
}
function deleteTask(id) {
  saveManual(loadManual().filter((x) => x.id !== id));
  renderTasks();
}

function renderTasks() {
  const tasks = loadManual();
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const list = $("#tasks-list");
  list.innerHTML = "";

  $("#tasks-sub").textContent = open.length
    ? open.length + " open" + (done.length ? " · " + done.length + " done" : "")
    : (tasks.length ? "all done 🎉" : "nothing yet");

  if (!tasks.length) {
    list.appendChild(el("div", "empty", "No tasks yet.<br>Jot one above — it's saved on this device."));
  }
  open.forEach((t) => list.appendChild(renderTaskRow(t)));
  done.forEach((t) => list.appendChild(renderTaskRow(t)));
  updateTasksCount();
}

function renderTaskRow(t) {
  const row = el("div", "trow" + (t.done ? " done" : ""));
  row.dataset.id = t.id;

  const check = el("button", "check", "✓");
  check.addEventListener("click", () => toggleDone(t.id));

  const main = el("div", "trow__main");
  main.appendChild(el("div", "trow__title", escapeHtml(t.title)));
  if (t.detail || t.appointment || t.due) {
    const meta = el("div", "trow__meta");
    if (t.appointment) meta.appendChild(el("span", "tag appt", "📅 " + fmtDateTime(t.appointment.start) +
      (t.appointment.location ? " · " + escapeHtml(t.appointment.location) : "")));
    if (t.due) meta.appendChild(el("span", "tag", "Due " + fmtDate(t.due)));
    if (t.detail) meta.appendChild(el("span", "tag", escapeHtml(t.detail.slice(0, 60))));
    main.appendChild(meta);
  }

  const del = el("button", "trow__del", "✕");
  del.addEventListener("click", () => deleteTask(t.id));

  row.appendChild(check);
  row.appendChild(main);
  row.appendChild(del);
  return row;
}

function updateTasksCount() {
  const open = loadManual().filter((t) => !t.done).length;
  $("#tasks-count").textContent = open;
}

function applyApptToggle() {
  const isAppt = $("#qa-isappt").checked;
  $("#qa-when-row").classList.toggle("hidden", !isAppt);
  $("#qa-loc-row").classList.toggle("hidden", !isAppt);
  $("#qa-due-row").classList.toggle("hidden", isAppt);
}

/* ---------- views ---------- */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById("view-" + name).classList.remove("hidden");
  window.scrollTo(0, 0);
}

async function runSweep() {
  const btn = $("#btn-sweep");
  btn.classList.add("loading");
  $("#btn-sweep .sweep-btn__label").textContent = "Sweeping…";
  try {
    const data = await loadCandidates();
    STATE.sweep = data.sweep;
    STATE.items = data.items;
    restoreDecisions();
    // brief beat so the action feels deliberate
    await new Promise((r) => setTimeout(r, 700));
    renderHome();
    renderReview();
    showView("review");
  } catch (e) {
    $("#home-meta").innerHTML =
      "⚠︎ Couldn't load the list. Serve the folder over http (not file://):<br><code>python3 -m http.server</code>";
  } finally {
    btn.classList.remove("loading");
    $("#btn-sweep .sweep-btn__label").textContent = "Run Sunday Sweep";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- wire up ---------- */
$("#btn-sweep").addEventListener("click", runSweep);
$("#btn-back").addEventListener("click", () => showView("home"));
$("#btn-submit").addEventListener("click", openSummary);
$("#btn-summary-close").addEventListener("click", () => $("#summary").classList.add("hidden"));
$("#btn-confirm").addEventListener("click", confirmPush);

// Tasks view
$("#btn-tasks").addEventListener("click", () => { renderTasks(); showView("tasks"); });
$("#btn-tasks-back").addEventListener("click", () => showView("home"));
$("#qa-add").addEventListener("click", addManualTask);
$("#qa-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addManualTask(); });
$("#qa-isappt").addEventListener("change", applyApptToggle);
$("#qa-toggle").addEventListener("click", () => {
  const d = $("#qa-details");
  d.classList.toggle("hidden");
  $("#qa-toggle").textContent = d.classList.contains("hidden") ? "+ date / appointment" : "– less";
});

updateTasksCount();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
