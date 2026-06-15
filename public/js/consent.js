import { initTopbar, setConsent, getAppConfig } from "/js/common.js";

// Local backup record of consent form details (browser-side only).
const STORAGE_KEY = "study_consent_v1";

const els = {
  title: document.getElementById("consentTitle"),
  subtitle: document.getElementById("consentSubtitle"),
  intro: document.getElementById("consentIntro"),
  bullets: document.getElementById("consentBullets"),
  extra: document.getElementById("consentExtra"),
  participantIdLabel: document.getElementById("participantIdLabel"),
  participantId: document.getElementById("participantId"),
  agreeLabel: document.getElementById("consentAgreeLabel"),
  agreeCheckbox: document.getElementById("agreeCheckbox"),
  consentError: document.getElementById("consentError"),
  consentDate: document.getElementById("consentDate"),
  startBtn: document.getElementById("startBtn"),
  devSkipBtn: document.getElementById("devSkipBtn")
};

// Defaults mirror the original copy so the page is still usable if config
// fails to load.
let consentText = {
  errorMissingAgreement: "Please check the consent agreement box."
};

function showConsentError(message) {
  els.consentError.textContent = message || "";
  els.consentError.classList.toggle("hidden", !message);
}

function saveConsentRecord(record) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* ignore */ }
}

function goNext() {
  // Session flag is what app flow checks before allowing the QR page.
  setConsent();
  window.location.href = "/html/qr.html?tour=1";
}

function submitConsent() {
  const participantId = els.participantId.value.trim();
  const agree = els.agreeCheckbox.checked;

  if (!agree) {
    showConsentError(consentText.errorMissingAgreement);
    return;
  }

  showConsentError("");

  const record = {
    participantId,
    agreedAt: new Date().toISOString()
  };

  // Keep a local copy for convenience/auditing during the same browser usage.
  saveConsentRecord(record);
  goNext();
}

function applyConsentConfig(consent) {
  if (!consent) return;
  consentText = { ...consentText, ...consent };

  if (consent.pageTitle) els.title.textContent = consent.pageTitle;
  if (consent.pageSubtitle) els.subtitle.textContent = consent.pageSubtitle;
  if (typeof consent.introParagraph === "string") els.intro.textContent = consent.introParagraph;

  if (Array.isArray(consent.bullets)) {
    els.bullets.innerHTML = "";
    for (const item of consent.bullets) {
      const li = document.createElement("li");
      li.textContent = String(item);
      els.bullets.appendChild(li);
    }
  }

  if (typeof consent.extraParagraph === "string") els.extra.textContent = consent.extraParagraph;
  if (consent.participantIdLabel) els.participantIdLabel.textContent = consent.participantIdLabel;
  if (consent.participantIdPlaceholder) els.participantId.placeholder = consent.participantIdPlaceholder;
  if (consent.agreeLabel) els.agreeLabel.textContent = consent.agreeLabel;
  if (consent.startButtonLabel) els.startBtn.textContent = consent.startButtonLabel;
}

function bindEvents() {
  els.startBtn.addEventListener("click", submitConsent);
  els.devSkipBtn.addEventListener("click", goNext);
}

(async function init() {
  await initTopbar({ requireAuth: true });

  els.consentDate.textContent = "Date: " + new Date().toLocaleDateString();

  try {
    const cfg = await getAppConfig();
    applyConsentConfig(cfg?.consent);
  } catch { /* keep defaults on failure */ }

  bindEvents();
})();
