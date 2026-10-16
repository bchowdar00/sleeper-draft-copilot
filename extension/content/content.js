// content.js — draft-id detector for the Sleeper draft room.
// NOT an ES module. No DOM manipulation, no fetch. Reads the URL, extracts the
// draft id, and relays it to the service worker. Sleeper is an SPA, so the URL
// can change without a reload — re-check on an interval. Everything is wrapped in
// try/catch because the extension context can be invalidated on reload.

(function () {
  'use strict';

  function extractDraftId(href) {
    if (typeof href !== 'string') return null;
    var m = href.match(/\/draft\/nfl\/(\d+)/);
    return m ? m[1] : null;
  }

  var lastDraftId = null;

  function check() {
    try {
      var href = location.href;
      var draftId = extractDraftId(href);
      if (draftId && draftId !== lastDraftId) {
        lastDraftId = draftId;
        chrome.runtime.sendMessage({
          type: 'draftDetected',
          draftId: draftId,
          url: href
        });
      }
    } catch (err) {
      // Extension context invalidated (reload) or transient error — ignore.
    }
  }

  check();
  setInterval(check, 2000);
})();
