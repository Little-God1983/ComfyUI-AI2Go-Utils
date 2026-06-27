/*
 * Part of ComfyUI-AI2Go-Utils.
 *
 * Companion to the Ideogram 4 Prompt Builder. GPL-3.0, like the rest of the pack.
 * Upstream lineage: https://github.com/kijai/ComfyUI-KJNodes
 *
 * A "click-together" wizard for the Ideogram 4 style_description fields. A button on the node opens a
 * fullscreen chip-picker (5 categories). On close the picked values are written straight into a
 * connected AI2Go Ideogram 4 Prompt Builder's style widgets — the node's own data output stays empty
 * so it never overwrites the builder's bounding boxes / palette / high_level_description.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

const BUILDER_TYPE = "AI2GoIdeogram4PromptBuilder";

// Fixed chip lists (values are exactly what lands in the JSON). Sourced from the research report.
// Note: some Photo values contain commas — that's fine; selection uses substring containment, not a
// naive comma split, so a multi-word value is treated as one chip.
const CATEGORIES = [
  { key: "aesthetics", label: "Aesthetics", chips: [
    "cinematic", "moody", "dreamy", "serene", "vintage", "minimalist", "surreal", "vibrant",
    "cozy", "dramatic", "ethereal", "nostalgic", "dark", "clean", "elegant",
  ] },
  { key: "lighting", label: "Lighting", chips: [
    "golden hour lighting", "blue hour evening light", "sunrise lighting", "sunset lighting",
    "soft diffused lighting", "hard directional lighting", "studio lighting (softbox)", "rim lighting",
    "backlit (silhouette effect)", "volumetric lighting (haze, rays)", "neon lighting", "candlelit",
    "moonlight", "overcast lighting", "high contrast lighting",
  ] },
  { key: "medium", label: "Medium", chips: [
    "photograph", "illustration", "graphic_design", "3d_render", "painting", "pencil_sketch",
    "pixel_art", "line_art", "concept_art", "infographic", "animation",
  ] },
  { key: "photo", label: "Photo (camera / lens)", chips: [
    "35mm lens, f/1.4", "50mm lens, f/1.8", "85mm lens, shallow depth of field", "24mm wide-angle, f/2.8",
    "200mm telephoto, f/2.8", "macro lens, extreme close-up", "drone aerial shot, high angle",
    "instant film photography (Polaroid)", "35mm motion-picture film still", "studio flash lighting, softbox",
    "black-and-white film (e.g. Kodak Tri-X)", "shallow depth of field, bokeh",
  ] },
  { key: "art_style", label: "Art Style", chips: [
    "flat vector illustration", "oil painting", "watercolor illustration", "pencil sketch illustration",
    "comic book style", "isometric illustration", "anime illustration", "low-poly 3D render",
    "hand-drawn doodles style", "retro-futuristic concept art", "flat graphic design style", "art deco style",
  ] },
];

const BLANK = () => ({ aesthetics: "", lighting: "", medium: "", photo: "", art_style: "" });

// Normalize a comma-joined field: collapse whitespace around commas, drop empty/duplicate items.
function normField(s) {
  const seen = new Set();
  return (s || "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .join(", ");
}
// Is `term` present in `field`? Whole-item match first (handles plain terms), substring fallback
// (handles chip values that themselves contain commas, e.g. "35mm lens, f/1.4").
function hasTerm(field, term) {
  const f = field || "", t = term.trim();
  if (!t) return false;
  if (f.split(",").some((x) => x.trim().toLowerCase() === t.toLowerCase())) return true;
  return f.toLowerCase().includes(t.toLowerCase());
}
// Toggle `term` in `field` (append when absent, remove when present), returning the normalized result.
function toggleTerm(field, term) {
  const t = term.trim();
  if (!t) return normField(field);
  if (hasTerm(field, t)) {
    // Remove the term as a whole comma-item where possible, else as a substring.
    const items = (field || "").split(",").map((x) => x.trim()).filter(Boolean);
    const kept = items.filter((x) => x.toLowerCase() !== t.toLowerCase());
    let out = kept.join(", ");
    if (kept.length === items.length) out = normField(out.replace(t, ""));   // comma-containing chip → substring strip
    return normField(out);
  }
  return normField((field ? field + ", " : "") + t);
}

function injectWizStyle() {
  if (document.getElementById("ai2go-wiz-style")) return;
  const s = document.createElement("style");
  s.id = "ai2go-wiz-style";
  s.textContent = `
    .ai2go-wiz-fs { position:fixed; inset:0; z-index:9200; background:rgba(0,0,0,0.72); display:flex; align-items:center; justify-content:center; }
    .ai2go-wiz-panel { position:relative; width:min(860px,92vw); max-height:90vh; display:flex; flex-direction:column; background:#1a1a1a; border:1px solid #444; border-radius:8px; box-shadow:0 12px 48px rgba(0,0,0,0.6); }
    .ai2go-wiz-head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid #333; font:13px sans-serif; color:#ddd; }
    .ai2go-wiz-title { flex:1 1 auto; font-weight:600; }
    .ai2go-wiz-body { flex:1 1 auto; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:14px; }
    .ai2go-wiz-cat { display:flex; flex-direction:column; gap:6px; }
    .ai2go-wiz-catlbl { font:11px sans-serif; color:#8fbfd6; letter-spacing:0.03em; text-transform:uppercase; }
    .ai2go-wiz-chips { display:flex; flex-wrap:wrap; gap:5px; }
    .ai2go-wiz-chip { background:#333; border:1px solid #555; border-radius:12px; color:#bbb; font:11px sans-serif; cursor:pointer; padding:2px 10px; line-height:17px; white-space:nowrap; }
    .ai2go-wiz-chip:hover { border-color:#46b4e6; color:#fff; }
    .ai2go-wiz-chip.active { border-color:#46b4e6; color:#46b4e6; background:#2a3a42; }
    .ai2go-wiz-input { width:100%; box-sizing:border-box; background:#1d1d1d; border:1px solid #444; border-radius:4px; color:#ddd; font:12px monospace; padding:4px 6px; }
    .ai2go-wiz-input:focus { border-color:#46b4e6; outline:none; color:#fff; }
    .ai2go-wiz-foot { flex:0 0 auto; padding:10px 14px; border-top:1px solid #333; display:flex; flex-direction:column; gap:8px; }
    .ai2go-wiz-warn { color:#e6a23c; font:11px sans-serif; min-height:14px; }
    .ai2go-wiz-prev { background:#141414; border:1px solid #333; border-radius:4px; color:#9fd29f; font:11px/1.4 monospace; padding:8px; margin:0; max-height:150px; overflow:auto; white-space:pre; }
    .ai2go-wiz-footrow { display:flex; align-items:center; gap:8px; }
    .ai2go-wiz-btn { background:#333; border:1px solid #555; border-radius:4px; color:#bbb; font:12px sans-serif; cursor:pointer; padding:4px 12px; }
    .ai2go-wiz-btn:hover { border-color:#46b4e6; color:#fff; }
    .ai2go-wiz-btn.primary { border-color:#46b4e6; color:#46b4e6; background:#2a3a42; }
    .ai2go-wiz-x { background:none; border:none; color:#999; cursor:pointer; font:16px sans-serif; line-height:1; padding:2px 6px; }
    .ai2go-wiz-x:hover { color:#fff; }
  `;
  document.head.appendChild(s);
}

// Assemble the style_description object in the builder's canonical key order, omitting blank fields.
function buildStyleDescription(wiz) {
  const a = wiz.aesthetics.trim(), l = wiz.lighting.trim(), m = wiz.medium.trim();
  const p = wiz.photo.trim(), ar = wiz.art_style.trim();
  const sd = {};
  if (a) sd.aesthetics = a;
  if (l) sd.lighting = l;
  if (p) {                              // photo mode: ...photo, medium...
    sd.photo = p;
    if (m) sd.medium = m;
  } else {                              // art / none: ...medium, art_style...
    if (m) sd.medium = m;
  }
  if (ar) sd.art_style = ar;            // shown even alongside photo (free-pick); the warning flags it
  return sd;
}

app.registerExtension({
  name: "AI2Go.Ideogram4StyleWizard",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "AI2GoIdeogram4StyleWizard") return;
    injectWizStyle();

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const wizWidget = node.widgets?.find((w) => w.name === "wizard_data");
      // Hide the persistence widget but keep it serializable (the proven prompt-builder pattern).
      if (wizWidget) { wizWidget.hidden = true; wizWidget.computeSize = () => [0, -4]; }
      const i = node.inputs?.findIndex((inp) => inp.name === "wizard_data");
      if (i != null && i !== -1) node.removeInput(i);

      node._wiz = BLANK();
      function hydrate() {
        node._wiz = BLANK();
        try {
          const v = JSON.parse(wizWidget?.value || "{}");
          if (v && typeof v === "object") for (const k of Object.keys(node._wiz)) if (typeof v[k] === "string") node._wiz[k] = v[k];
        } catch (e) {}
      }
      hydrate();

      function persist() {
        if (wizWidget) wizWidget.value = JSON.stringify(node._wiz);
        // Nudge ComfyUI to snapshot the change (same trick the prompt builder uses).
        window.dispatchEvent(new MouseEvent("mouseup"));
      }

      // Write the picked style fields into every connected Prompt Builder. `notify` controls the
      // "nothing connected" alert (shown only on an explicit Done click, not on Esc/backdrop close).
      function applyToBuilder(notify) {
        const links = node.outputs?.[0]?.links || [];
        let wrote = 0;
        for (const id of links) {
          const link = node.graph?.links?.get ? node.graph.links.get(id) : node.graph?.links?.[id];
          if (!link) continue;
          const target = node.graph.getNodeById(link.target_id);
          if (!target || target.type !== BUILDER_TYPE) continue;
          const set = (name, val) => {
            const w = target.widgets?.find((x) => x.name === name);
            if (w) { w.value = val; w.callback?.(val); }
          };
          const p = node._wiz.photo.trim(), ar = node._wiz.art_style.trim();
          const kind = p ? "photo" : (ar ? "art_style" : null);
          if (kind) {
            const styleW = target.widgets?.find((x) => x.name === "style");
            if (styleW) styleW.value = kind;                 // DynamicCombo setter rebuilds sub-widgets
            if (kind === "photo") set("style.photo", p); else set("style.art_style", ar);
          }
          set("aesthetics", node._wiz.aesthetics.trim());
          set("lighting", node._wiz.lighting.trim());
          set("medium", node._wiz.medium.trim());
          target.setDirtyCanvas?.(true, true);
          wrote++;
        }
        if (!wrote && notify) {
          window.alert("Wire this node's \"style\" output into an AI2Go Ideogram 4 Prompt Builder's \"import_json\" input, then reopen the wizard.");
        }
        return wrote;
      }
      node._wizApply = applyToBuilder;

      // ── modal ──
      function openModal() {
        if (node._wizOverlay) return;
        const ov = document.createElement("div"); ov.className = "ai2go-wiz-fs";
        const panel = document.createElement("div"); panel.className = "ai2go-wiz-panel";
        ov.appendChild(panel);

        const head = document.createElement("div"); head.className = "ai2go-wiz-head";
        const title = document.createElement("span"); title.className = "ai2go-wiz-title"; title.textContent = "Ideogram 4 Style Wizard";
        const xBtn = document.createElement("button"); xBtn.className = "ai2go-wiz-x"; xBtn.textContent = "✕"; xBtn.title = "Close (applies to the connected builder)";
        head.append(title, xBtn);

        const body = document.createElement("div"); body.className = "ai2go-wiz-body";
        const refreshers = [];   // per-category fns that re-sync chip highlight + input value from node._wiz

        for (const cat of CATEGORIES) {
          const block = document.createElement("div"); block.className = "ai2go-wiz-cat";
          const lbl = document.createElement("div"); lbl.className = "ai2go-wiz-catlbl"; lbl.textContent = cat.label;
          const chipsWrap = document.createElement("div"); chipsWrap.className = "ai2go-wiz-chips";
          const input = document.createElement("input");
          input.className = "ai2go-wiz-input"; input.type = "text";
          input.placeholder = "click chips above, or type your own (comma-separated)";
          input.value = node._wiz[cat.key];

          const chipEls = cat.chips.map((term) => {
            const c = document.createElement("button");
            c.className = "ai2go-wiz-chip"; c.textContent = term; c.title = term;
            c.addEventListener("click", () => {
              node._wiz[cat.key] = toggleTerm(node._wiz[cat.key], term);
              input.value = node._wiz[cat.key];
              syncCat(); persist(); updatePreview();
            });
            return { term, el: c };
          });
          chipEls.forEach((c) => chipsWrap.appendChild(c.el));

          input.addEventListener("input", () => {
            node._wiz[cat.key] = input.value;   // keep raw while typing; normalized on chip-toggle/apply
            syncChips(); persist(); updatePreview();
          });

          function syncChips() { for (const c of chipEls) c.el.classList.toggle("active", hasTerm(node._wiz[cat.key], c.term)); }
          function syncCat() { input.value = node._wiz[cat.key]; syncChips(); }
          syncChips();
          refreshers.push(syncCat);

          block.append(lbl, chipsWrap, input);
          body.appendChild(block);
        }

        const foot = document.createElement("div"); foot.className = "ai2go-wiz-foot";
        const warn = document.createElement("div"); warn.className = "ai2go-wiz-warn";
        const prev = document.createElement("pre"); prev.className = "ai2go-wiz-prev";
        const footRow = document.createElement("div"); footRow.className = "ai2go-wiz-footrow";
        const spacer = document.createElement("span"); spacer.style.flex = "1";
        const clearBtn = document.createElement("button"); clearBtn.className = "ai2go-wiz-btn"; clearBtn.textContent = "Clear all";
        const doneBtn = document.createElement("button"); doneBtn.className = "ai2go-wiz-btn primary"; doneBtn.textContent = "Apply to builder & close";
        footRow.append(spacer, clearBtn, doneBtn);
        foot.append(warn, prev, footRow);

        function updatePreview() {
          const sd = buildStyleDescription(node._wiz);
          prev.textContent = JSON.stringify({ style_description: sd }, null, 2);
          const both = node._wiz.photo.trim() && node._wiz.art_style.trim();
          warn.textContent = both
            ? "⚠ Ideogram allows only photo OR art_style — only photo will be applied to the builder."
            : "";
        }
        updatePreview();

        clearBtn.addEventListener("click", () => {
          node._wiz = BLANK();
          for (const r of refreshers) r();
          persist(); updatePreview();
        });

        let closed = false;
        function close(apply, notify) {
          if (closed) return; closed = true;
          if (apply) applyToBuilder(notify);
          document.removeEventListener("keydown", onEsc, true);
          ov.remove(); node._wizOverlay = null;
        }
        function onEsc(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true, false); } }

        doneBtn.addEventListener("click", () => close(true, true));
        xBtn.addEventListener("click", () => close(true, false));
        ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(true, false); });   // backdrop closes + applies
        document.addEventListener("keydown", onEsc, true);

        panel.append(head, body, foot);
        document.body.appendChild(ov);
        node._wizOverlay = ov;
      }
      node._wizOpen = openModal;

      node.addWidget("button", "🪄 Open Style Wizard", "", openModal);
    });

    // Re-hydrate after a saved workflow loads (widget value is restored before onConfigure fires).
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const wizWidget = this.widgets?.find((w) => w.name === "wizard_data");
      this._wiz = BLANK();
      try {
        const v = JSON.parse(wizWidget?.value || "{}");
        if (v && typeof v === "object") for (const k of Object.keys(this._wiz)) if (typeof v[k] === "string") this._wiz[k] = v[k];
      } catch (e) {}
    });

    // Tidy up an open modal if the node is removed.
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this._wizOverlay?.remove(); this._wizOverlay = null;
    });
  },
});
