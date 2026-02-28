/* ── Tab switching ────────────────────────────────────────────────── */

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => {
      t.classList.remove("active");
      t.classList.add("hidden");
    });
    btn.classList.add("active");
    const tab = document.getElementById(`tab-${btn.dataset.tab}`);
    tab.classList.remove("hidden");
    tab.classList.add("active");

    if (btn.dataset.tab === "tasks")     loadTasks();
    if (btn.dataset.tab === "log")       { loadLogTasks(); loadRecentEntries(); renderQueue(); }
    if (btn.dataset.tab === "history")   loadHistory();
    if (btn.dataset.tab === "analytics") loadAnalytics();
  });
});

/* ── Timer ────────────────────────────────────────────────────────── */

let timerInterval  = null;
let timerStartedAt = null;   // module-level so polls can recalibrate
let pollInterval   = null;

function startPolling() { if (!pollInterval) pollInterval = setInterval(pollTimer, 5000); }
function stopPolling()  { clearInterval(pollInterval); pollInterval = null; }

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function formatRounded(seconds) {
  const rounded = Math.ceil(seconds / 900) * 900;
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  if (h > 0 && m > 0) return `≈ ${h}h ${m}m`;
  if (h > 0) return `≈ ${h}h`;
  return `≈ ${m}m`;
}

function setTimerUI(state) {
  const display      = document.getElementById("timer-display");
  const rounded      = document.getElementById("timer-rounded");
  const label        = document.getElementById("timer-task-label");
  const idle         = document.getElementById("timer-controls-idle");
  const runningCtrl  = document.getElementById("timer-controls-running");
  const info         = document.getElementById("timer-info");
  const timerDate    = document.getElementById("timer-date");
  const timerStarted = document.getElementById("timer-started");
  const btnPause     = document.getElementById("btn-pause");
  const btnResume    = document.getElementById("btn-resume");

  if (state.running) {
    const elapsed = state.elapsed_seconds ?? 0;
    display.textContent = formatTime(elapsed);
    rounded.textContent = formatRounded(elapsed);
    rounded.classList.remove("hidden");
    label.textContent   = state.task_name ?? "";
    idle.classList.add("hidden");
    runningCtrl.classList.remove("hidden");

    if (state.started_at) {
      const startDate = new Date(state.started_at);
      timerDate.textContent    = startDate.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      timerStarted.textContent = "Started at " + startDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      info.classList.remove("hidden");
    }

    if (state.paused) {
      // Freeze display — clear any running interval
      clearInterval(timerInterval);
      timerInterval  = null;
      timerStartedAt = null;
      btnPause.classList.add("hidden");
      btnResume.classList.remove("hidden");
    } else {
      btnPause.classList.remove("hidden");
      btnResume.classList.add("hidden");
      // Always recalibrate startedAt on each poll (drift fix)
      timerStartedAt = Date.now() - elapsed * 1000;
      if (!timerInterval) {
        timerInterval = setInterval(() => {
          const secs = (Date.now() - timerStartedAt) / 1000;
          display.textContent = formatTime(secs);
          rounded.textContent = formatRounded(secs);
        }, 1000);
      }
    }

    startPolling();
  } else {
    display.textContent = "00:00:00";
    rounded.textContent = "";
    rounded.classList.add("hidden");
    label.textContent   = "";
    timerDate.textContent    = "";
    timerStarted.textContent = "";
    info.classList.add("hidden");
    idle.classList.remove("hidden");
    runningCtrl.classList.add("hidden");
    clearInterval(timerInterval);
    timerInterval  = null;
    timerStartedAt = null;
    stopPolling();
  }
}

async function pollTimer() {
  try {
    const res  = await fetch("/api/timer/status");
    const data = await res.json();
    setTimerUI(data);
  } catch (_) {}
}

pollTimer();

