import { createElement, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import Joyride, { STATUS } from "https://esm.sh/react-joyride@2.8.2";

export function initJoyrideTour({
  mountId = "joyrideRoot",
  autoStart = false,
  getTimerCtrl,
  onComplete
} = {}) {
  // Mount a React-based guided tour on top of the plain JS page.
  const mount = document.getElementById(mountId);
  if (!mount) return;

  const root = createRoot(mount);

  function App() {
    // Walkthrough only covers visible/usable parts of the QR page.
    const rawSteps = [
      {
        target: ".timerBig",
        title: "Timer",
        content: "You have 30 minutes. Pause/Resume controls the countdown. When it hits 00:00, you get logged out."
      },
      {
        target: "#endBtn",
        title: "End session",
        content: "Ends the session immediately and takes you to the ending screen."
      },
      {
        target: "#myUploadsLink",
        title: "My uploads",
        content: "Shows all images you uploaded on your account."
      },
      {
        target: ".chatBox",
        title: "AI chat",
        content: "Ask the AI for ideas or help while you work."
      },
      {
        target: "#qr",
        title: "QR code",
        content: "Scan with your phone, or click this code to open the upload page in a new tab."
      },
      {
        target: "#resultImg",
        title: "Preview",
        content: "After you upload, the latest image for this session appears here automatically."
      },
      {
        target: "#logoutBtn",
        title: "Log out",
        content: "Logs you out and sends you back to the login screen."
      }
    ];

    const steps = useMemo(
      () =>
        rawSteps
          .filter((step) => {
            try {
              return Boolean(document.querySelector(step.target));
            } catch {
              return false;
            }
          })
          .map((step) => ({ ...step, disableBeacon: true })),
      []
    );

    const [run, setRun] = useState(autoStart);
    const [stepIndex, setStepIndex] = useState(0);
    const [resizeKey, setResizeKey] = useState(0);
    const wasRunningRef = useRef(null);

    function start() {
      setStepIndex(0);
      setRun(true);
    }

    // Help button restarts the tour from step 1
    useEffect(() => {
      const helpBtn = document.getElementById("helpBtn");
      if (!helpBtn) return;

      helpBtn.addEventListener("click", start);
      return () => helpBtn.removeEventListener("click", start);
    }, []);

    // Re-measure spotlight when the window changes size (resize, minimize/restore,
    // orientation change, devtools opens, responsive breakpoints flip).
    // react-joyride caches target rects, so we force a remount via the `key`
    // prop, debounced so a drag-resize doesn't thrash. Controlled stepIndex
    // is preserved in parent state, so the user stays on the same step.
    useEffect(() => {
      if (!run) return;
      let timer = null;
      function bump() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setResizeKey((k) => k + 1), 150);
      }
      function bumpImmediate() {
        if (document.visibilityState === "visible") bump();
      }
      window.addEventListener("resize", bump);
      window.addEventListener("orientationchange", bump);
      document.addEventListener("visibilitychange", bumpImmediate);
      return () => {
        window.removeEventListener("resize", bump);
        window.removeEventListener("orientationchange", bump);
        document.removeEventListener("visibilitychange", bumpImmediate);
        if (timer) clearTimeout(timer);
      };
    }, [run]);

    // Clip the spotlight ONLY when it's straddling the topbar (i.e., the
    // target sits below the topbar normally, but the user has scrolled it
    // partially behind the sticky header). In that straddling case the top
    // portion is clipped so no bright rectangle bleeds onto the title.
    //
    // Targets that are entirely inside the topbar (timer, end, my uploads,
    // help, logout) get NO clip, so they keep their normal spotlight.
    // Targets entirely below the topbar also get no clip.
    useEffect(() => {
      if (!run) return;
      const docEl = document.documentElement;
      let rafId = null;

      function update() {
        const spotlight = document.querySelector(".react-joyride__spotlight");
        const topbar = document.querySelector(".topbar");
        if (!spotlight || !topbar) {
          docEl.style.setProperty("--spotlight-clip-top", "0px");
          rafId = requestAnimationFrame(update);
          return;
        }
        // spotlight is position:absolute inside an absolute overlay that
        // spans the document, so its top/height are in document coords.
        const top = parseFloat(spotlight.style.top) || 0;
        const height = parseFloat(spotlight.style.height) || 0;
        const bottom = top + height;
        const topbarBottomViewport = topbar.getBoundingClientRect().bottom;
        const topbarBottomDoc = window.scrollY + topbarBottomViewport;

        // Only clip if the spotlight straddles the topbar boundary.
        // - top fully below topbar -> no clip
        // - bottom fully above topbar (target IS in topbar) -> no clip
        // - straddles -> clip the portion above the topbar boundary
        let clip = 0;
        if (top < topbarBottomDoc && bottom > topbarBottomDoc) {
          clip = Math.min(height, topbarBottomDoc - top);
        }
        docEl.style.setProperty("--spotlight-clip-top", `${clip}px`);
        rafId = requestAnimationFrame(update);
      }

      rafId = requestAnimationFrame(update);
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        docEl.style.removeProperty("--spotlight-clip-top");
      };
    }, [run]);

    // pause timer when tour is running (but only resume if it was running before)
    useEffect(() => {
      const t = getTimerCtrl?.();
      if (!t) return;

      if (run) {
        if (wasRunningRef.current === null) wasRunningRef.current = t.isRunning?.() ?? true;
        if (t.isRunning?.()) t.pause?.();
      } else {
        if (wasRunningRef.current === true) t.resume?.();
        wasRunningRef.current = null;
      }
    }, [run]);

    function handleCallback(data) {
      const { status, index, type, action } = data;

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        setRun(false);
        setStepIndex(0);
        onComplete?.();
        return;
      }

      // Controlled stepIndex must follow Joyride's next/prev; always incrementing broke Back.
      if (typeof index === "number" && type === "step:after") {
        if (action === "next") {
          setStepIndex(index + 1);
        } else if (action === "prev") {
          setStepIndex(Math.max(0, index - 1));
        }
      }
    }

    return (
      createElement(Joyride, {
        key: `joyride-${resizeKey}`,
        steps,
        run,
        stepIndex,
        continuous: true,
        showSkipButton: true,
        showProgress: true,
        scrollToFirstStep: true,
        disableOverlayClose: true,
        disableScrollParentFix: true,
        spotlightClicks: false,
        spotlightPadding: 0,
        callback: handleCallback,
        styles: {
          options: {
            zIndex: 3000,
            overlayColor: "rgba(0, 0, 0, 0.55)",
            primaryColor: "#166534",
            textColor: "#0F2418",
            arrowColor: "#fff",
            backgroundColor: "#fff"
          }
        }
      })
    );
  }

  root.render(createElement(App));
}