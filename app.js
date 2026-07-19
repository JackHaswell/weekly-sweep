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

function getStoredPass() {
  const p = localStorage.getItem("sweep_pass");
  return p ? p.trim() : null;
}

// In-app passphrase entry — window.prompt() is silently disabled inside an
// installed iOS home-screen app, which made the approve button appear dead.
function askPassphrase(msg) {
  return new Promise((resolve) => {
    const wrap = el("div", "modal");
    wrap.innerHTML =
      '<div class="modal__card" style="max-width:420px">' +
        "<h2>Passphrase</h2>" +
        '<p style="color:var(--muted);margin:0 0 14px">' + (msg || "Enter your Weekly Sweep passphrase") + "</p>" +
        '<input id="pass-input" type="password" autocomplete="current-password" ' +
          'style="width:100%;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--card2);color:var(--ink);font-size:16px;box-sizing:border-box" placeholder="Passphrase" />' +
        '<div class="modal__actions">' +
          '<button id="pass-cancel" class="ghost-btn">Cancel</button>' +
          '<button id="pass-ok" class="submit-btn">Save</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    const input = wrap.querySelector("#pass-input");
    setTimeout(() => input.focus(), 50);
    const done = (val) => { wrap.remove(); resolve(val); };
    const save = () => {
      const v = input.value.trim();
      if (v) { localStorage.setItem("sweep_pass", v); done(v); } else input.focus();
    };
    wrap.querySelector("#pass-ok").addEventListener("click", save);
    wrap.querySelector("#pass-cancel").addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  });
}

async function ensurePass(force) {
  const p = getStoredPass();
  if (p && !force) return p;
  return await askPassphrase(force ? "That passphrase didn't work — please re-enter it" : "Enter your Weekly Sweep passphrase");
}