async function loadActiveTasks() {
  const res   = await fetch("/api/tasks");
  const tasks = await res.json();
  const sel   = document.getElementById("timer-task-select");
  const cur   = sel.value;
  sel.innerHTML = '<option value="">Select a task…</option>';
  tasks.filter(t => t.active).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    if (String(t.id) === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

loadActiveTasks();

document.getElementById("btn-start").addEventListener("click", async () => {
  const sel    = document.getElementById("timer-task-select");
  const taskId = sel.value;
  if (!taskId) { alert("Please select a task first."); return; }
  const res = await fetch("/api/timer/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: Number(taskId) }),
  });
  if (!res.ok) { alert((await res.json()).error ?? "Could not start timer"); return; }
  await pollTimer();
});

document.getElementById("btn-pause").addEventListener("click", async () => {
  const res = await fetch("/api/timer/pause", { method: "POST" });
  if (!res.ok) { alert((await res.json()).error ?? "Could not pause timer"); return; }
  await pollTimer();
});

document.getElementById("btn-resume").addEventListener("click", async () => {
  const res = await fetch("/api/timer/resume", { method: "POST" });
  if (!res.ok) { alert((await res.json()).error ?? "Could not resume timer"); return; }
  await pollTimer();
});

document.getElementById("btn-stop").addEventListener("click", async () => {
  const res = await fetch("/api/timer/stop", { method: "POST" });
  if (!res.ok) { alert((await res.json()).error ?? "Could not stop timer"); return; }
  clearInterval(timerInterval);
  timerInterval  = null;
  timerStartedAt = null;
  setTimerUI({ running: false });
  loadDailyGoal();
});

/* ── Tasks ────────────────────────────────────────────────────────── */

async function loadTasks() {
  const res   = await fetch("/api/tasks");
  const tasks = await res.json();
  const tbody = document.getElementById("tasks-tbody");
  tbody.innerHTML = "";
  tasks.forEach(t => {
    const tr = document.createElement("tr");
    tr.dataset.taskId = t.id;
    const badge = t.active
      ? '<span class="badge badge-active">Active</span>'
      : '<span class="badge badge-disabled">Disabled</span>';
    tr.innerHTML = `
      <td>${escHtml(t.name)}</td>
      <td>${badge}</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="startRenameTask(${t.id}, '${escAttr(t.name)}')">Rename</button>
        ${t.active ? `<button class="btn btn-secondary btn-sm" onclick="disableTask(${t.id})">Disable</button>` : ""}
        <button class="btn btn-danger btn-sm" onclick="deleteTask(${t.id}, '${escAttr(t.name)}')">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function startRenameTask(id, currentName) {
  const row = document.querySelector(`tr[data-task-id="${id}"]`);
  if (!row) return;
  row.innerHTML = `
    <td colspan="3">
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <input id="rename-input-${id}" type="text" value="${escHtml(currentName)}"
               style="flex:1;padding:0.35rem 0.5rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.875rem;"
               onkeydown="if(event.key==='Enter')saveRenameTask(${id});if(event.key==='Escape')loadTasks();" />
        <button class="btn btn-primary btn-sm" onclick="saveRenameTask(${id})">Save</button>
        <button class="btn btn-secondary btn-sm" onclick="loadTasks()">Cancel</button>
      </div>
      <div id="rename-error-${id}" class="edit-error hidden"></div>
    </td>`;
  const inp = document.getElementById(`rename-input-${id}`);
  inp.focus();
  inp.select();
}

async function saveRenameTask(id) {
  const input  = document.getElementById(`rename-input-${id}`);
  const errDiv = document.getElementById(`rename-error-${id}`);
  const name   = input.value.trim();
  if (!name) { errDiv.textContent = "Name cannot be empty."; errDiv.classList.remove("hidden"); return; }
  const res = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    errDiv.textContent = (await res.json()).error ?? "Could not rename.";
    errDiv.classList.remove("hidden");
    return;
  }
  loadTasks();
  loadActiveTasks();
}

async function disableTask(id) {
  await fetch(`/api/tasks/${id}/disable`, { method: "PATCH" });
  loadTasks();
  loadActiveTasks();
}

async function deleteTask(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) { alert((await res.json()).error ?? "Cannot delete task"); return; }
  loadTasks();
  loadActiveTasks();
}

document.getElementById("add-task-form").addEventListener("submit", async e => {
  e.preventDefault();
  const input  = document.getElementById("new-task-name");
  const errDiv = document.getElementById("add-task-error");
  errDiv.classList.add("hidden");
  const name = input.value.trim();
  if (!name) return;
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    errDiv.textContent = (await res.json()).error ?? "Error adding task";
    errDiv.classList.remove("hidden");
    return;
  }
  input.value = "";
  loadTasks();
  loadActiveTasks();
});

/* ── Log Time ─────────────────────────────────────────────────────── */

let logQueue = JSON.parse(localStorage.getItem("logQueue") || "[]");
function saveQueue() { localStorage.setItem("logQueue", JSON.stringify(logQueue)); }

async function loadLogTasks() {
  const res   = await fetch("/api/tasks");
  const tasks = await res.json();
  const sel   = document.getElementById("log-task-select");
  const cur   = sel.value;
  sel.innerHTML = '<option value="">Select task…</option>';
  tasks.filter(t => t.active).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    if (String(t.id) === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

document.getElementById("log-date").value = dateToISO(new Date());

["log-start", "log-end"].forEach(id => {
  document.getElementById(id).addEventListener("input", e => autoColonTime(e.target, e));
});

document.getElementById("log-entry-form").addEventListener("submit", e => {
  e.preventDefault();
  const errDiv  = document.getElementById("log-entry-error");
  errDiv.classList.add("hidden");

  const taskSel  = document.getElementById("log-task-select");
  const taskId   = taskSel.value;
  const taskName = taskSel.options[taskSel.selectedIndex]?.text ?? "";
  const date     = document.getElementById("log-date").value;
  const start    = parseTime(document.getElementById("log-start").value);
  const end      = parseTime(document.getElementById("log-end").value);

  if (!taskId) { showLogError("Please select a task."); return; }
  if (!date)   { showLogError("Please pick a date."); return; }
  if (!start)  { showLogError("Start time must be HH:MM in 24-hour format (e.g. 09:00)."); return; }
  if (!end)    { showLogError("End time must be HH:MM in 24-hour format (e.g. 17:30)."); return; }

  if (new Date(`${date}T${end}`) <= new Date(`${date}T${start}`)) {
    showLogError("End time must be after start time.");
    return;
  }

  logQueue.push({ task_id: Number(taskId), task_name: taskName, date, started_at: start, ended_at: end });
  saveQueue();
  renderQueue();
  document.getElementById("log-start").value = "";
  document.getElementById("log-end").value   = "";
});

function showLogError(msg) {
  const d = document.getElementById("log-entry-error");
  d.textContent = msg;
  d.classList.remove("hidden");
}

function fmtDuration(start, end, date) {
  const mins = Math.round((new Date(`${date}T${end}`) - new Date(`${date}T${start}`)) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderQueue() {
  const card   = document.getElementById("log-queue-card");
  const tbody  = document.getElementById("log-queue-tbody");
  const count  = document.getElementById("log-queue-count");
  const msgDiv = document.getElementById("log-submit-msg");
  count.textContent = logQueue.length;
  msgDiv.classList.add("hidden");
  if (!logQueue.length) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  tbody.innerHTML = "";
  logQueue.forEach((entry, i) => {
    const dur = fmtDuration(entry.started_at, entry.ended_at, entry.date);
    const tr  = document.createElement("tr");
    tr.innerHTML = `
      <td>${escHtml(entry.task_name)}</td>
      <td>${entry.date}</td>
      <td>${entry.started_at}</td>
      <td>${entry.ended_at}</td>
      <td>${dur}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeQueueItem(${i})">×</button></td>`;
    tbody.appendChild(tr);
  });
}

function removeQueueItem(i) { logQueue.splice(i, 1); saveQueue(); renderQueue(); }

document.getElementById("btn-clear-queue").addEventListener("click", () => { logQueue = []; saveQueue(); renderQueue(); });

document.getElementById("btn-submit-all").addEventListener("click", async () => {
  if (!logQueue.length) return;
  const msgDiv  = document.getElementById("log-submit-msg");
  const payload = logQueue.map(e => ({ task_id: e.task_id, date: e.date, started_at: e.started_at, ended_at: e.ended_at }));
  const res = await fetch("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await res.json();
  if (d.errors && d.errors.length) {
    msgDiv.className = "warn-msg";
    msgDiv.textContent = `${d.added} saved. Errors: ${d.errors.join("; ")}`;
  } else {
    msgDiv.className = "success-msg";
    msgDiv.textContent = `${d.added} entr${d.added === 1 ? "y" : "ies"} saved.`;
    logQueue = [];
    localStorage.removeItem("logQueue");
    renderQueue();
  }
  msgDiv.classList.remove("hidden");
  loadRecentEntries();
});

const logOpenDates = new Set();

async function loadRecentEntries() {
  const res     = await fetch("/api/entries?limit=50");
  const entries = await res.json();
  const container = document.getElementById("log-recent-list");
  container.innerHTML = "";

  if (!entries.length) {
    container.innerHTML = `<p class="muted" style="text-align:center;padding:1rem">No entries yet</p>`;
    return;
  }

  // Seed default: today starts open
  const today = dateToISO(new Date());
  if (logOpenDates.size === 0) logOpenDates.add(today);

  // Group by date (API returns newest-first so insertion order is correct)
  const dateGroups = new Map();
  entries.forEach(e => {
    if (!dateGroups.has(e.date)) dateGroups.set(e.date, []);
    dateGroups.get(e.date).push(e);
  });

  dateGroups.forEach((dayEntries, date) => {
    const totalSecs = dayEntries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
    const summary   = `${dayEntries.length} entr${dayEntries.length === 1 ? "y" : "ies"} · ${(totalSecs / 3600).toFixed(1)}h`;
    const isOpen    = logOpenDates.has(date);

    const group = document.createElement("div");
    group.className = "history-group" + (isOpen ? " open" : "");

    const header = document.createElement("div");
    header.className = "history-group-header";
    header.innerHTML = `
      <span class="history-chevron">&#9654;</span>
      <span class="history-date">${fmtDateLong(date)}</span>
      <span class="history-summary">${summary}</span>`;
    header.addEventListener("click", () => {
      if (group.classList.contains("open")) {
        group.classList.remove("open");
        logOpenDates.delete(date);
      } else {
        group.classList.add("open");
        logOpenDates.add(date);
      }
    });

    const rows = dayEntries.map(e => {
      const start = parseStoredTime(e.started_at);
      const end   = parseStoredTime(e.ended_at);
      const mins  = e.duration_seconds ? Math.round(e.duration_seconds / 60) : 0;
      const h = Math.floor(mins / 60), m = mins % 60;
      const dur = mins ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : "—";
      return `<tr>
        <td>${escHtml(e.task_name)}</td>
        <td>${start}</td>
        <td>${end}</td>
        <td>${dur}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteEntry(${e.id})">×</button></td>
      </tr>`;
    }).join("");

    const body = document.createElement("div");
    body.className = "history-group-body";
    body.innerHTML = `<table>
      <thead><tr><th>Task</th><th>From</th><th>To</th><th>Duration</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    group.appendChild(header);
    group.appendChild(body);
    container.appendChild(group);
  });
}

async function deleteEntry(id) {
  if (!confirm("Delete this entry?")) return;
  await fetch(`/api/entries/${id}`, { method: "DELETE" });
  loadRecentEntries();
}

/* ── History ──────────────────────────────────────────────────────── */

const historyOpenDates = new Set();
const historyOpenWeeks = new Set();
let historyTasks = [];

async function loadHistory() {
  const [entriesRes, tasksRes] = await Promise.all([
    fetch("/api/entries/all"),
    fetch("/api/tasks"),
  ]);
  const entries = await entriesRes.json();
  historyTasks  = await tasksRes.json();

  // Group entries by date
  const dateGroups = new Map();
  entries.forEach(e => {
    if (!dateGroups.has(e.date)) dateGroups.set(e.date, []);
    dateGroups.get(e.date).push(e);
  });

  // Group dates by week (Sunday = week start, consistent with analytics)
  const weekGroups = new Map();
  dateGroups.forEach((dayEntries, date) => {
    const d      = new Date(date + "T00:00:00");
    const sunday = sundayOf(d);
    const weekKey = dateToISO(sunday);
    if (!weekGroups.has(weekKey)) weekGroups.set(weekKey, { sunday, dates: [] });
    weekGroups.get(weekKey).dates.push([date, dayEntries]);
  });

  // Default open state: most recent week and most recent date within it
  if (historyOpenWeeks.size === 0 && weekGroups.size > 0) {
    historyOpenWeeks.add([...weekGroups.keys()][0]);
  }
  if (historyOpenDates.size === 0 && dateGroups.size > 0) {
    historyOpenDates.add([...dateGroups.keys()][0]);
  }

  const container = document.getElementById("history-list");
  container.innerHTML = "";

  if (!weekGroups.size) {
    container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No entries recorded yet.</div>`;
    return;
  }

  weekGroups.forEach(({ sunday, dates }, weekKey) => {
    const weekTotalSecs    = dates.reduce((s, [, de]) => s + de.reduce((ss, e) => ss + (e.duration_seconds ?? 0), 0), 0);
    const weekTotalEntries = dates.reduce((s, [, de]) => s + de.length, 0);
    const weekSummary      = `${weekTotalEntries} entr${weekTotalEntries === 1 ? "y" : "ies"} · ${(weekTotalSecs / 3600).toFixed(1)}h`;
    const isWeekOpen       = historyOpenWeeks.has(weekKey);

    const weekEl = document.createElement("div");
    weekEl.className     = "history-week" + (isWeekOpen ? " open" : "");
    weekEl.dataset.weekKey = weekKey;

    const weekHeader = document.createElement("div");
    weekHeader.className = "history-week-header";
    weekHeader.innerHTML = `
      <span class="history-week-chevron">&#9654;</span>
      <span class="history-week-label">${fmtWeekLabel(sunday)}</span>
      <span class="history-week-summary">${weekSummary}</span>`;
    weekHeader.addEventListener("click", () => toggleHistoryWeek(weekEl, weekKey));

    const weekBody = document.createElement("div");
    weekBody.className = "history-week-body";

    dates.forEach(([date, dayEntries]) => {
      const totalSecs = dayEntries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
      const summary   = `${dayEntries.length} entr${dayEntries.length === 1 ? "y" : "ies"} · ${(totalSecs / 3600).toFixed(1)}h`;
      const isOpen    = historyOpenDates.has(date);

      const group = document.createElement("div");
      group.className  = "history-group" + (isOpen ? " open" : "");
      group.dataset.date = date;

      const header = document.createElement("div");
      header.className = "history-group-header";
      header.innerHTML = `
        <span class="history-chevron">&#9654;</span>
        <span class="history-date">${fmtDateLong(date)}</span>
        <span class="history-summary">${summary}</span>`;
      header.addEventListener("click", () => toggleHistoryGroup(group, date));

      const body = document.createElement("div");
      body.className = "history-group-body";
      body.innerHTML = `
        <table>
          <thead><tr><th>Task</th><th>From</th><th>To</th><th>Duration</th><th></th></tr></thead>
          <tbody>${dayEntries.map(e => entryRowHTML(e)).join("")}</tbody>
        </table>`;

      group.appendChild(header);
      group.appendChild(body);
      weekBody.appendChild(group);
    });

    weekEl.appendChild(weekHeader);
    weekEl.appendChild(weekBody);
    container.appendChild(weekEl);
  });
}

function toggleHistoryWeek(weekEl, weekKey) {
  if (weekEl.classList.contains("open")) {
    weekEl.classList.remove("open");
    historyOpenWeeks.delete(weekKey);
  } else {
    weekEl.classList.add("open");
    historyOpenWeeks.add(weekKey);
  }
}

function toggleHistoryGroup(group, date) {
  if (group.classList.contains("open")) {
    group.classList.remove("open");
    historyOpenDates.delete(date);
  } else {
    group.classList.add("open");
    historyOpenDates.add(date);
  }
}

function fmtDateLong(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function parseStoredTime(dtStr) {
  if (!dtStr) return "";
  if (dtStr.includes("+") || dtStr.endsWith("Z")) {
    return new Date(dtStr).toTimeString().slice(0, 5);
  }
  return dtStr.length >= 16 ? dtStr.slice(11, 16) : dtStr.slice(0, 5);
}

function fmtDurationSecs(secs) {
  if (!secs) return "—";
  const m = Math.round(secs / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function entryRowHTML(e) {
  const from = parseStoredTime(e.started_at);
  const to   = parseStoredTime(e.ended_at);
  const dur  = fmtDurationSecs(e.duration_seconds);
  return `<tr data-entry-id="${e.id}">
    <td>${escHtml(e.task_name)}</td>
    <td>${from}</td>
    <td>${to}</td>
    <td>${dur}</td>
    <td class="actions">
      <button class="btn btn-secondary btn-sm" onclick="startEditEntry(${e.id},${e.task_id},'${e.date}','${from}','${to}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="deleteHistoryEntry(${e.id})">×</button>
    </td>
  </tr>`;
}

function startEditEntry(id, taskId, date, from, to) {
  const row = document.querySelector(`tr[data-entry-id="${id}"]`);
  if (!row) return;
  const taskOptions = historyTasks.map(t =>
    `<option value="${t.id}" ${t.id === taskId ? "selected" : ""}>${escHtml(t.name)}</option>`
  ).join("");
  row.className = "edit-row";
  row.innerHTML = `
    <td colspan="5">
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <select id="edit-task-${id}">${taskOptions}</select>
        <input type="date" id="edit-date-${id}" value="${date}" />
        <input type="text" id="edit-start-${id}" value="${from}" placeholder="HH:MM" maxlength="5" style="width:72px;" oninput="autoColonTime(this,event)" />
        <span class="time-sep">→</span>
        <input type="text" id="edit-end-${id}" value="${to}" placeholder="HH:MM" maxlength="5" style="width:72px;" oninput="autoColonTime(this,event)" />
        <div class="edit-actions">
          <button class="btn btn-primary btn-sm" onclick="saveEditEntry(${id})">Save</button>
          <button class="btn btn-secondary btn-sm" onclick="loadHistory()">Cancel</button>
        </div>
      </div>
      <div id="edit-error-${id}" class="edit-error hidden"></div>
    </td>`;
}

async function saveEditEntry(id) {
  const taskId  = document.getElementById(`edit-task-${id}`).value;
  const date    = document.getElementById(`edit-date-${id}`).value;
  const errDiv  = document.getElementById(`edit-error-${id}`);
  const started = parseTime(document.getElementById(`edit-start-${id}`).value);
  const ended   = parseTime(document.getElementById(`edit-end-${id}`).value);

  if (!date)    { errDiv.textContent = "Date is required."; errDiv.classList.remove("hidden"); return; }
  if (!started || !ended) {
    errDiv.textContent = "Times must be HH:MM in 24-hour format.";
    errDiv.classList.remove("hidden");
    return;
  }

  const res = await fetch(`/api/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: Number(taskId), date, started_at: started, ended_at: ended }),
  });
  if (!res.ok) {
    errDiv.textContent = (await res.json()).error ?? "Could not save.";
    errDiv.classList.remove("hidden");
    return;
  }
  historyOpenDates.add(date);
  loadHistory();
}

async function deleteHistoryEntry(id) {
  if (!confirm("Delete this entry?")) return;
  await fetch(`/api/entries/${id}`, { method: "DELETE" });
  loadHistory();
}

/* ── Analytics sub-tab switching ─────────────────────────────────── */

document.querySelectorAll(".subtab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".subtab").forEach(s => { s.classList.remove("active"); s.classList.add("hidden"); });
    btn.classList.add("active");
    const subtab = document.getElementById(`subtab-${btn.dataset.subtab}`);
    subtab.classList.remove("hidden");
    subtab.classList.add("active");
    if (btn.dataset.subtab === "trends") loadTrends();
  });
});

/* ── Analytics — shared helpers ───────────────────────────────────── */

const CHART_COLORS = ["#6366f1","#22d3ee","#f59e0b","#22c55e","#f43f5e","#a78bfa","#34d399","#fb923c","#60a5fa","#e879f9"];

function buildColorMap(data) {
  const map = {};
  data.forEach((row, i) => { map[row.task_name] = CHART_COLORS[i % CHART_COLORS.length]; });
  return map;
}

function buildTaskFilters(containerId, data, selectedSet, colorMap, onChangeCb, allBtnId, noneBtnId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  data.forEach(row => {
    const name  = row.task_name;
    const color = colorMap[name] ?? CHART_COLORS[0];
    const item  = document.createElement("label");
    item.className = "task-filter-item";
    item.innerHTML = `
      <input type="checkbox" ${selectedSet.has(name) ? "checked" : ""} />
      <span class="task-color-dot" style="background:${color}"></span>
      <span>${escHtml(name)}</span>`;
    item.querySelector("input").addEventListener("change", e => {
      if (e.target.checked) selectedSet.add(name);
      else selectedSet.delete(name);
      onChangeCb();
    });
    container.appendChild(item);
  });
  document.getElementById(allBtnId).onclick = () => {
    data.forEach(r => selectedSet.add(r.task_name));
    container.querySelectorAll("input").forEach(cb => cb.checked = true);
    onChangeCb();
  };
  document.getElementById(noneBtnId).onclick = () => {
    selectedSet.clear();
    container.querySelectorAll("input").forEach(cb => cb.checked = false);
    onChangeCb();
  };
}

/* ── Analytics — Weekly ───────────────────────────────────────────── */

let currentWeekStart    = sundayOf(new Date());
let weeklyChart         = null;
let weeklyLastData      = [];
let weeklyLastDates     = [];
let weeklyColorMap      = {};
let weeklySelectedTasks = new Set();

function sundayOf(d) {
  const sun = new Date(d);
  sun.setDate(d.getDate() - d.getDay());
  return sun;
}

function dateToISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtWeekLabel(sunday) {
  const saturday = addDays(sunday, 6);
  const opts = { month: "short", day: "numeric" };
  return `${sunday.toLocaleDateString("en-US", opts)} – ${saturday.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

async function loadAnalytics() {
  const ws = dateToISO(currentWeekStart);
  document.getElementById("week-label").textContent = fmtWeekLabel(currentWeekStart);
  const res       = await fetch(`/api/analytics/daily?week_start=${ws}`);
  const dailyData = await res.json();
  weeklyLastData  = dailyData.data;
  weeklyLastDates = dailyData.week_dates;
  weeklyColorMap  = buildColorMap(weeklyLastData);
  // Keep existing selections; add any new tasks as selected by default
  weeklyLastData.forEach(r => { if (!weeklySelectedTasks.has(r.task_name)) weeklySelectedTasks.add(r.task_name); });
  // Remove tasks no longer in this week's data from the set
  const thisWeekTasks = new Set(weeklyLastData.map(r => r.task_name));
  [...weeklySelectedTasks].forEach(n => { if (!thisWeekTasks.has(n)) weeklySelectedTasks.delete(n); });
  buildTaskFilters("weekly-task-filters", weeklyLastData, weeklySelectedTasks, weeklyColorMap,
    renderWeeklyFiltered, "weekly-select-all", "weekly-select-none");
  renderWeeklyFiltered();
}

function renderWeeklyFiltered() {
  const filtered = weeklyLastData.filter(r => weeklySelectedTasks.has(r.task_name));
  renderWeeklyChart(filtered, weeklyLastDates);
  renderDailyTable(filtered, weeklyLastDates);
}

function renderWeeklyChart(data, weekDates) {
  const ctx = document.getElementById("weekly-chart").getContext("2d");
  if (weeklyChart) weeklyChart.destroy();

  const labels   = weekDates.map(d => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }));
  const datasets = data.map(row => ({
    label: row.task_name,
    data: weekDates.map(d => row.days[d] ?? 0),
    backgroundColor: weeklyColorMap[row.task_name] ?? CHART_COLORS[0],
    borderRadius: 2,
    stack: "hours",
  }));

  weeklyChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { color: "#e2e8f0", boxWidth: 12, padding: 16, font: { size: 12 } } },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#8892a4" }, grid: { color: "#2e3347" } },
        y: { stacked: true, ticks: { color: "#8892a4" }, grid: { color: "#2e3347" }, title: { display: true, text: "Hours", color: "#8892a4" } },
      },
    },
  });
}

function renderDailyTable(data, weekDates) {
  const thead = document.getElementById("daily-thead");
  const tbody = document.getElementById("daily-tbody");
  const tfoot = document.getElementById("daily-tfoot");

  const dayLabels = weekDates.map(d => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }));
  thead.innerHTML = `<tr><th>Task</th>${dayLabels.map(l => `<th>${l}</th>`).join("")}<th>Total</th></tr>`;

  tbody.innerHTML = "";
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="${weekDates.length + 2}" class="muted" style="text-align:center;padding:1rem">No data for this week</td></tr>`;
  } else {
    data.forEach(row => {
      const cells = weekDates.map(d => {
        const h = row.days[d] ?? 0;
        return `<td class="${h === 0 ? "muted" : ""}">${fmtHours(h)}</td>`;
      }).join("");
      tbody.innerHTML += `<tr><td>${escHtml(row.task_name)}</td>${cells}<td><strong>${fmtHours(row.total)}</strong></td></tr>`;
    });
  }

  const colTotals  = weekDates.map(d => data.reduce((s, r) => s + (r.days[d] ?? 0), 0));
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);
  tfoot.innerHTML  = `<tr><td>Total</td>${colTotals.map(t => `<td>${fmtHours(t)}</td>`).join("")}<td>${fmtHours(grandTotal)}</td></tr>`;
}

document.getElementById("btn-prev-week").addEventListener("click", () => { currentWeekStart = addDays(currentWeekStart, -7); loadAnalytics(); });
document.getElementById("btn-next-week").addEventListener("click", () => { currentWeekStart = addDays(currentWeekStart,  7); loadAnalytics(); });
document.getElementById("btn-today-week").addEventListener("click", () => { currentWeekStart = sundayOf(new Date()); loadAnalytics(); });

/* ── Analytics — Trends ───────────────────────────────────────────── */

let trendsChart          = null;
let trendsActivePreset   = "ytd";
let trendsCustomStart    = null;
let trendsCustomEnd      = null;
let trendsChartType      = "bar";
let trendsLastData       = null;
let trendsLastWeeks      = null;
let trendsColorMap       = {};
let trendsSelectedTasks  = new Set();

function trendsPresetRange(preset) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "ytd":          return [`${y}-01-01`, dateToISO(today)];
    case "30d":          return [dateToISO(addDays(today, -30)),  dateToISO(today)];
    case "90d":          return [dateToISO(addDays(today, -90)),  dateToISO(today)];
    case "6m":           return [dateToISO(addDays(today, -182)), dateToISO(today)];
    case "1y":           return [dateToISO(addDays(today, -365)), dateToISO(today)];
    case "quarter": {
      const q = Math.floor(m / 3);
      return [dateToISO(new Date(y, q * 3, 1)), dateToISO(new Date(y, q * 3 + 3, 0))];
    }
    case "last-quarter": {
      const q  = Math.floor(m / 3);
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? y - 1 : y;
      return [dateToISO(new Date(ly, lq * 3, 1)), dateToISO(new Date(ly, lq * 3 + 3, 0))];
    }
    default: return null;
  }
}

function fmtRangeLabel(start, end) {
  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function fmtTrendWeekLabel(sundayISO) {
  const d      = new Date(sundayISO + "T00:00:00");
  const jan1   = new Date(d.getFullYear(), 0, 1);
  const wn     = Math.ceil(((d - jan1) / 86400000 + 1 + jan1.getDay()) / 7);
  return `W${String(wn).padStart(2, "0")} ${d.getFullYear()}`;
}

async function loadTrends() {
  let start, end;
  if (trendsActivePreset === "custom") {
    start = trendsCustomStart;
    end   = trendsCustomEnd;
    if (!start || !end) return;
  } else {
    [start, end] = trendsPresetRange(trendsActivePreset);
  }
  document.getElementById("trends-range-label").textContent = fmtRangeLabel(start, end);
  const res  = await fetch(`/api/analytics/trends?start=${start}&end=${end}`);
  const json = await res.json();
  trendsLastData  = json.data;
  trendsLastWeeks = json.weeks;
  trendsColorMap  = buildColorMap(trendsLastData);
  trendsLastData.forEach(r => { if (!trendsSelectedTasks.has(r.task_name)) trendsSelectedTasks.add(r.task_name); });
  const thisTasks = new Set(trendsLastData.map(r => r.task_name));
  [...trendsSelectedTasks].forEach(n => { if (!thisTasks.has(n)) trendsSelectedTasks.delete(n); });
  buildTaskFilters("trends-task-filters", trendsLastData, trendsSelectedTasks, trendsColorMap,
    renderTrendsFiltered, "trends-select-all", "trends-select-none");
  renderTrendsFiltered();
}

function renderTrendsFiltered() {
  const filtered = trendsLastData.filter(r => trendsSelectedTasks.has(r.task_name));
  renderTrendsChart(filtered, trendsLastWeeks);
  renderTrendsTable(filtered, trendsLastWeeks);
}

function renderTrendsChart(data, weeks) {
  const ctx = document.getElementById("trends-chart").getContext("2d");
  if (trendsChart) trendsChart.destroy();

  const labels = weeks.map(fmtTrendWeekLabel);

  let datasets, type, options;

  if (trendsChartType === "line") {
    datasets = data.map(row => ({
      label: row.task_name,
      data: weeks.map(w => row.weeks[w] ?? 0),
      borderColor: trendsColorMap[row.task_name] ?? CHART_COLORS[0],
      backgroundColor: (trendsColorMap[row.task_name] ?? CHART_COLORS[0]) + "33",
      borderWidth: 2,
      pointRadius: weeks.length > 30 ? 2 : 4,
      pointHoverRadius: 6,
      tension: 0.3,
      fill: false,
    }));
    type = "line";
    options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { color: "#e2e8f0", boxWidth: 12, padding: 16, font: { size: 12 } } },
      },
      scales: {
        x: { ticks: { color: "#8892a4", maxRotation: 45, autoSkip: true, maxTicksLimit: 26 }, grid: { color: "#2e3347" } },
        y: { ticks: { color: "#8892a4" }, grid: { color: "#2e3347" }, title: { display: true, text: "Hours", color: "#8892a4" }, beginAtZero: true },
      },
    };
  } else {
    datasets = data.map(row => ({
      label: row.task_name,
      data: weeks.map(w => row.weeks[w] ?? 0),
      backgroundColor: trendsColorMap[row.task_name] ?? CHART_COLORS[0],
      borderRadius: 2,
      stack: "hours",
    }));
    type = "bar";
    options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { color: "#e2e8f0", boxWidth: 12, padding: 16, font: { size: 12 } } },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#8892a4", maxRotation: 45, autoSkip: true, maxTicksLimit: 26 }, grid: { color: "#2e3347" } },
        y: { stacked: true, ticks: { color: "#8892a4" }, grid: { color: "#2e3347" }, title: { display: true, text: "Hours", color: "#8892a4" } },
      },
    };
  }

  trendsChart = new Chart(ctx, { type, data: { labels, datasets }, options });
}

function renderTrendsTable(data, weeks) {
  const thead = document.getElementById("trends-thead");
  const tbody = document.getElementById("trends-tbody");
  const tfoot = document.getElementById("trends-tfoot");

  if (!weeks.length) {
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td class="muted" style="text-align:center;padding:1rem">No data for this period</td></tr>`;
    tfoot.innerHTML = "";
    return;
  }

  thead.innerHTML = `<tr><th>Task</th>${weeks.map(w => `<th>${fmtTrendWeekLabel(w)}</th>`).join("")}<th>Total</th></tr>`;

  tbody.innerHTML = "";
  data.forEach(row => {
    const total = weeks.reduce((s, w) => s + (row.weeks[w] ?? 0), 0);
    const cells = weeks.map(w => {
      const h = row.weeks[w] ?? 0;
      return `<td class="${h === 0 ? "muted" : ""}">${fmtHours(h)}</td>`;
    }).join("");
    tbody.innerHTML += `<tr><td>${escHtml(row.task_name)}</td>${cells}<td><strong>${fmtHours(total)}</strong></td></tr>`;
  });

  const colTotals = weeks.map(w => data.reduce((s, r) => s + (r.weeks[w] ?? 0), 0));
  const grand     = colTotals.reduce((a, b) => a + b, 0);
  tfoot.innerHTML = `<tr><td>Total</td>${colTotals.map(t => `<td>${fmtHours(t)}</td>`).join("")}<td>${fmtHours(grand)}</td></tr>`;
}

