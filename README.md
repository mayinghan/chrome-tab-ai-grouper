# AI Tab Auto-Grouper

A Chrome extension (Manifest V3) that organizes your open tabs into named,
color-coded tab groups using a [Fireworks AI](https://fireworks.ai) LLM.

## How it works

1. The extension collects the title and URL of every regular tab in the focused
   window (pinned tabs and internal `chrome://` pages are skipped).
2. It sends that list to a Fireworks chat model and asks it to cluster the tabs
   into a few coherent groups, each with a short name and a color.
3. It applies the result using Chrome's native tab-group APIs.

You can group on demand from the popup, or enable **auto-group**, which
re-runs grouping (debounced) whenever you open, close, or finish loading tabs.

## Setup

1. Get a Fireworks API key at
   [fireworks.ai/account/api-keys](https://fireworks.ai/account/api-keys).
2. Load the extension:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right)
   - Click **Load unpacked** and select this folder
3. Open the extension's **Settings** (right-click the icon → Options, or the
   "Settings" link in the popup) and paste your API key. Optionally change the
   model.
4. Click the extension icon and press **Group tabs now**.

## Configuration

- **API key** — your Fireworks key (`fw_...`), stored in Chrome sync storage.
- **Model** — any Fireworks chat model id. Default:
  `accounts/fireworks/models/qwen3p7-plus`.
- **Auto-group** — toggle in the popup; regroups ~6s after tab activity settles.

## Files

| File             | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `manifest.json`  | MV3 manifest, permissions, entry points.                     |
| `background.js`  | Service worker: grouping logic, messaging, auto-group alarm. |
| `fireworks.js`   | Fireworks API client and prompt.                             |
| `popup.html/js`  | Toolbar popup: manual trigger + auto toggle.                 |
| `options.html/js`| Settings page: API key + model.                              |

## Notes

- Tab groups are per-window, so grouping applies to the focused window.
- The model call uses Fireworks' OpenAI-compatible
  `/inference/v1/chat/completions` endpoint with JSON response mode.
# chrome-tab-ai-grouper