async function loadCandidates() {
  // Prefer the live sweep from the cloud broker (real data, any network).
  let pass = await ensurePass();
  for (let attempt = 0; attempt < 2 && pass; attempt++) {
    try {
      const res = await fetch(BROKER + "/candidates", { headers: { "X-Sweep-Pass": pass }, cache: "no-store" });
      if (res.status === 401) {                 // wrong/old passphrase — ask again once
        localStorage.removeItem("sweep_pass");
        pass = await ensurePass(true);
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
  STATE.items.forEach((it) => (map[it.id] = { d: it.decision, b: it.board }));
  localStorage.setItem(decisionsKey(STATE.sweep.id), JSON.stringify(map));
}
function restoreDecisions() {
  if (!STATE.sweep) return;
  try {
    const map = JSON.parse(localStorage.getItem(decisionsKey(STATE.sweep.id)) || "{}");
    STATE.items.forEach((it) => {
      const m = map[it.id];
      if (!m) return;
      if (typeof m === "string") { it.decision = m; }          // back-compat with old format
      else { if (m.d) it.decision = m.d; if (m.b) it.board = m.b; }
    });
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

  // Board picker — revealed (via CSS) once the item is kept, pre-selected to the suggested board.
  const pick = el("div", "boardpick");
  pick.appendChild(el("span", "boardpick__lbl", "Send to →"));
  ["DEEP", "REACTIVE", "Weekly Sweep"].forEach((bd) => {
    const chip = el("button", "bchip" + (it.board === bd ? " sel" : ""), boardName(bd));
    chip.dataset.board = bd;
    chip.addEventListener("click", (e) => { e.stopPropagation(); setBoard(it, bd); });
    pick.appendChild(chip);
  });
  card.appendChild(pick);
  return card;
}

function setBoard(it, board) {
  it.board = board;
  saveDecisions();
  const card = document.querySelector('.card[data-id="' + it.id + '"]');
  card.querySelectorAll(".bchip").forEach((b) => b.classList.toggle("sel", b.dataset.board === board));
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

  // Only real appointments (with a start time) go to the calendar — an item tagged
  // "appointment" but missing its appointment object must not crash the summary.
  const appts = approved.filter((i) => i.type === "appointment" && i.appointment && i.appointment.start);
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

function showSummaryError(msg) {
  let e = $("#summary-error");
  if (!e) {
    e = el("div", null);
    e.id = "summary-error";
    e.style.cssText = "color:var(--no);font-weight:700;font-size:14px;margin-top:12px";
    const actions = $("#summary .modal__actions");
    actions.parentNode.insertBefore(e, actions);
  }
  e.textContent = msg || "";
  e.style.display = msg ? "block" : "none";
}

async function confirmPush() {
  const approved = STATE.items.filter((i) => i.decision === "approved");
  if (!approved.length) { $("#summary").classList.add("hidden"); return; }
  const btn = $("#btn-confirm");
  const label = btn.textContent;
  showSummaryError("");
  btn.disabled = true;
  btn.textContent = "Pushing…";
  try {
    // Retry once if the stored passphrase is rejected (re-ask in-app, not via prompt()).
    for (let attempt = 0; attempt < 2; attempt++) {
      const pass = await ensurePass(attempt > 0);
      if (!pass) { showSummaryError("A passphrase is needed to send to Trello."); return; }
      const res = await fetch(BROKER + "/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sweep-Pass": pass },
        body: JSON.stringify({ items: approved }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { localStorage.removeItem("sweep_pass"); continue; }
      if (!res.ok) throw new Error(data.error || ("Push failed (HTTP " + res.status + ")"));
      // Sync decisions back to the cloud so the Mac can write approved appointments to the Outlook calendar.
      fetch(BROKER + "/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sweep-Pass": pass },
        body: JSON.stringify({ sweep: STATE.sweep || { id: "live" }, items: STATE.items }),
      }).catch(() => {});
      $("#summary").classList.add("hidden");
      showView("home");
      const boards = data.boards || {};
      const url = boards["DEEP"] || boards["Weekly Sweep"] || Object.values(boards)[0] || "#";
      $("#home-meta").innerHTML =
        "✓ Sent <b>" + (data.created || 0) + "</b> card(s) to Trello" +
        (data.skipped ? " (" + data.skipped + " already there)" : "") + ".<br>" +
        "<a href='" + url + "' target='_blank' style='color:var(--accent);font-weight:700'>Open Trello →</a>";
      return;
    }
    showSummaryError("That passphrase didn't work — tap Confirm to try again.");
  } catch (e) {
    const net = /fail|fetch|load failed|network/i.test(e.message || "");
    showSummaryError(net
      ? "Couldn't reach the server — check your connection and tap Confirm to retry."
      : (e.message || "Couldn't send to Trello."));
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

/* ---------- tag picker (so manual tasks carry the same labels as the sweep) ---------- */
const TAG_GROUPS = [
  ["Priority", ["CRITICAL", "High", "TODAY", "THIS WEEK"]],
  ["Property", ["8 Station Road", "100-104 High Northgate", "33 Alderson Street", "Elwick Road", "23 Kilwick Street"]],
  ["Category", ["LEGAL", "COMPLIANCE", "ACCOUNTING", "TAX", "CONTRACT", "ADMIN", "STRATEGY", "Management Task", "MAINTENANCE", "TENANT COMMS", "CONTRACTOR", "INVESTOR"]],
];
const qaLabels = new Set();

function renderTagPicker() {
  const box = $("#qa-tags");
  if (!box) return;
  box.innerHTML = "";
  TAG_GROUPS.forEach(([group, labels]) => {
    box.appendChild(el("div", "qa-tags__group", group));
    const row = el("div", "qa-tags__row");
    labels.forEach((lb) => {
      const chip = el("button", "tagchip" + (qaLabels.has(lb) ? " sel" : ""), escapeHtml(lb));
      chip.type = "button";
      chip.addEventListener("click", () => {
        if (qaLabels.has(lb)) qaLabels.delete(lb); else qaLabels.add(lb);
        chip.classList.toggle("sel");
      });
      row.appendChild(chip);
    });
    box.appendChild(row);
  });
}

// Owner is auto-set from the board; a task with no chosen tags still gets THIS WEEK.
function labelsFor(target, chosen) {
  chosen = chosen || [];
  if (target === "Weekly Sweep" || target === "local") return chosen.slice();
  const owner = target === "REACTIVE" ? "Owner: Josh" : "Owner: Jack";
  const base = chosen.length ? chosen : ["THIS WEEK"];
  return [...new Set([owner, ...base])];
}

async function addManualTask() {
  const title = $("#qa-input").value.trim();
  if (!title) { $("#qa-input").focus(); return; }
  const isAppt = $("#qa-isappt").checked;
  const when = $("#qa-when").value;
  const due = $("#qa-due").value;
  const loc = $("#qa-loc").value.trim();
  const target = $("#qa-target").value;

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
    target,
    labels: [...qaLabels],
  };
  const tasks = loadManual();
  tasks.unshift(task);
  saveManual(tasks);
  resetQuickAdd();
  renderTasks();

  if (target === "local") {
    setStatus("Saved to this device.", "");
    return;
  }
  setStatus("Sending to Trello…", "");
  const r = await captureToTrello(task, target);
  if (r.ok) {
    const list = loadManual();
    const t = list.find((x) => x.id === task.id);
    if (t) { t.sent = true; saveManual(list); renderTasks(); }
    setStatus("✓ Captured to the " + boardName(target) + " board" +
      (r.created === 0 ? " (already there)." : "."), "ok");
  } else {
    setStatus("⚠︎ Saved here — tap ↻ on the task to send once your passphrase is right (" + r.msg + ").", "warn");
  }
}

function setStatus(msg, kind) {
  const el = $("#qa-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "qa-status" + (kind ? " " + kind : "");
  if (kind === "ok") setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}

function boardName(target) {
  return { "DEEP": "DEEP", "REACTIVE": "Josh's REACTIVE", "Weekly Sweep": "Personal" }[target] || target;
}

async function captureToTrello(task, target) {
  const item = {
    title: task.title,
    detail: task.detail || "Added via quick capture",
    type: task.type,
    source: "manual",
    from: "Quick capture",
    due: task.due,
    appointment: task.appointment,
    confidence: 1,
    needsDecision: false,
    board: target,
    labels: labelsFor(target, task.labels),
    suggestedTrelloList: task.type === "appointment" ? "Appointments" : "Inbox",
  };
  let pass = await ensurePass();
  for (let attempt = 0; attempt < 2; attempt++) {       // re-ask once if the passphrase is wrong
    if (!pass) return { ok: false, msg: "no passphrase" };
    try {
      const res = await fetch(BROKER + "/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sweep-Pass": pass },
        body: JSON.stringify({ items: [item] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { localStorage.removeItem("sweep_pass"); pass = await ensurePass(true); continue; }
      if (!res.ok) return { ok: false, msg: data.error || ("HTTP " + res.status) };
      return { ok: true, created: data.created };
    } catch (_) {
      return { ok: false, msg: "no connection" };
    }
  }
  return { ok: false, msg: "wrong passphrase" };
}

async function resendTask(id) {
  const tasks = loadManual();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  setStatus("Sending to Trello…", "");
  const r = await captureToTrello(task, task.target || "DEEP");
  if (r.ok) {
    task.sent = true;
    saveManual(tasks);
    renderTasks();
    setStatus("✓ Sent to the " + boardName(task.target || "DEEP") + " board.", "ok");
  } else {
    setStatus("⚠︎ Still couldn't send (" + r.msg + ").", "warn");
  }
}

function resetQuickAdd() {
  ["qa-input", "qa-detail", "qa-due", "qa-when", "qa-loc"].forEach((id) => ($("#" + id).value = ""));
  $("#qa-isappt").checked = false;
  applyApptToggle();
  $("#qa-details").classList.add("hidden");
  $("#qa-toggle").textContent = "+ date / appointment";
  qaLabels.clear();
  renderTagPicker();
  $("#qa-tags").classList.add("hidden");
  $("#qa-tags-toggle").textContent = "+ tags";
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

  const needsSend = !t.done && t.target && t.target !== "local" && !t.sent;

  const main = el("div", "trow__main");
  main.appendChild(el("div", "trow__title", escapeHtml(t.title)));
  const meta = el("div", "trow__meta");
  if (t.appointment) meta.appendChild(el("span", "tag appt", "📅 " + fmtDateTime(t.appointment.start) +
    (t.appointment.location ? " · " + escapeHtml(t.appointment.location) : "")));
  if (t.due) meta.appendChild(el("span", "tag", "Due " + fmtDate(t.due)));
  if (t.detail) meta.appendChild(el("span", "tag", escapeHtml(t.detail.slice(0, 60))));
  if (needsSend) meta.appendChild(el("span", "tag unsent", "⚠︎ not in Trello yet"));
  else if (t.sent) meta.appendChild(el("span", "tag sent", "✓ in Trello"));
  if (meta.childNodes.length) main.appendChild(meta);

  row.appendChild(check);
  row.appendChild(main);

  if (needsSend) {
    const send = el("button", "trow__send", "↻");
    send.setAttribute("aria-label", "Send to Trello");
    send.addEventListener("click", () => resendTask(t.id));
    row.appendChild(send);
  }

  const del = el("button", "trow__del", "✕");
  del.addEventListener("click", () => deleteTask(t.id));
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
$("#qa-tags-toggle").addEventListener("click", () => {
  const t = $("#qa-tags");
  t.classList.toggle("hidden");
  $("#qa-tags-toggle").textContent = t.classList.contains("hidden") ? "+ tags" : "– tags";
});

renderTagPicker();
updateTasksCount();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
