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

function buildPrompt(tabs) {
  const list = tabs
    .map((t) => `${t.index}. ${t.title || "(untitled)"} — ${t.url}`)
    .join("\n");

  return `You are organizing a user's browser tabs into groups.

Here are the open tabs, one per line as "index. title — url":

${list}

Cluster these tabs into a small number of coherent groups (aim for 2–7 groups; do not put every tab in its own group). Base groups on topic, task, or site — for example "Work", "Shopping", "Docs", "Social", "Research".

Rules:
- Every tab index must appear in exactly one group.
- Group names must be SHORT (1–2 words), suitable as a tab-group label.
- Pick a "color" for each group from this exact set: ${GROUP_COLORS.join(", ")}.
- Use a different color for each group when possible.

Respond with ONLY a JSON object in this exact shape, nothing else:
{"groups":[{"name":"Work","color":"blue","tabIndices":[0,3,4]},{"name":"Shopping","color":"green","tabIndices":[1,2]}]}`;
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
 * @param {{index:number,title:string,url:string}[]} tabs
 * @param {{apiKey:string, model:string}} opts
 * @returns {Promise<{name:string,color:string,tabIndices:number[]}[]>}
 */
export async function classifyTabs(tabs, { apiKey, model }) {
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
      { role: "user", content: buildPrompt(tabs) },
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
  return groups
    .map((g) => ({
      name: String(g.name || "Tabs").slice(0, 40),
      color: GROUP_COLORS.includes(g.color) ? g.color : "grey",
      tabIndices: Array.isArray(g.tabIndices)
        ? g.tabIndices.filter((i) => validIndices.has(i))
        : [],
    }))
    .filter((g) => g.tabIndices.length > 0);
}
