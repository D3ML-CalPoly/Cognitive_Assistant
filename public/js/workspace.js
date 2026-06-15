// Single workspace board: freehand draw/erase, text boxes, images, arrange mode, export.

const state = {
  mode: "draw",
  drawTool: "draw",
  brushColor: "#111827",
  brushSize: 4,
  drawIsDrawing: false,
  drawHistory: [],
  drawHistoryIndex: -1,

  textBoxes: [],
  activeTextId: null,
  textDrag: {
    dragging: false,
    id: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0
  },

  images: [],
  activeImageId: null,
  imageDrag: {
    dragging: false,
    resizing: false,
    id: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    origW: 0,
    origH: 0
  }
};

let els = null;
let initialized = false;

// Tiny helper to keep DOM lookups concise.
function $(id) {
  return document.getElementById(id);
}

function bindEls() {
  els = {
    uniContainer: $("uniContainer"),
    uniCanvas: $("uniCanvas"),
    uniImageLayer: $("uniImageLayer"),
    uniTextLayer: $("uniTextLayer"),

    wsDrawBtn: $("wsDrawBtn"),
    wsEraseBtn: $("wsEraseBtn"),
    wsTextBtn: $("wsTextBtn"),
    wsArrangeBtn: $("wsArrangeBtn"),
    wsClearBtn: $("wsClearBtn"),
    wsColor: $("wsColor"),
    wsSize: $("wsSize"),
    wsSizeValue: $("wsSizeValue"),
    wsUndoBtn: $("wsUndoBtn"),
    wsRedoBtn: $("wsRedoBtn"),
    wsAddTextBtn: $("wsAddTextBtn"),
    wsDeleteTextBtn: $("wsDeleteTextBtn"),
    wsExportBtn: $("wsExportBtn"),
    wsModeLabel: $("wsModeLabel"),

    wsFileInput: $("wsFileInput"),
    wsWebImageUrl: $("wsWebImageUrl"),
    wsWebImageError: $("wsWebImageError"),
    wsAddUrlBtn: $("wsAddUrlBtn"),
    wsDeleteImageBtn: $("wsDeleteImageBtn")
  };
}

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return String(Date.now() + Math.random());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadDataUrl(filename, dataUrl) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

function getPointerPos(event, element) {
  const rect = element.getBoundingClientRect();
  const point = event.touches && event.touches[0] ? event.touches[0] : event;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top
  };
}

