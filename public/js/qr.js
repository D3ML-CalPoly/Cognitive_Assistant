import {
  api,
  initTopbar,
  hasConsent,
  hasTutorial,
  removeCurrentUrlSearchParam,
  setTutorial,
  withCacheBust
} from "/js/common.js";
import { initCountdownTimer } from "/js/timer.js";
import { initJoyrideTour } from "/js/joyrideTour.js";
import { initWorkspace, refreshWorkspaceCanvas } from "/js/workspace.js";
import { initChat } from "/js/chat.js";

const qrDiv = document.getElementById("qr");
const statusEl = document.getElementById("status");
const resultImg = document.getElementById("resultImg");
const recentUploadsStatusEl = document.getElementById("recentUploadsStatus");
const recentUploadsGridEl = document.getElementById("recentUploadsGrid");

const qrView = document.getElementById("qrView");
const workspaceView = document.getElementById("workspaceView");
const showQrViewBtn = document.getElementById("showQrViewBtn");
const showWorkspaceViewBtn = document.getElementById("showWorkspaceViewBtn");

let evtSource = null;
let timerCtrl = null;
let workspaceReady = false;
let currentUploadUrl = "";

function openCurrentUploadUrl() {
  if (!currentUploadUrl) return;
  window.open(currentUploadUrl, "_blank", "noopener");
}

qrDiv?.addEventListener("click", openCurrentUploadUrl);
qrDiv?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openCurrentUploadUrl();
  }
});

function setStatus(message) {
  statusEl.textContent = message || "";
}

function setRecentUploadsStatus(message) {
  if (!recentUploadsStatusEl) return;
  recentUploadsStatusEl.textContent = message || "";
}

function clearQrDisplay() {
  qrDiv.innerHTML = "";
  currentUploadUrl = "";
}

function setImage(url) {
  if (!url) return;
  resultImg.src = withCacheBust(url);
}

function closeEventStream() {
  if (!evtSource) return;
  evtSource.close();
  evtSource = null;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function renderRecentUploadItem(row, prepend = false) {
  if (!recentUploadsGridEl || !row?.public_url) return;

  const card = document.createElement("div");
  card.className = "tile";

  const img = document.createElement("img");
  img.src = withCacheBust(row.public_url);
  img.alt = "upload";

  const meta = document.createElement("div");
  meta.className = "tileMeta";
  meta.textContent = formatTime(row.created_at);

  card.appendChild(img);
  card.appendChild(meta);

  if (prepend) {
    recentUploadsGridEl.prepend(card);
  } else {
    recentUploadsGridEl.appendChild(card);
  }
}

async function loadRecentUploads() {
  // Reuse gallery endpoint and show a compact list on the QR page.
  if (!recentUploadsGridEl) return;
  setRecentUploadsStatus("Loading recent uploads...");
  recentUploadsGridEl.innerHTML = "";

  try {
    const data = await api("/api/my-uploads", "GET");
    const uploads = Array.isArray(data.uploads) ? data.uploads : [];
    const recent = uploads.slice(0, 6);

    for (const row of recent) renderRecentUploadItem(row);

    if (recent.length === 0) {
      setRecentUploadsStatus("No uploads yet.");
    } else {
      setRecentUploadsStatus(`Showing ${recent.length} recent upload${recent.length === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    setRecentUploadsStatus(error instanceof Error ? error.message : "Failed to load recent uploads.");
  }
}

function setSwitchState(activeView) {
  const qrActive = activeView === "qr";
  showQrViewBtn?.classList.toggle("active", qrActive);
  showQrViewBtn?.classList.toggle("secondary", !qrActive);
  showWorkspaceViewBtn?.classList.toggle("active", !qrActive);
  showWorkspaceViewBtn?.classList.toggle("secondary", qrActive);
}

function showQr() {
  qrView?.classList.remove("hidden");
  workspaceView?.classList.add("hidden");
  setSwitchState("qr");
}

function showWorkspace() {
  if (!workspaceView) return;
  qrView?.classList.add("hidden");
  workspaceView.classList.remove("hidden");
  setSwitchState("workspace");

  if (!workspaceReady) {
    // Workspace initializes lazily to keep first QR view fast.
    initWorkspace();
    workspaceReady = true;
  }

  refreshWorkspaceCanvas();
}

async function createSessionQr() {
  // Create a new upload session and open an SSE stream for live image updates.
  clearQrDisplay();
  resultImg.removeAttribute("src");
  setStatus("Creating session...");

  try {
    const data = await api("/api/session", "GET");
    const sessionId = data.sessionId;

    new globalThis.QRCode(qrDiv, {
      text: data.uploadUrl,
      width: 220,
      height: 220
    });

    currentUploadUrl = data.uploadUrl;
    setStatus("Scan the QR code on your phone and upload an image.");

    closeEventStream();
    evtSource = new EventSource(`/api/stream/session/${encodeURIComponent(sessionId)}`);

    evtSource.addEventListener("image", (event) => {
      const message = JSON.parse(event.data);
      setImage(message.publicUrl);
      setStatus("Image received.");
      renderRecentUploadItem(
        { public_url: message.publicUrl, created_at: new Date().toISOString() },
        true
      );
    });

    evtSource.addEventListener("error", () => {
      setStatus("Live updates disconnected. Reload if you need to reconnect.");
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to create a QR session.");
  }
}

async function init() {
  // Main page bootstrap: auth/checks -> timer/tour -> view handlers -> auto QR.
  await initTopbar({ requireAuth: true });

  if (!hasConsent()) {
    window.location.href = "/html/consent.html";
    return;
  }

  timerCtrl = await initCountdownTimer();

  const url = new URL(window.location.href);
  const forcedTour = url.searchParams.get("tour") === "1";
  const autoStartTour = forcedTour || !hasTutorial();

  initJoyrideTour({
    autoStart: autoStartTour,
    getTimerCtrl: () => timerCtrl,
    onComplete: () => {
      setTutorial();
      removeCurrentUrlSearchParam("tour");
    }
  });

  showQrViewBtn?.addEventListener("click", showQr);
  showWorkspaceViewBtn?.addEventListener("click", showWorkspace);
  window.addEventListener("beforeunload", closeEventStream);

  showQr();
  await loadRecentUploads();
  await createSessionQr();
  initChat();
}

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Initialization failed.");
});
