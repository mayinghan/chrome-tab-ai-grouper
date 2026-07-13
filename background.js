// Service worker: orchestrates grouping. Handles popup messages and
// debounced automatic re-grouping when tabs change.

import { classifyTabs } from "./fireworks.js";

const DEFAULTS = {
  apiKey: "",
  model: "accounts/fireworks/models/qwen3p7-plus",
  autoGroup: false,
};

const AUTO_ALARM = "auto-group";
const AUTO_DEBOUNCE_MINUTES = 0.1; // ~6s after the last tab change

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

// Only group real web pages; skip empty/new-tab pages that have no useful signal.
function isGroupable(tab) {
  if (tab.pinned) return false;
  const url = tab.url || "";
  return url.startsWith("http://") || url.startsWith("https://");
}

async function setStatus(status) {
  await chrome.storage.local.set({
    lastStatus: { ...status, at: new Date().toISOString() },
  });
}

async function runGrouping({ windowId } = {}) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) {
    throw new Error("No API key set. Open the extension options to add your Fireworks API key.");
  }

  const win = windowId ?? (await chrome.windows.getLastFocused()).id;
  const allTabs = await chrome.tabs.query({ windowId: win });
  const groupable = allTabs.filter(isGroupable);

  if (groupable.length < 2) {
    const result = { grouped: 0, message: "Not enough tabs to group." };
    await setStatus({ ok: true, ...result });
    return result;
  }

  const items = groupable.map((t, i) => ({
    index: i,
    title: t.title,
    url: t.url,
  }));

  const groups = await classifyTabs(items, { apiKey, model });

  let appliedGroups = 0;
  let appliedTabs = 0;
  for (const g of groups) {
    const tabIds = g.tabIndices
      .map((i) => groupable[i]?.id)
      .filter((id) => id != null);
    if (tabIds.length === 0) continue;

    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: g.name, color: g.color });
    appliedGroups += 1;
    appliedTabs += tabIds.length;
  }

  const result = {
    grouped: appliedGroups,
    tabs: appliedTabs,
    message: `Organized ${appliedTabs} tabs into ${appliedGroups} groups.`,
  };
  await setStatus({ ok: true, ...result });
  return result;
}

// --- Message handling from popup ---------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "groupNow") {
    runGrouping()
      .then((result) => sendResponse({ ok: true, result }))
      .catch(async (err) => {
        await setStatus({ ok: false, message: err.message });
        sendResponse({ ok: false, error: err.message });
      });
    return true; // keep the message channel open for the async response
  }
});

// --- Automatic (debounced) grouping ------------------------------------

async function scheduleAuto() {
  const { autoGroup } = await getSettings();
  if (!autoGroup) return;
  // (Re)arm a single alarm; rapid tab changes collapse into one run.
  chrome.alarms.create(AUTO_ALARM, { delayInMinutes: AUTO_DEBOUNCE_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_ALARM) return;
  runGrouping().catch((err) => setStatus({ ok: false, message: err.message }));
});

chrome.tabs.onCreated.addListener(scheduleAuto);
chrome.tabs.onRemoved.addListener(scheduleAuto);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  // Only react once a tab finishes loading (has a title/url worth grouping on).
  if (changeInfo.status === "complete") scheduleAuto();
});