function fillCanvasWhite(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function resizeCanvasToContainer(canvas, container, fillWhite) {
  if (!canvas || !container) return;

  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  let previousSnapshot = null;

  try {
    previousSnapshot = canvas.toDataURL("image/png");
  } catch {
    previousSnapshot = null;
  }

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (fillWhite) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  if (!previousSnapshot) return;

  const img = new Image();
  img.onload = function () {
    if (fillWhite) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
  };
  img.src = previousSnapshot;
}

function resizeUnifiedCanvas() {
  if (!els.uniContainer || !els.uniCanvas) return;
  resizeCanvasToContainer(els.uniCanvas, els.uniContainer, false);
}

// -------------------- Draw layer (ink strokes) --------------------
function drawPushHistory() {
  try {
    const data = els.uniCanvas.toDataURL("image/png");
    const next = state.drawHistory.slice(0, state.drawHistoryIndex + 1);
    next.push(data);
    if (next.length > 50) next.shift();
    state.drawHistory = next;
    state.drawHistoryIndex = next.length - 1;
  } catch {
    // ignore
  }
}

function drawRestore(index) {
  const data = state.drawHistory[index];
  if (!data) return;
  const ctx = els.uniCanvas.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  img.onload = function () {
    ctx.clearRect(0, 0, els.uniCanvas.width, els.uniCanvas.height);
    ctx.drawImage(img, 0, 0, els.uniCanvas.width, els.uniCanvas.height);
  };
  img.src = data;
}

function setWorkspaceMode(mode, tool) {
  // `mode` controls which layer is interactive:
  // draw -> canvas, text -> text boxes, objects -> image arrange handles.
  state.mode = mode;
  if (tool) state.drawTool = tool;

  els.wsDrawBtn.classList.toggle("active", state.mode === "draw" && state.drawTool === "draw");
  els.wsEraseBtn.classList.toggle("active", state.mode === "draw" && state.drawTool === "erase");
  els.wsTextBtn.classList.toggle("active", state.mode === "text");
  els.wsArrangeBtn.classList.toggle("active", state.mode === "objects");

  // Canvas only listens while drawing; otherwise hits fall through to layers below.
  els.uniCanvas.style.pointerEvents = state.mode === "draw" ? "auto" : "none";

  // Full-area overlays must not use CSS pointer-events:none on the container — that drops hits to
  // children (text boxes / images). Toggle per mode instead.
  els.uniTextLayer.style.pointerEvents = state.mode === "text" ? "auto" : "none";
  els.uniImageLayer.style.pointerEvents = state.mode === "objects" ? "auto" : "none";

  els.wsModeLabel.textContent = "Mode: " + state.mode;

  renderImages();
  renderTextBoxes();
}

function updateBrushSizeLabel() {
  els.wsSizeValue.textContent = String(state.brushSize) + "px";
}

function drawGetPos(event) {
  return getPointerPos(event, els.uniCanvas);
}

function drawPointerDown(event) {
  if (state.mode !== "draw") return;
  event.preventDefault();
  state.activeTextId = null;
  renderTextBoxes();
  state.drawIsDrawing = true;

  const pos = drawGetPos(event);
  const ctx = els.uniCanvas.getContext("2d");
  if (!ctx) return;

  ctx.beginPath();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = state.brushSize;
  ctx.strokeStyle = state.drawTool === "erase" ? "#ffffff" : state.brushColor;
  ctx.moveTo(pos.x, pos.y);
}

function drawPointerMove(event) {
  if (state.mode !== "draw" || !state.drawIsDrawing) return;
  event.preventDefault();
  const pos = drawGetPos(event);
  const ctx = els.uniCanvas.getContext("2d");
  if (!ctx) return;
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function drawPointerUp(event) {
  if (state.mode !== "draw" || !state.drawIsDrawing) return;
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  state.drawIsDrawing = false;
  const ctx = els.uniCanvas.getContext("2d");
  if (ctx) ctx.closePath();
  drawPushHistory();
}

function drawClear() {
  const ctx = els.uniCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, els.uniCanvas.width, els.uniCanvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, els.uniCanvas.width, els.uniCanvas.height);
  drawPushHistory();
}

function drawUndo() {
  if (state.drawHistoryIndex <= 0) return;
  state.drawHistoryIndex -= 1;
  drawRestore(state.drawHistoryIndex);
}

function drawRedo() {
  if (state.drawHistoryIndex >= state.drawHistory.length - 1) return;
  state.drawHistoryIndex += 1;
  drawRestore(state.drawHistoryIndex);
}

function getTextBox(id) {
  return state.textBoxes.find(function (box) {
    return box.id === id;
  }) || null;
}

function updateTextBox(id, patch, rerender = true) {
  state.textBoxes = state.textBoxes.map(function (box) {
    return box.id === id ? Object.assign({}, box, patch) : box;
  });
  if (rerender) renderTextBoxes();
}

function addTextBox() {
  setWorkspaceMode("text");
  const rect = els.uniContainer.getBoundingClientRect();
  const id = uid();

  state.textBoxes.push({
    id: id,
    x: Math.max(16, rect.width * 0.1),
    y: Math.max(16, rect.height * 0.1),
    w: Math.min(320, Math.max(180, rect.width - 32)),
    h: 120,
    text: "Type here...",
    fontSize: 18,
    hasTyped: false,
    hideBorder: false
  });

  state.activeTextId = id;
  renderTextBoxes();
}

function deleteActiveTextBox() {
  if (!state.activeTextId) return;
  state.textBoxes = state.textBoxes.filter(function (box) {
    return box.id !== state.activeTextId;
  });
  state.activeTextId = null;
  renderTextBoxes();
}

function focusEditableTextBox(id) {
  const node = els.uniTextLayer.querySelector('[data-text-edit-id="' + id + '"]');
  if (!node) return;
  node.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function renderTextBoxes() {
  // Render editable/draggable text boxes on the top-most layer.
  els.wsDeleteTextBtn.disabled = !state.activeTextId;
  els.uniTextLayer.innerHTML = "";
  const interactive = state.mode === "text";

  state.textBoxes.forEach(function (box) {
    const active = box.id === state.activeTextId;
    const root = document.createElement("div");
    root.className = "text-box" + (active ? " active" : "") + (box.hideBorder ? " no-border" : "");
    root.style.left = box.x + "px";
    root.style.top = box.y + "px";
    root.style.width = box.w + "px";
    root.style.height = box.h + "px";
    root.style.pointerEvents = interactive ? "auto" : "none";
    root.dataset.id = box.id;

    const inner = document.createElement("div");
    inner.className = "text-box-inner";

    if (active && interactive) {
      const drag = document.createElement("div");
      drag.className = "drag-handle";
      drag.dataset.dragHandle = "1";
      drag.title = "Drag to move";
      drag.textContent = "Drag";
      inner.appendChild(drag);
    }

    const editable = document.createElement("div");
    editable.className = "editable";
    editable.dataset.textEditId = box.id;
    editable.style.fontSize = box.fontSize + "px";
    editable.style.height = active && interactive ? "calc(100% - 28px)" : "100%";
    editable.contentEditable = interactive ? "true" : "false";
    editable.spellcheck = false;
    editable.innerHTML = escapeHtml(box.text).replace(/\n/g, "<br>");

    editable.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });

    editable.addEventListener("focus", function () {
      state.activeTextId = box.id;
      renderTextBoxes();
    });

    editable.addEventListener("input", function (event) {
      const value = event.currentTarget.innerText || "";
      updateTextBox(
        box.id,
        {
          text: value,
          hasTyped: true,
          hideBorder: false
        },
        false
      );
    });

    editable.addEventListener("blur", function (event) {
      updateTextBox(box.id, {
        text: event.currentTarget.innerText || "",
        hasTyped: true,
        hideBorder: true
      });
    });

    root.addEventListener("mousedown", function (event) {
      if (!interactive) return;
      event.stopPropagation();
      state.activeTextId = box.id;

      const handle = event.target.closest('[data-drag-handle="1"]');
      if (!handle) {
        renderTextBoxes();
        return;
      }

      event.preventDefault();
      state.textDrag = {
        dragging: true,
        id: box.id,
        startX: event.clientX,
        startY: event.clientY,
        origX: box.x,
        origY: box.y
      };
      renderTextBoxes();
    });

    inner.appendChild(editable);
    root.appendChild(inner);

    if (active && interactive) {
      const badge = document.createElement("div");
      badge.className = "text-badge";
      badge.textContent = "T";
      root.appendChild(badge);
    }

    els.uniTextLayer.appendChild(root);
  });
}

