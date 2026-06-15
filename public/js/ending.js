import { clearFlowFlags } from "/js/common.js";

const backBtn = document.getElementById("backBtn");

// Ending screen is a hard stop in the flow:
// clear session progress flags so next login starts clean.
clearFlowFlags();

backBtn.addEventListener("click", () => {
  // Return to login to begin a new session.
  window.location.href = "/html/login.html";
});