/*
 * Part of ComfyUI-AI2Go-Utils.
 *
 * Front-end for the AI2Go Prompt Batch node. GPL-3.0, like the rest of the pack.
 *
 * A dynamic row editor in the spirit of rgthree's Power Lora Loader: each prompt is a row with a
 * positive and a negative text box, drag-to-reorder (⠿) and per-row remove (🗑). Buttons:
 *   • 📥 Read from JSON — parse the node wired into the optional `json_in` socket and APPEND its
 *     prompts to the rows (pulled to the top, next to the input).
 *   • ➕ Add Prompt / 🗑 Clear All — grow or wipe the list.
 *   • 🔍 Check for prompts — validate + count, reset index to 0, report how many runs to queue.
 *
 * The rows are the source of truth. They are serialized into the hidden `prompts_json` widget, which
 * is what the Python `execute` reads — so save/load and execution both flow through that one field.
 * The index is walked by the node itself: an `afterQueued` hook bumps `index` by 1 after each queued
 * run (immune to the user's "Widget Value Control Mode" setting), and a global queue hook zeroes it
 * at batch start for nodes whose "reset_index_at_batch_start" toggle is on. The parse logic mirrors
 * _parse_prompts in nodes/prompt_batch.py — keep the two in sync.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

const NODE_ID = "AI2GoPromptBatch";

// ── Mirror of _parse_prompts in nodes/prompt_batch.py. Returns { ok, prompts } or { ok:false, error }.
function parsePrompts(raw) {
  const text = (raw || "").trim();
  if (!text) return { ok: false, error: "Prompt JSON is empty — add a prompt or import one." };
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

const findWidget = (node, name) => node.widgets?.find((w) => w.name === name);

// Set a node's index widget (and fire its callback so any display updates).
function setIndex(node, value) {
  const idxW = findWidget(node, "index");
  if (!idxW) return;
  idxW.value = value;
  idxW.callback?.(value);
  node.setDirtyCanvas?.(true, true);
}

// Collapse a native widget so it takes no space (the Resolution Selector trick). Used to hide the
// authoritative-but-internal prompts_json field.
function hideWidget(w) {
  if (!w) return;
  w.hidden = true;
  w.computeSize = () => [0, -4];
}

// Read the JSON string from whatever plain text/primitive node is wired into `json_in`.
function readConnectedJson(node) {
  const inp = (node.inputs || []).find((i) => i.name === "json_in");
  if (!inp) return { ok: false, error: "No json_in input on this node." };
  if (inp.link == null) return { ok: false, error: "Nothing connected — wire a text/JSON node into json_in." };
  const links = node.graph?.links;
  const link = links?.get ? links.get(inp.link) : links?.[inp.link];
  if (!link) return { ok: false, error: "json_in link could not be resolved." };
  const origin = node.graph?.getNodeById(link.origin_id);
  if (!origin) return { ok: false, error: "Source node for json_in not found." };
  // Grab the first non-empty string widget value on the source (covers primitives, text nodes, etc.).
  for (const w of origin.widgets || []) {
    if (typeof w.value === "string" && w.value.trim()) return { ok: true, raw: w.value };
  }
  return { ok: false, error: "Source node has no readable text value (only static text/primitive nodes can be imported)." };
}

// One shared stylesheet for every Prompt Batch editor on the graph.
function ensureStyles() {
  if (document.getElementById("ai2go-pb-style")) return;
  const s = document.createElement("style");
  s.id = "ai2go-pb-style";
  s.textContent = `
  .ai2go-pb{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;
    font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:#d3d3d0;padding:1px 0}
  .ai2go-pb .pb-head{display:flex;justify-content:space-between;padding:0 2px;font-size:10.5px;color:#8b8b86}
  .ai2go-pb .pb-head .pos{color:#5cae6d}.ai2go-pb .pb-head .neg{color:#c86b6b}
  .ai2go-pb .pb-empty{padding:8px;text-align:center;color:#6d6d68;font-size:11px;
    border:1px dashed #3a3a38;border-radius:7px}
  .ai2go-pb .pb-row{display:flex;align-items:stretch;gap:7px;background:#262625;
    border:1px solid #3a3a38;border-radius:8px;padding:7px}
  .ai2go-pb .pb-row.pb-drag{opacity:.45}
  .ai2go-pb .pb-row.pb-over{border-color:#46b4e6;box-shadow:0 0 0 1px #46b4e6 inset}
  .ai2go-pb .pb-grip{align-self:center;color:#6d6d68;font-size:15px;cursor:grab;user-select:none;line-height:1}
  .ai2go-pb .pb-num{align-self:center;flex:none;width:20px;height:20px;border-radius:50%;
    background:#333331;color:#8b8b86;font:600 11px/20px ui-monospace,Consolas,monospace;text-align:center}
  .ai2go-pb .pb-fields{display:flex;gap:7px;flex:1;min-width:0}
  .ai2go-pb .pb-field{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
  .ai2go-pb .pb-lbl{font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
  .ai2go-pb .pb-field.pos .pb-lbl{color:#5cae6d}.ai2go-pb .pb-field.neg .pb-lbl{color:#c86b6b}
  .ai2go-pb textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:40px;
    background:#1a1a19;border:1px solid #33332f;border-radius:5px;padding:5px 7px;
    color:#d3d3d0;font:11.5px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;outline:none}
  .ai2go-pb textarea:focus{border-color:#46b4e6}
  .ai2go-pb .pb-field.pos textarea{border-left:2px solid #5cae6d}
  .ai2go-pb .pb-field.neg textarea{border-left:2px solid #c86b6b}
  .ai2go-pb .pb-trash{align-self:center;flex:none;color:#6d6d68;font-size:13px;cursor:pointer;padding:2px}
  .ai2go-pb .pb-trash:hover{color:#c86b6b}
  `;
  document.head.appendChild(s);
}

app.registerExtension({
  name: "AI2Go.PromptBatch",

  // Wrap the queue action once: before a batch is queued, zero the index of every Prompt Batch node
  // whose "reset_index_at_batch_start" is on. The per-run afterQueued increment (wired in
  // onNodeCreated) then walks 0,1,2… across the batch.
  async setup() {
    const orig = app.queuePrompt;
    if (typeof orig !== "function" || orig._ai2goWrapped) return;
    const wrapped = async function (...args) {
      try {
        for (const node of app.graph?._nodes || []) {
          if (node?.comfyClass !== NODE_ID && node?.type !== NODE_ID) continue;
          const resetW = findWidget(node, "reset_index_at_batch_start");
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
    ensureStyles();

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const jsonW = findWidget(node, "prompts_json");
      hideWidget(jsonW);

      // Rows are the source of truth (array of {positive, negative}); jsonW is the serialized mirror.
      node._pbRows = [];
      let dragIndex = -1;

      // Own the per-run walk: after each queued run, advance the index by 1 (always after
      // serialization, so the run that fired used the pre-increment value).
      const idxW = findWidget(node, "index");
      if (idxW) idxW.afterQueued = () => setIndex(node, (parseInt(idxW.value, 10) || 0) + 1);

      // ── DOM row editor ──
      const editorEl = document.createElement("div");
      editorEl.className = "ai2go-pb";
      const rowsWidget = node.addDOMWidget("prompt_batch_rows", "rows", editorEl, { serialize: false });

      // Serialize rows -> hidden prompts_json (the field Python reads and the workflow saves).
      function syncJson() {
        if (jsonW) jsonW.value = JSON.stringify(node._pbRows.map((r) => ({ positive: r.positive, negative: r.negative })));
      }

      // Resize the node to fit the current rows (measured, so no magic row-height constant).
      function syncSize() {
        requestAnimationFrame(() => {
          const h = Math.max(editorEl.scrollHeight, 8);
          rowsWidget.computeSize = () => [node.size?.[0] || 320, h + 4];
          const want = node.computeSize?.();
          if (want) node.setSize([node.size[0], want[1]]);
          node.setDirtyCanvas?.(true, true);
        });
      }

      function render() {
        editorEl.replaceChildren();

        const head = document.createElement("div");
        head.className = "pb-head";
        head.innerHTML = `<span>Prompts</span><span><span class="pos">positive</span> / <span class="neg">negative</span></span>`;
        editorEl.appendChild(head);

        if (!node._pbRows.length) {
          const empty = document.createElement("div");
          empty.className = "pb-empty";
          empty.textContent = "No prompts — press ➕ Add Prompt or 📥 Read from JSON.";
          editorEl.appendChild(empty);
          return;
        }

        node._pbRows.forEach((row, k) => {
          const el = document.createElement("div");
          el.className = "pb-row";

          const grip = document.createElement("span");
          grip.className = "pb-grip";
          grip.textContent = "⠿";
          grip.title = "Drag to reorder";
          // Only make the row draggable while the grip is held, so textarea selection still works.
          grip.addEventListener("mousedown", () => { el.draggable = true; });
          el.addEventListener("mouseup", () => { el.draggable = false; }); // grip pressed but not dragged
          el.addEventListener("dragstart", (e) => { dragIndex = k; e.dataTransfer.effectAllowed = "move"; el.classList.add("pb-drag"); });
          el.addEventListener("dragend", () => { el.draggable = false; dragIndex = -1; el.classList.remove("pb-drag"); editorEl.querySelectorAll(".pb-over").forEach((n) => n.classList.remove("pb-over")); });
          el.addEventListener("dragover", (e) => { e.preventDefault(); if (dragIndex > -1 && dragIndex !== k) el.classList.add("pb-over"); });
          el.addEventListener("dragleave", () => el.classList.remove("pb-over"));
          el.addEventListener("drop", (e) => {
            e.preventDefault();
            el.classList.remove("pb-over");
            if (dragIndex > -1 && dragIndex !== k) {
              const [moved] = node._pbRows.splice(dragIndex, 1);
              node._pbRows.splice(k, 0, moved);
              render(); syncJson();
            }
          });

          const num = document.createElement("span");
          num.className = "pb-num";
          num.textContent = String(k + 1);

          const fields = document.createElement("div");
          fields.className = "pb-fields";
          for (const key of ["positive", "negative"]) {
            const f = document.createElement("div");
            f.className = "pb-field " + (key === "positive" ? "pos" : "neg");
            const lbl = document.createElement("span");
            lbl.className = "pb-lbl";
            lbl.textContent = key;
            const ta = document.createElement("textarea");
            ta.value = row[key] || "";
            ta.placeholder = key === "positive" ? "prompt…" : "(optional)";
            ta.rows = 2;
            ta.addEventListener("input", () => { row[key] = ta.value; syncJson(); });
            // Don't let canvas hotkeys / drag steal keyboard focus while typing.
            ta.addEventListener("pointerdown", (e) => e.stopPropagation());
            f.append(lbl, ta);
            fields.appendChild(f);
          }

          const trash = document.createElement("span");
          trash.className = "pb-trash";
          trash.textContent = "🗑";
          trash.title = "Remove this prompt";
          trash.addEventListener("click", () => { node._pbRows.splice(k, 1); render(); syncJson(); syncSize(); });

          el.append(grip, num, fields, trash);
          editorEl.appendChild(el);
        });
      }

      // Rebuild the rows from the hidden JSON (on create from defaults, and after a workflow loads).
      node._pbRebuild = () => {
        const res = parsePrompts(jsonW?.value);
        node._pbRows = res.ok ? res.prompts.map((p) => ({ positive: p.positive, negative: p.negative })) : [];
        render(); syncJson(); syncSize();
      };

      // ── Buttons (native, so they look/behave like ComfyUI). Created in display order; Read is then
      // hoisted above the index/reset widgets. ──
      const readBtn = node.addWidget("button", "📥 Read from JSON", null, () => {
        const res = readConnectedJson(node);
        if (!res.ok) { setStatus("❌ " + res.error, "#e0555a"); return; }
        const parsed = parsePrompts(res.raw);
        if (!parsed.ok) { setStatus("❌ " + parsed.error, "#e0555a"); return; }
        for (const p of parsed.prompts) node._pbRows.push({ positive: p.positive, negative: p.negative });
        render(); syncJson(); syncSize();
        setStatus(`✅ Imported ${parsed.prompts.length} — ${node._pbRows.length} prompt${node._pbRows.length === 1 ? "" : "s"} total.`, "#46b4e6");
      });
      readBtn.serialize = false;

      const addBtn = node.addWidget("button", "➕ Add Prompt", null, () => {
        node._pbRows.push({ positive: "", negative: "" });
        render(); syncJson(); syncSize();
      });
      addBtn.serialize = false;

      const clearBtn = node.addWidget("button", "🗑 Clear All", null, () => {
        if (node._pbRows.length && !confirm("Remove all prompts from this node?")) return;
        node._pbRows = [];
        render(); syncJson(); syncSize();
        setStatus('Cleared. Press "Add Prompt" or "Read from JSON" to start again.', "#8a8a8a");
      });
      clearBtn.serialize = false;

      // Status line (read-only DOM widget), then the Check button above it.
      const statusEl = document.createElement("div");
      statusEl.style.cssText = "width:100%;box-sizing:border-box;padding:3px 6px;text-align:center;line-height:1.4;font:12px sans-serif;";
      const setStatus = (text, color) => { statusEl.textContent = text; statusEl.style.color = color; node.setDirtyCanvas?.(true, true); };

      const checkBtn = node.addWidget("button", "🔍 Check for prompts", null, () => {
        const res = parsePrompts(jsonW?.value);
        if (!res.ok) { setStatus("❌ " + res.error, "#e0555a"); return; }
        const n = res.prompts.length;
        setIndex(node, 0);
        setStatus(`✅ ${n} prompt${n === 1 ? "" : "s"} detected — set ComfyUI runs to ${n} (index reset to 0).`, "#46b4e6");
      });
      checkBtn.serialize = false;

      node.addDOMWidget("prompt_batch_status", "info", statusEl, { serialize: false });
      setStatus('Add prompts, or import JSON — then press "Check for prompts".', "#8a8a8a");

      // Hoist "Read from JSON" to just above the index widget, and drop the rows editor right below
      // reset (it was appended after the buttons). Final order: [json(hidden), read, index, reset,
      // rows, add, clear, check, status].
      const move = (w, beforeName) => {
        const arr = node.widgets, cur = arr.indexOf(w);
        if (cur > -1) arr.splice(cur, 1);
        const at = arr.findIndex((x) => x.name === beforeName);
        arr.splice(at > -1 ? at : arr.length, 0, w);
      };
      move(readBtn, "index");
      move(rowsWidget, "➕ Add Prompt");

      node._pbRebuild();
    });

    // After a saved workflow loads, prompts_json is restored — rebuild the rows from it.
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const node = this;
      requestAnimationFrame(() => node._pbRebuild?.());
    });
  },
});