function uniContainerMouseMove(event) {
  if (state.textDrag.dragging) {
    const rect = els.uniContainer.getBoundingClientRect();
    const drag = state.textDrag;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const box = getTextBox(drag.id);
    if (!box) return;

    updateTextBox(drag.id, {
      x: Math.min(Math.max(0, drag.origX + dx), Math.max(0, rect.width - box.w)),
      y: Math.min(Math.max(0, drag.origY + dy), Math.max(0, rect.height - box.h))
    });
    return;
  }

  if (state.mode !== "objects") return;
  const drag = state.imageDrag;
  if (!drag.dragging && !drag.resizing) return;

  const rect = els.uniContainer.getBoundingClientRect();
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const obj = state.images.find(function (item) {
    return item.id === drag.id;
  });
  if (!obj) return;

  if (drag.dragging) {
    updateImage(drag.id, {
      x: Math.min(Math.max(0, drag.origX + dx), Math.max(0, rect.width - obj.w)),
      y: Math.min(Math.max(0, drag.origY + dy), Math.max(0, rect.height - obj.h))
    });
    return;
  }

  if (drag.resizing) {
    updateImage(drag.id, {
      w: Math.min(Math.max(80, drag.origW + dx), Math.max(80, rect.width - drag.origX)),
      h: Math.min(Math.max(60, drag.origH + dy), Math.max(60, rect.height - drag.origY))
    });
  }
}

function uniContainerMouseUp() {
  state.textDrag.dragging = false;
  state.imageDrag.dragging = false;
  state.imageDrag.resizing = false;
}

function renderWrappedText(ctx, text, x, y, w, h, fontSize) {
  const raw = String(text || "").split("\n").join(" \\n ");
  const parts = raw.split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (let i = 0; i < parts.length; i += 1) {
    const word = parts[i];
    if (word === "\\n") {
      lines.push(line.trimEnd());
      line = "";
      continue;
    }

    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width <= w) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);

  const lineHeight = Math.round(fontSize * 1.25);
  let yy = y;
  for (let i = 0; i < lines.length; i += 1) {
    if (yy + lineHeight > y + h) break;
    ctx.fillText(lines[i], x, yy);
    yy += lineHeight;
  }
}

