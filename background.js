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

  // Only organize tabs the user hasn't already grouped. Tabs already in a
  // group are left untouched — otherwise every run would tear down and
  // recreate the user's groups (losing their collapsed state and any manual
  // edits), which looks like collapsed groups "reopening" by themselves.
  const groupable = allTabs.filter(
    (t) => isGroupable(t) && t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE,
  );

  // Existing groups in this window — the model may merge new tabs into these
  // instead of always creating fresh groups.
  const existingGroups = (await chrome.tabGroups.query({ windowId: win })).map(
    (g) => ({ id: g.id, name: g.title || "" }),
  );

  // Nothing to do if there are no loose tabs, or just a single loose tab with
  // no existing group to merge it into.
  if (
    groupable.length === 0 ||
    (groupable.length < 2 && existingGroups.length === 0)
  ) {
    const result = { grouped: 0, message: "No new tabs to group." };
    await setStatus({ ok: true, ...result });
    return result;
  }

  const items = groupable.map((t, i) => ({
    index: i,
    title: t.title,
    url: t.url,
  }));

  const groups = await classifyTabs(items, existingGroups, { apiKey, model });

  let newGroups = 0;
  let mergedGroups = 0;
  let appliedTabs = 0;
  for (const g of groups) {
    const tabIds = g.tabIndices
      .map((i) => groupable[i]?.id)
      .filter((id) => id != null);
    if (tabIds.length === 0) continue;

    if (g.existingGroupId != null) {
      // Add the tabs to an existing group, then expand it so the newly added
      // tab is visible even if the group was collapsed.
      await chrome.tabs.group({ tabIds, groupId: g.existingGroupId });
      await chrome.tabGroups.update(g.existingGroupId, { collapsed: false });
      mergedGroups += 1;
    } else {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: g.name, color: g.color });
      newGroups += 1;
    }
    appliedTabs += tabIds.length;
  }

  const parts = [];
  if (newGroups) parts.push(`${newGroups} new`);
  if (mergedGroups) parts.push(`merged into ${mergedGroups} existing`);
  const result = {
    grouped: newGroups,
    merged: mergedGroups,
    tabs: appliedTabs,
    message: appliedTabs
      ? `Organized ${appliedTabs} tab${appliedTabs > 1 ? "s" : ""}${
          parts.length ? " (" + parts.join(", ") + ")" : ""
        }.`
      : "No new tabs to group.",
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
// Note: intentionally NOT listening to chrome.tabs.onRemoved. Closing a tab
// creates nothing new to organize, and re-running on close is what made
// closed/collapsed tabs appear to come back.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  // Only react once a tab finishes loading (has a title/url worth grouping on).
  if (changeInfo.status === "complete") scheduleAuto();
});
