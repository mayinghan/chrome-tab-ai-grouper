// Fireworks AI client — classifies a list of tabs into named groups.
// Uses the OpenAI-compatible chat completions endpoint.

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

// Colors Chrome accepts for tab groups (chrome.tabGroups.Color).
export const GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

function buildPrompt(tabs, existingGroups) {
  const list = tabs
    .map((t) => `${t.index}. ${t.title || "(untitled)"} — ${t.url}`)
    .join("\n");

  const existingBlock = existingGroups.length
    ? `The window already has these groups. You may add tabs to them by their numeric id:\n${existingGroups
        .map((g) => `- id ${g.id}: "${g.name || "(unnamed)"}"`)
        .join("\n")}`
    : "The window has no existing groups yet.";

  return `You are organizing a user's browser tabs.

These tabs are currently UNGROUPED, one per line as "index. title — url":

${list}

${existingBlock}

For each ungrouped tab, decide whether it belongs in one of the existing groups or in a new group.

Rules:
- PREFER adding a tab to an existing group when it clearly fits that group's topic/site. Reference the group by its numeric id.
- Only create a NEW group when several ungrouped tabs share a topic that none of the existing groups covers. Aim for few groups; do not put every tab in its own group.
- If a tab fits no existing group and cannot form a coherent new group with other ungrouped tabs, leave it out entirely (do not force it).
- New group names must be SHORT (1–2 words). Pick a "color" for each NEW group from this exact set: ${GROUP_COLORS.join(", ")}.
- Every tab index you use must be one of the ungrouped indices above, used at most once.

Respond with ONLY a JSON object in this exact shape, nothing else:
{"groups":[{"existingGroupId":123,"tabIndices":[0,3]},{"name":"Research","color":"green","tabIndices":[1,2]}]}
- To add tabs to an existing group: set "existingGroupId" to its id and omit name/color.
- To create a new group: set "name" and "color" and omit existingGroupId.`;
}

// Extract the first JSON object from a model response that may contain
// stray prose or reasoning tokens around it.
//
// Reasoning models (e.g. Qwen3) can wrap the answer in <think>…</think>
// blocks and/or markdown code fences, and their reasoning often contains
// stray braces (even example JSON). A naive first-"{" to last-"}" slice
// therefore captures garbage. We strip the wrappers, then pull out the first
// *balanced* {…} object, ignoring braces that appear inside string literals.
function extractJson(text) {
  let s = text;

  // Drop <think>…</think> reasoning (including an unterminated trailing one).
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/<think>[\s\S]*$/i, "");

  // Drop markdown code fences (```json … ``` or ``` … ```).
  s = s.replace(/```(?:json)?/gi, "");

  const start = s.indexOf("{");
  if (start === -1) throw new Error("Model did not return JSON.");

  // Walk forward tracking brace depth, skipping over string literals so that
  // braces inside strings don't affect the count.
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error("Model did not return a complete JSON object.");
}

/**
 * @param {{index:number,title:string,url:string}[]} tabs  ungrouped tabs to organize
 * @param {{id:number,name:string}[]} existingGroups  groups already in the window
 * @param {{apiKey:string, model:string}} opts
 * @returns {Promise<({existingGroupId:number,tabIndices:number[]}|{name:string,color:string,tabIndices:number[]})[]>}
 */
export async function classifyTabs(tabs, existingGroups, { apiKey, model }) {
  const body = {
    model,
    // Reasoning models spend tokens on <think> before the answer; give the
    // JSON enough headroom so it isn't truncated mid-object.
    max_tokens: 4096,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a precise assistant that organizes browser tabs and replies with strict JSON only.",
      },
      { role: "user", content: buildPrompt(tabs, existingGroups) },
    ],
  };

  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Fireworks API error ${res.status}: ${detail.slice(0, 300) || res.statusText}`,
    );
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from Fireworks.");

  const parsed = extractJson(content);
  const groups = Array.isArray(parsed.groups) ? parsed.groups : [];

  // Validate and sanitize.
  const validIndices = new Set(tabs.map((t) => t.index));
  const validGroupIds = new Set(existingGroups.map((g) => g.id));
  const used = new Set(); // ensure each tab is assigned at most once

  const result = [];
  for (const g of groups) {
    const tabIndices = Array.isArray(g.tabIndices)
      ? g.tabIndices.filter((i) => validIndices.has(i) && !used.has(i))
      : [];
    if (tabIndices.length === 0) continue;
    tabIndices.forEach((i) => used.add(i));

    if (g.existingGroupId != null && validGroupIds.has(g.existingGroupId)) {
      // Merge into an existing group.
      result.push({ existingGroupId: g.existingGroupId, tabIndices });
    } else {
      // Create a new group (fall back gracefully if id was invalid).
      result.push({
        name: String(g.name || "Tabs").slice(0, 40),
        color: GROUP_COLORS.includes(g.color) ? g.color : "grey",
        tabIndices,
      });
    }
  }
  return result;
}