async function unifiedExportPNG() {
  // Composite export order:
  // white background -> placed images -> drawing canvas -> text boxes.
  const out = document.createElement("canvas");
  out.width = els.uniCanvas.width;
  out.height = els.uniCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("failed"));
      };
      img.src = src;
    });
  }

  for (let i = 0; i < state.images.length; i += 1) {
    const item = state.images[i];
    try {
      const img = await loadImage(item.src);
      ctx.drawImage(img, item.x, item.y, item.w, item.h);
    } catch {
      ctx.save();
      ctx.fillStyle = "rgba(239,68,68,0.10)";
      ctx.strokeStyle = "rgba(239,68,68,0.35)";
      ctx.lineWidth = 2;
      ctx.fillRect(item.x, item.y, item.w, item.h);
      ctx.strokeRect(item.x, item.y, item.w, item.h);
      ctx.fillStyle = "rgba(239,68,68,0.90)";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText("Image blocked (CORS)", item.x + 10, item.y + 18);
      ctx.restore();
    }
  }

  ctx.drawImage(els.uniCanvas, 0, 0);

  state.textBoxes.forEach(function (box) {
    const fontSize = box.fontSize || 18;
    ctx.save();
    ctx.fillStyle = "#111827";
    ctx.font =
      fontSize + "px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
    ctx.textBaseline = "top";
    renderWrappedText(
      ctx,
      box.text,
      box.x + 10,
      box.y + 10,
      Math.max(20, box.w - 20),
      Math.max(20, box.h - 20),
      fontSize
    );
    ctx.restore();
  });

  downloadDataUrl("workspace.png", out.toDataURL("image/png"));
}

function updateImage(id, patch) {
  state.images = state.images.map(function (img) {
    return img.id === id ? Object.assign({}, img, patch) : img;
  });
  renderImages();
}

function renderImages() {
  // Render movable/resizable image objects on the image layer.
  const interactive = state.mode === "objects";
  els.wsDeleteImageBtn.disabled = !state.activeImageId;
  els.uniImageLayer.innerHTML = "";

  state.images.forEach(function (imgObj) {
    const active = imgObj.id === state.activeImageId;
    const root = document.createElement("div");
    root.className = "image-object" + (active ? " active" : "");
    root.style.left = imgObj.x + "px";
    root.style.top = imgObj.y + "px";
    root.style.width = imgObj.w + "px";
    root.style.height = imgObj.h + "px";
    root.style.pointerEvents = interactive ? "auto" : "none";
    root.title = imgObj.name || "Image";
    root.dataset.id = imgObj.id;

    const image = document.createElement("img");
    image.src = imgObj.src;
    image.alt = "workspace image";
    image.draggable = false;
    image.crossOrigin = "anonymous";
    root.appendChild(image);

    if (active && interactive) {
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      handle.dataset.resizeHandle = "1";
      handle.title = "Resize";
      root.appendChild(handle);
    }

    root.addEventListener("mousedown", function (event) {
      if (!interactive) return;
      const resizeHandle = event.target.closest('[data-resize-handle="1"]');
      event.stopPropagation();
      event.preventDefault();
      state.activeImageId = imgObj.id;
      state.imageDrag = {
        dragging: !resizeHandle,
        resizing: !!resizeHandle,
        id: imgObj.id,
        startX: event.clientX,
        startY: event.clientY,
        origX: imgObj.x,
        origY: imgObj.y,
        origW: imgObj.w,
        origH: imgObj.h
      };
      renderImages();
    });

    els.uniImageLayer.appendChild(root);
  });
}

function deleteActiveImage() {
  if (!state.activeImageId) return;
  state.images = state.images.filter(function (img) {
    return img.id !== state.activeImageId;
  });
  state.activeImageId = null;
  renderImages();
}

function addImageFromFile(file) {
  const rect = els.uniContainer.getBoundingClientRect();
  const reader = new FileReader();

  reader.onload = function (event) {
    state.images.push({
      id: uid(),
      src: String(event.target && event.target.result ? event.target.result : ""),
      name: file.name,
      x: Math.max(16, rect.width * 0.1),
      y: Math.max(16, rect.height * 0.1),
      w: Math.min(320, Math.max(160, rect.width * 0.35)),
      h: Math.min(240, Math.max(120, rect.height * 0.25))
    });

    setWorkspaceMode("objects");
    renderImages();
  };

  reader.readAsDataURL(file);
}

function showWebImageError(message) {
  els.wsWebImageError.textContent = message || "";
  els.wsWebImageError.classList.toggle("hidden", !message);
}

