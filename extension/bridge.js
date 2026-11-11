// Isolated-world content script: passes what the page hook (core/page-hook-main.js) saw to the service worker.
// The page can dispatch the same event, so the worker stores it as data and never acts on it. Entries over 64 KB
// are dropped, like the CLI's caps on what one page can put in a recording.
(() => {
  const MAX = 64 * 1024;
  window.addEventListener("__aitd_recorder", (e) => {
    try {
      const detail = typeof e.detail === "string" ? e.detail : "";
      if (!detail || detail.length > MAX) return;
      const { kind, entry } = JSON.parse(detail);
      if (!["push", "load", "message"].includes(kind)) return;
      chrome.runtime.sendMessage({ type: "page", kind, entry, frameUrl: location.href }).catch(() => {});
    } catch {
      // A malformed event from the page: ignored.
    }
  });
})();
