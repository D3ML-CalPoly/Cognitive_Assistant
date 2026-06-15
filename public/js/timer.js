import { api, clearFlowFlags, getAppConfig } from "/js/common.js";

// Persist countdown in sessionStorage so refresh/tab switches keep timing.
const STORAGE_KEY = "qrCountdownState_v4";
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

// Lazily resolved from /api/config (config.json -> timer.durationMinutes).
// Falls back to 30 minutes if the config can't be read.
let _durationMs = DEFAULT_DURATION_MS;

async function loadDurationMs() {
  try {
    const cfg = await getAppConfig();
    const minutes = Number(cfg?.timer?.durationMinutes);
    if (Number.isFinite(minutes) && minutes > 0) {
      _durationMs = Math.round(minutes * 60 * 1000);
    }
  } catch { /* keep default */ }
  return _durationMs;
}

function now() { return Date.now(); }
function pad2(n) { return String(n).padStart(2, "0"); }
function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${pad2(mm)}:${pad2(ss)}`;
}

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function newState() {
  return { running: true, deadline: now() + _durationMs, remaining_ms: _durationMs };
}

async function endToEndingScreen() {
  // End of session: logout server-side, clear local flow, then route to ending page.
  try { await api("/api/logout", "POST"); } catch {}
  clearFlowFlags();
  sessionStorage.removeItem(STORAGE_KEY);
  window.location.href = "/html/ending.html";
}

export async function initCountdownTimer() {
  const timerText = document.getElementById("timerText");
  const pauseBtn = document.getElementById("pauseBtn");
  const endBtn = document.getElementById("endBtn");

  if (!timerText || !pauseBtn || !endBtn) return null;

  // Resolve duration from config before creating a fresh state. If a saved
  // state already exists, we keep its deadline so refreshes don't reset.
  await loadDurationMs();

  let state = loadState() || newState();
  saveState(state);

  function remainingMs() {
    // When running, derive from deadline; when paused, use frozen remainder.
    return state.running ? (state.deadline - now()) : state.remaining_ms;
  }

  function setButtons() {
    pauseBtn.textContent = state.running ? "Pause" : "Resume";
  }

  function render() {
    const rem = remainingMs();
    timerText.textContent = fmt(rem);
    if (rem <= 0) endToEndingScreen();
  }

  function pause() {
    if (!state.running) return;
    state.remaining_ms = Math.max(0, state.deadline - now());
    state.running = false;
    saveState(state);
    setButtons();
    render();
  }

  function resume() {
    if (state.running) return;
    state.running = true;
    state.deadline = now() + Math.max(0, state.remaining_ms);
    saveState(state);
    setButtons();
    render();
  }

  function isRunning() {
    return !!state.running;
  }

  function togglePause() {
    if (state.running) pause();
    else resume();
  }

  function end() {
    // Manual "End" mirrors natural timer completion behavior.
    endToEndingScreen();
  }

  pauseBtn.addEventListener("click", togglePause);
  endBtn.addEventListener("click", end);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => sessionStorage.removeItem(STORAGE_KEY));

  setButtons();
  render();

  const interval = setInterval(render, 250);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

  return { pause, resume, end, isRunning, stop: () => clearInterval(interval) };
}