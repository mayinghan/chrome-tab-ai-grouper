const groupBtn = document.getElementById("group");
const autoToggle = document.getElementById("auto");
const statusEl = document.getElementById("status");
const nokey = document.getElementById("nokey");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

async function init() {
  const { apiKey = "", autoGroup = false, lastStatus } =
    await chrome.storage.sync.get(["apiKey", "autoGroup"]);
  const local = await chrome.storage.local.get("lastStatus");

  autoToggle.checked = autoGroup;
  nokey.hidden = Boolean(apiKey);

  const last = lastStatus || local.lastStatus;
  if (last) setStatus(last.message || "", !last.ok);
}

groupBtn.addEventListener("click", async () => {
  groupBtn.disabled = true;
  setStatus("Asking the model to organize your tabs…");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "groupNow" });
    if (resp?.ok) {
      setStatus(resp.result.message || "Done.");
    } else {
      setStatus(resp?.error || "Something went wrong.", true);
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    groupBtn.disabled = false;
  }
});

autoToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ autoGroup: autoToggle.checked });
});

document.getElementById("settings").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
