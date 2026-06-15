export async function api(path, method = "GET", body) {
  // Small fetch wrapper used by all pages: JSON in/out + consistent errors.
  const resp = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Cached fetch of the editable runtime config (config.json on the server).
// Backed by /api/config which re-reads the file on every request.
let _appConfigPromise = null;
export function getAppConfig() {
  if (!_appConfigPromise) {
    _appConfigPromise = api("/api/config", "GET").catch(() => ({}));
  }
  return _appConfigPromise;
}

/** For `<img src>` reloads so the browser does not show a stale cached image. */
export function withCacheBust(url) {
  if (!url) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

/** Drop one search param from the address bar without reloading; keeps other params and the hash. */
export function removeCurrentUrlSearchParam(name) {
  const u = new URL(window.location.href);
  if (!u.searchParams.has(name)) return;
  u.searchParams.delete(name);
  history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
}

const CONSENT_KEY = "consentAccepted";
const TUTORIAL_KEY = "tutorialCompleted";

export function clearFlowFlags() {
  sessionStorage.removeItem(CONSENT_KEY);
  sessionStorage.removeItem(TUTORIAL_KEY);
}

export function hasConsent() {
  return sessionStorage.getItem(CONSENT_KEY) === "1";
}
export function setConsent() {
  sessionStorage.setItem(CONSENT_KEY, "1");
}

export function hasTutorial() {
  return sessionStorage.getItem(TUTORIAL_KEY) === "1";
}
export function setTutorial() {
  sessionStorage.setItem(TUTORIAL_KEY, "1");
}

export async function initTopbar({ requireAuth = false } = {}) {
  // Shared topbar behavior: show user/login/logout state on every page.
  const userLabel = document.getElementById("userLabel");
  const loginLink = document.getElementById("loginLink");
  const logoutBtn = document.getElementById("logoutBtn");

  let me = { user: null };
  try {
    me = await api("/api/me", "GET");
  } catch {
    me = { user: null };
  }

  const user = me.user;

  if (user) {
    userLabel.textContent = user.username ? `ID: ${user.username}` : "Logged in";
    loginLink.style.display = "none";
    logoutBtn.style.display = "inline-block";
  } else {
    userLabel.textContent = "";
    loginLink.style.display = "inline-block";
    logoutBtn.style.display = "none";
  }

  logoutBtn?.addEventListener("click", async () => {
    try {
      await api("/api/logout", "POST");
    } finally {
      // Logging out resets this flow state for future sessions.
      clearFlowFlags();
      window.location.href = "/html/login.html";
    }
  });

  if (requireAuth && !user) {
    window.location.href = "/html/login.html";
    return { user: null };
  }

  return { user };
}