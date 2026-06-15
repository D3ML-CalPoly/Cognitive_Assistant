import { api, getAppConfig } from "/js/common.js";

// Keep short shared context to avoid very long prompts and responses.
const MAX_HISTORY = 20;
const SHARED_HISTORY_KEY = "chatHistory_shared";
const DEFAULT_WELCOME = "Hi! I am a creative idea coach. Ask me anything about your project ideas.";

// Resolved from config.json (aiChat.welcomeMessage) on first widget render.
let welcomeMessage = DEFAULT_WELCOME;

function cleanReplyText(reply) {
  return String(reply || "").replace(/\*\*/g, "").replace(/\|/g, "").trim();
}

function loadHistoryFor(key) {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistoryFor(key, history) {
  try { sessionStorage.setItem(key, JSON.stringify(history)); } catch { /* ignore */ }
}

export function initChatWidget({
  formId,
  inputId,
  sendBtnId,
  messagesId,
  clearBtnId,
  historyKey
}) {
  // Legacy single-widget initializer (kept for reuse if needed elsewhere).
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  const sendBtn = document.getElementById(sendBtnId);
  const messagesEl = document.getElementById(messagesId);
  const clearBtn = document.getElementById(clearBtnId);

  if (!form || !input || !messagesEl) return;

  let history = loadHistoryFor(historyKey);

  function renderAll() {
    messagesEl.innerHTML = "";
    if (history.length === 0) {
      const hint = document.createElement("div");
      hint.className = "chatMsg model";
      hint.textContent = welcomeMessage;
      messagesEl.appendChild(hint);
      return;
    }
    for (const msg of history) addMessageEl(msg.role, msg.text);
  }

  function addMessageEl(role, text, extraClass) {
    const div = document.createElement("div");
    div.className = "chatMsg " + role + (extraClass ? " " + extraClass : "");
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function send(message) {
    const trimmed = message.trim();
    if (!trimmed) return;

    input.value = "";
    sendBtn.disabled = true;
    input.disabled = true;

    addMessageEl("user", trimmed);

    const thinking = addMessageEl("model", "Thinking...", "typing");

    const historyForApi = history.slice(-MAX_HISTORY);

    try {
      const data = await api("/api/chat", "POST", {
        message: trimmed,
        history: historyForApi
      });

      thinking.remove();

      const reply = cleanReplyText(data?.reply) || "(no response)";
      addMessageEl("model", reply);

      history.push({ role: "user", text: trimmed });
      history.push({ role: "model", text: reply });
      if (history.length > MAX_HISTORY * 2) {
        history = history.slice(-MAX_HISTORY * 2);
      }
      saveHistoryFor(historyKey, history);
    } catch (e) {
      thinking.remove();
      addMessageEl("model", e?.message || "Chat failed.", "error");
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (evt) => {
    evt.preventDefault();
    send(input.value);
  });

  clearBtn?.addEventListener("click", () => {
    history = [];
    saveHistoryFor(historyKey, history);
    renderAll();
    input.focus();
  });

  renderAll();
}

export function initChat() {
  // Two visible chat panels (QR + Workspace) share one history and one send pipeline.
  const widgets = [
    {
      form: document.getElementById("chatForm"),
      input: document.getElementById("chatInput"),
      sendBtn: document.getElementById("chatSendBtn"),
      messagesEl: document.getElementById("chatMessages"),
      clearBtn: document.getElementById("chatClearBtn")
    },
    {
      form: document.getElementById("workspaceChatForm"),
      input: document.getElementById("workspaceChatInput"),
      sendBtn: document.getElementById("workspaceChatSendBtn"),
      messagesEl: document.getElementById("workspaceChatMessages"),
      clearBtn: document.getElementById("workspaceChatClearBtn")
    }
  ].filter((w) => w.form && w.input && w.messagesEl);

  if (widgets.length === 0) return;

  let history = loadHistoryFor(SHARED_HISTORY_KEY);
  let inFlight = false;

  function setBusy(isBusy) {
    // Lock both UIs during an in-flight request to avoid duplicate sends.
    inFlight = isBusy;
    for (const w of widgets) {
      if (w.sendBtn) w.sendBtn.disabled = isBusy;
      w.input.disabled = isBusy;
    }
  }

  function addMessageTo(el, role, text, extraClass) {
    const div = document.createElement("div");
    div.className = "chatMsg " + role + (extraClass ? " " + extraClass : "");
    div.textContent = text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function renderAll() {
    for (const w of widgets) {
      w.messagesEl.innerHTML = "";
      if (history.length === 0) {
        addMessageTo(w.messagesEl, "model", welcomeMessage);
        continue;
      }
      for (const msg of history) {
        addMessageTo(w.messagesEl, msg.role, msg.text);
      }
    }
  }

  function appendToAll(role, text, extraClass) {
    const nodes = [];
    for (const w of widgets) nodes.push(addMessageTo(w.messagesEl, role, text, extraClass));
    return nodes;
  }

  async function sendFrom(widget) {
    if (inFlight) return;
    const trimmed = widget.input.value.trim();
    if (!trimmed) return;

    for (const w of widgets) w.input.value = "";
    setBusy(true);

    appendToAll("user", trimmed);
    const thinkingNodes = appendToAll("model", "Thinking...", "typing");

    const historyForApi = history.slice(-MAX_HISTORY);

    try {
      const data = await api("/api/chat", "POST", {
        message: trimmed,
        history: historyForApi
      });

      const reply = cleanReplyText(data?.reply) || "(no response)";

      for (const node of thinkingNodes) node.remove();
      appendToAll("model", reply);

      history.push({ role: "user", text: trimmed });
      history.push({ role: "model", text: reply });
      if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);
      saveHistoryFor(SHARED_HISTORY_KEY, history);
    } catch (e) {
      for (const node of thinkingNodes) node.remove();
      appendToAll("model", e?.message || "Chat failed.", "error");
    } finally {
      setBusy(false);
      widget.input.focus();
    }
  }

  for (const w of widgets) {
    w.form.addEventListener("submit", (evt) => {
      evt.preventDefault();
      sendFrom(w);
    });

    w.clearBtn?.addEventListener("click", () => {
      history = [];
      saveHistoryFor(SHARED_HISTORY_KEY, history);
      renderAll();
      w.input.focus();
    });
  }

  renderAll();

  // Pull the configurable welcome message from /api/config and re-render the
  // empty-state hint if it changed. Done after first paint so chat shows up
  // immediately even if the config request is slow.
  getAppConfig().then((cfg) => {
    const next = cfg?.aiChat?.welcomeMessage;
    if (next && next !== welcomeMessage) {
      welcomeMessage = next;
      if (history.length === 0) renderAll();
    }
  });
}
