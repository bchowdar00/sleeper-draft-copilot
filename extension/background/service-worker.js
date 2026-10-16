// service-worker.js — thin relay (MV3 module service worker).
// Opens the side panel on toolbar click, stores draft-id detections from the
// content script, and manages the toolbar badge. NO poll loop, NO chrome.alarms —
// the side panel owns all real work (see DESIGN.md §0).

// Open the side panel when the toolbar action is clicked. Set both on install and
// at top level so it applies whenever the worker spins up.
function enablePanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
}

chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
enablePanelOnActionClick();

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'draftDetected' && msg.draftId) {
    chrome.storage.local.set({
      lastDetectedDraft: {
        draftId: msg.draftId,
        url: msg.url || null,
        at: Date.now()
      }
    });
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } else if (msg.type === 'panelOpen') {
    // Panel connected — clear the "new draft detected" badge.
    chrome.action.setBadgeText({ text: '' });
  }
});
