/*
 * Part of ComfyUI-AI2Go-Utils.
 *
 * Front-end for the AI2Go Prompt Batch node. GPL-3.0, like the rest of the pack.
 *
 * Adds a "Check for prompts" button that validates the pasted JSON, counts the prompts, resets the
 * index to 0, and shows how many ComfyUI runs to queue. The index is walked by the node itself: an
 * `afterQueued` hook on the index widget bumps it by 1 after each queued run, so a batch walks the
 * list 0,1,2…. Owning the increment here (instead of the built-in control_after_generate) makes the
 * timing immune to the user's "Widget Value Control Mode" (before/after) setting. A global queue hook
 * zeroes the index at the start of each batch for nodes whose "reset_index_at_batch_start" toggle is
 * on. The parse logic mirrors _parse_prompts in nodes/prompt_batch.py — keep the two in sync.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

const NODE_ID = "AI2GoPromptBatch";

// Mirror of _parse_prompts in nodes/prompt_batch.py. Returns { ok, prompts } or { ok:false, error }.
function parsePrompts(raw) {
  const text = (raw || "").trim();
  if (!text) return { ok: false, error: "Prompt JSON is empty — paste a JSON array of prompts." };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "Malformed JSON: " + e.message };
  }
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.prompts)) {
    data = data.prompts; // tolerate a { "prompts": [...] } wrapper
  }
  if (!Array.isArray(data)) return { ok: false, error: 'Expected a JSON array of prompts, e.g. [{"positive": "..."}, ...].' };
  if (data.length === 0) return { ok: false, error: "Prompt list is empty — it needs at least one prompt." };

  const prompts = [];
  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    const where = `Prompt #${i + 1}`;
    let positive, negative;
    if (typeof entry === "string") {
      positive = entry;
      negative = "";
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      positive = entry.positive ?? entry.prompt ?? "";
      negative = entry.negative ?? "";
      if (negative == null) negative = "";
      if (typeof positive !== "string") return { ok: false, error: `${where}: 'positive' must be a string.` };
      if (typeof negative !== "string") return { ok: false, error: `${where}: 'negative' must be a string.` };
    } else {
      return { ok: false, error: `${where}: each entry must be an object with a 'positive' field (or a plain string).` };
    }
    if (!String(positive).trim()) return { ok: false, error: `${where}: 'positive' is empty.` };
    prompts.push({ positive, negative });
  }
  return { ok: true, prompts };
}

const indexWidget = (node) => node.widgets?.find((w) => w.name === "index");

// Set a node's index widget (and fire its callback so the display updates).
function setIndex(node, value) {
  const idxW = indexWidget(node);
  if (!idxW) return;
  idxW.value = value;
  idxW.callback?.(value);
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "AI2Go.PromptBatch",

  // Wrap the queue action once: before a batch is queued, zero the index of every Prompt Batch node
  // whose "reset_index_at_batch_start" is on. The per-run afterQueued increment (wired in
  // onNodeCreated) then walks 0,1,2… across the batch, so each queued run emits the next prompt
  // starting from the first. app.queuePrompt(number, batchCount) is called once per Queue press.
  async setup() {
    const orig = app.queuePrompt;
    if (typeof orig !== "function" || orig._ai2goWrapped) return;
    const wrapped = async function (...args) {
      try {
        for (const node of app.graph?._nodes || []) {
          if (node?.comfyClass !== NODE_ID && node?.type !== NODE_ID) continue;
          const resetW = node.widgets?.find((w) => w.name === "reset_index_at_batch_start");
          if (!resetW || resetW.value) setIndex(node, 0);
        }
      } catch (e) {
        console.error("[AI2Go PromptBatch] batch-start index reset failed:", e);
      }
      return orig.apply(this, args);
    };
    wrapped._ai2goWrapped = true;
    app.queuePrompt = wrapped;
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const jsonW = node.widgets?.find((w) => w.name === "prompts_json");

      // Own the per-run walk: after each queued run, advance the index by 1. ComfyUI calls afterQueued
      // once per queued prompt, always after the node was serialized, so the run that just fired used
      // the pre-increment value. Doing it here (not via control_after_generate) keeps the timing
      // independent of the "Widget Value Control Mode" setting.
      const idxW = indexWidget(node);
      if (idxW) {
        idxW.afterQueued = function () {
          setIndex(node, (parseInt(idxW.value, 10) || 0) + 1);
        };
      }

      // ── Read-only status line (added last → sits at the bottom of the node). Shows the prompt count
      // and how many runs to queue, or a red parse error. ──
      const statusEl = document.createElement("div");
      statusEl.style.cssText =
        "width:100%;box-sizing:border-box;padding:3px 6px;text-align:center;line-height:1.4;font:12px sans-serif;";
      const setStatus = (text, color) => {
        statusEl.textContent = text;
        statusEl.style.color = color;
      };
      setStatus('Click "Check for prompts" to validate & count.', "#8a8a8a");
      node.addDOMWidget("prompt_batch_status", "info", statusEl, { serialize: false });

      // Validate + count + reset index to 0, then report.
      function check() {
        const res = parsePrompts(jsonW?.value);
        if (!res.ok) {
          setStatus("❌ " + res.error, "#e0555a");
          node.setDirtyCanvas?.(true, true);
          return;
        }
        const n = res.prompts.length;
        setIndex(node, 0);
        setStatus(
          `✅ ${n} prompt${n === 1 ? "" : "s"} detected — set ComfyUI runs to ${n} (index reset to 0).`,
          "#46b4e6",
        );
        node.setDirtyCanvas?.(true, true);
      }

      // Native button widget (same pattern as the Style Wizard's addWidget("button", …)).
      const btn = node.addWidget("button", "🔍 Check for prompts", null, check);
      btn.serialize = false;
    });
  },
});
