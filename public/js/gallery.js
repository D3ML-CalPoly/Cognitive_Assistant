import { api, initTopbar, withCacheBust } from "/js/common.js";

const statusEl = document.getElementById("status");
const gridEl = document.getElementById("grid");

function setStatus(t) { statusEl.textContent = t || ""; }

function formatTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function renderItem(row, prepend = false) {
  // One gallery card = uploaded image + timestamp metadata.
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

  if (prepend) gridEl.prepend(card);
  else gridEl.appendChild(card);
}

async function load() {
  // Initial gallery load (newest first from backend).
  setStatus("Loading...");
  const data = await api("/api/my-uploads", "GET");
  gridEl.innerHTML = "";
  for (const row of data.uploads) renderItem(row);
  setStatus(`Loaded ${data.uploads.length} uploads.`);
}

(async function init() {
  await initTopbar({ requireAuth: true });

  try {
    await load();

    // Live updates: when a new upload arrives for this user,
    // prepend it to the top of the gallery in real time.
    const evtSource = new EventSource("/api/stream/user");
    evtSource.addEventListener("image", (evt) => {
      const row = JSON.parse(evt.data);
      renderItem({ public_url: row.publicUrl, created_at: row.createdAt }, true);
    });
  } catch (e) {
    setStatus(e.message);
    window.location.href = "/html/login.html";
  }
})();