function addImageFromUrl() {
  const url = els.wsWebImageUrl.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    showWebImageError("Please paste a full http(s) image URL.");
    return;
  }

  showWebImageError("");
  const rect = els.uniContainer.getBoundingClientRect();
  const id = uid();

  state.images.push({
    id: id,
    src: url,
    name: "Web image",
    x: Math.max(16, rect.width * 0.1),
    y: Math.max(16, rect.height * 0.1),
    w: Math.min(360, Math.max(160, rect.width * 0.4)),
    h: Math.min(260, Math.max(120, rect.height * 0.28))
  });

  state.activeImageId = id;
  els.wsWebImageUrl.value = "";
  setWorkspaceMode("objects");
  renderImages();
}

function bindWorkspaceEvents() {
  // All sidebar controls and pointer handlers are wired here.
  els.wsDrawBtn.addEventListener("click", function () {
    setWorkspaceMode("draw", "draw");
  });

  els.wsEraseBtn.addEventListener("click", function () {
    setWorkspaceMode("draw", "erase");
  });

  els.wsTextBtn.addEventListener("click", function () {
    setWorkspaceMode("text");
  });

  els.wsArrangeBtn.addEventListener("click", function () {
    setWorkspaceMode("objects");
  });

  els.wsClearBtn.addEventListener("click", drawClear);
  els.wsUndoBtn.addEventListener("click", drawUndo);
  els.wsRedoBtn.addEventListener("click", drawRedo);
  els.wsDeleteTextBtn.addEventListener("click", deleteActiveTextBox);
  els.wsExportBtn.addEventListener("click", function () {
    unifiedExportPNG();
  });

  els.wsAddTextBtn.addEventListener("click", function () {
    addTextBox();
    requestAnimationFrame(function () {
      if (state.activeTextId) focusEditableTextBox(state.activeTextId);
    });
  });

  els.wsColor.addEventListener("input", function (event) {
    state.brushColor = event.target.value;
  });

  els.wsSize.addEventListener("input", function (event) {
    state.brushSize = Number(event.target.value);
    updateBrushSizeLabel();
  });

  els.uniCanvas.addEventListener("mousedown", drawPointerDown);
  els.uniCanvas.addEventListener("mousemove", drawPointerMove);
  els.uniCanvas.addEventListener("mouseup", drawPointerUp);
  els.uniCanvas.addEventListener("mouseleave", drawPointerUp);
  els.uniCanvas.addEventListener("touchstart", drawPointerDown, { passive: false });
  els.uniCanvas.addEventListener("touchmove", drawPointerMove, { passive: false });
  els.uniCanvas.addEventListener("touchend", drawPointerUp, { passive: false });

  els.uniContainer.addEventListener("mousemove", uniContainerMouseMove);
  els.uniContainer.addEventListener("mouseup", uniContainerMouseUp);
  els.uniContainer.addEventListener("mouseleave", uniContainerMouseUp);

  els.uniContainer.addEventListener("mousedown", function () {
    state.activeTextId = null;
    renderTextBoxes();
  });

  window.addEventListener("mouseup", uniContainerMouseUp);

  els.wsFileInput.addEventListener("change", function (event) {
    const file = event.target.files && event.target.files[0];
    if (file) addImageFromFile(file);
    event.target.value = "";
  });

  els.wsAddUrlBtn.addEventListener("click", addImageFromUrl);
  els.wsWebImageUrl.addEventListener("input", function () {
    showWebImageError("");
  });
  els.wsWebImageUrl.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addImageFromUrl();
    }
  });

  els.wsDeleteImageBtn.addEventListener("click", deleteActiveImage);
}

function bindResizeEvents() {
  window.addEventListener("resize", function () {
    resizeUnifiedCanvas();
    renderTextBoxes();
    renderImages();
  });
}

export function initWorkspace() {
  if (initialized) return;

  bindEls();
  if (!els.uniContainer || !els.uniCanvas) return;

  initialized = true;

  bindWorkspaceEvents();
  bindResizeEvents();

  updateBrushSizeLabel();
  setWorkspaceMode("draw", "draw");
  renderTextBoxes();
  renderImages();

  requestAnimationFrame(function () {
    // First frame setup: fit canvas to container and seed initial undo history.
    resizeUnifiedCanvas();
    fillCanvasWhite(els.uniCanvas);
    drawPushHistory();
  });
}

export function refreshWorkspaceCanvas() {
  if (!initialized) return;

  requestAnimationFrame(function () {
    resizeUnifiedCanvas();
    renderTextBoxes();
    renderImages();
  });
}