// Range preset buttons
document.querySelectorAll(".range-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    trendsActivePreset = btn.dataset.range;
    const customDiv = document.getElementById("trends-custom-range");
    if (trendsActivePreset === "custom") {
      customDiv.classList.remove("hidden");
    } else {
      customDiv.classList.add("hidden");
      loadTrends();
    }
  });
});

document.getElementById("btn-apply-trends").addEventListener("click", () => {
  trendsCustomStart = document.getElementById("trends-start").value;
  trendsCustomEnd   = document.getElementById("trends-end").value;
  if (!trendsCustomStart || !trendsCustomEnd) return;
  if (trendsCustomEnd < trendsCustomStart) { alert("End date must be after start date."); return; }
  loadTrends();
});

// Chart type toggle
document.querySelectorAll(".chart-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chart-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    trendsChartType = btn.dataset.chartType;
    if (trendsLastData && trendsLastWeeks) renderTrendsFiltered();
  });
});

/* ── Daily goal ───────────────────────────────────────────────────── */

async function loadDailyGoal() {
  try {
    const res  = await fetch("/api/today");
    const data = await res.json();
    const secs = data.seconds || 0;
    const GOAL = 8 * 3600;
    const pct  = Math.min(100, (secs / GOAL) * 100);
    const h    = Math.floor(secs / 3600);
    const m    = Math.floor((secs % 3600) / 60);
    const label = (h > 0 ? `${h}h ` : "") + `${m}m`;
    document.getElementById("daily-goal-text").textContent = label;
    document.getElementById("daily-goal-bar").style.width  = pct + "%";
    document.getElementById("daily-goal").classList.remove("hidden");
  } catch (_) {}
}

