const DEFAULT_MODEL = "accounts/fireworks/models/qwen3p7-plus";

const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const savedEl = document.getElementById("saved");

async function load() {
  const { apiKey = "", model = DEFAULT_MODEL } = await chrome.storage.sync.get([
    "apiKey",
    "model",
  ]);
  apiKeyEl.value = apiKey;
  modelEl.value = model;
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim() || DEFAULT_MODEL,
  });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});

load();
