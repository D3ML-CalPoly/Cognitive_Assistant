const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session");

const statusDiv = document.getElementById("uploadStatus");
const form = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const previewImg = document.getElementById("previewImg");

function setStatus(t) { statusDiv.textContent = t || ""; }

if (!sessionId) {
  // Upload page must be opened via QR/link containing ?session=...
  setStatus("Missing session id. Re-scan the QR code.");
  form.style.display = "none";
} else {
  setStatus("Choose an image and upload.");
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  previewImg.src = URL.createObjectURL(f);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = fileInput.files?.[0];
  if (!file) return setStatus("Pick a file first.");

  setStatus("Uploading...");

  const fd = new FormData();
  fd.append("image", file);

  try {
    // Send selected image to backend endpoint tied to current session.
    const resp = await fetch(`/api/upload/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: fd
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return setStatus(data.error || "Upload failed.");

    setStatus("Upload complete. You can close this page.");
  } catch {
    setStatus("Upload failed (network/server error).");
  }
});