loadDailyGoal();

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmtHours(h) {
  if (h === 0) return "—";
  const totalMins = Math.round(h * 60);
  const hrs  = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function autoColonTime(input, e) {
  const isDeleting = e && (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward");
  let val = input.value.replace(/[^0-9:]/g, "");
  if (!isDeleting) {
    if (val.length === 1 && val >= "3")                  val += ":";
    else if (val.length === 2 && !val.includes(":"))     val += ":";
  }
  const parts = val.split(":");
  if (parts.length > 2) val = parts[0] + ":" + parts.slice(1).join("");
  input.value = val;
}

function parseTime(str) {
  const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(s) {
  return String(s).replace(/'/g, "\\'");
}

/* ── Quit ─────────────────────────────────────────────────────────── */

document.getElementById("btn-quit").addEventListener("click", async () => {
  if (!confirm("Close the Time Tracker application?")) return;
  await fetch("/api/quit", { method: "POST" }).catch(() => {});
  window.close();
});

/* ── Startup: session recovery modal ─────────────────────────────── */

(async () => {
  try {
    const res  = await fetch("/api/recovered");
    const data = await res.json();
    if (!data) return;

    const startStr  = parseStoredTime(data.started_at);
    const endDate   = new Date(data.suggested_end);
    const endStr    = endDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    document.getElementById("recovery-modal-msg").textContent =
      `"${data.task_name}" was running since ${startStr}. Save it with end time ${endStr}, edit the end time, or discard it.`;
    document.getElementById("recovery-modal").classList.remove("hidden");

    // Pre-fill the edit field with suggested end time (HH:MM)
    const h = String(endDate.getHours()).padStart(2, "0");
    const m = String(endDate.getMinutes()).padStart(2, "0");
    document.getElementById("recovery-end-time").value = `${h}:${m}`;
    document.getElementById("recovery-end-time").addEventListener("input", e => autoColonTime(e.target, e));

    document.getElementById("btn-recovery-edit").addEventListener("click", () => {
      document.getElementById("recovery-time-edit").classList.toggle("hidden");
    });

    document.getElementById("btn-recovery-save").addEventListener("click", async () => {
      const timeInput = document.getElementById("recovery-end-time").value.trim();
      let endTime = data.suggested_end;
      if (timeInput) {
        const parsed = parseTime(timeInput);
        if (!parsed) { alert("Invalid time format. Use HH:MM."); return; }
        const d = new Date();
        endTime = `${dateToISO(d)}T${parsed}`;
      }
      const r = await fetch("/api/recovered/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ end_time: endTime }),
      });
      if (!r.ok) { alert("Could not save session."); return; }
      document.getElementById("recovery-modal").classList.add("hidden");
      loadDailyGoal();
    });

    document.getElementById("btn-recovery-discard").addEventListener("click", async () => {
      await fetch("/api/recovered/discard", { method: "POST" });
      document.getElementById("recovery-modal").classList.add("hidden");
    });
  } catch (_) {}
})();
