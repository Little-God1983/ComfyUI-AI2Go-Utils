/*
 * Part of ComfyUI-AI2Go-Utils.
 *
 * Front-end for the AI2Go Resolution Selector node. GPL-3.0, like the rest of the pack.
 *
 * Three modes (raw / auto / megapixel) compute a profile-valid width/height. The math mirrors
 * nodes/resolution_core.py so the readout/UI and the INT outputs always agree. A landscape-only
 * aspect list + a "⟷" flip button (orientation) cover both orientations without duplicate entries.
 * Edits auto-push the dims into any connected node's width/height widgets and fire their callbacks —
 * which, for the AI2Go Ideogram 4 Prompt Builder, refreshes its editor canvas.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

// A profile whose max == BIG has no real cap -> never shows the "clamped" warning.
const BIG = 16384;
// Keep in sync with PROFILES in nodes/resolution_core.py. mult null = use the snap_multiple widget.
const PROFILES = {
  "default":    { mult: null, min: 1,   max: BIG },
  "Ideogram 4": { mult: 16,   min: 256, max: 2048 },
};
const DEFAULT_PROFILE = "default";

// (ratio, name) — square + landscape only. Keep in sync with ASPECT_PRESETS in resolution_core.py.
const ASPECT_PRESETS = [
  ["1:1", "Square"], ["5:4", "Large Format"], ["4:3", "Standard"], ["3:2", "Photo"],
  ["16:10", "Monitor"], ["16:9", "Widescreen"], ["2:1", "Panorama"], ["21:9", "Cinemascope"],
  ["3:1", "Wide Panorama"],
];
const aspectLabel = (r, n) => `${r} (${n})`;

const parseAR = (s) => { const m = /^\s*(\d+)\s*:\s*(\d+)/.exec(String(s || "")); return m && +m[2] ? (+m[1]) / (+m[2]) : 1; };
const effAR = (aspect, orient) => { const ar = parseAR(aspect); return (orient === "portrait" && ar) ? 1 / ar : ar; };
const profClamps = (name) => (PROFILES[name] || PROFILES[DEFAULT_PROFILE]).max < BIG;
function effRules(name, snapMult) {
  const p = PROFILES[name] || PROFILES[DEFAULT_PROFILE];
  const mult = p.mult ? p.mult : Math.max(1, parseInt(snapMult, 10) || 1);
  return { mult, min: p.min, max: p.max };
}
const snap = (v, p) => Math.min(p.max, Math.max(p.min, Math.round((Number(v) || 0) / p.mult) * p.mult));
function fitW(tw, ar, p) {
  const wlo = Math.max(p.min, p.min * ar), whi = Math.min(p.max, p.max * ar);
  const w = snap(wlo > whi ? Math.min(p.max, Math.max(p.min, tw)) : Math.min(whi, Math.max(wlo, tw)), p);
  return [w, snap(ar ? w / ar : w, p)];
}

app.registerExtension({
  name: "AI2Go.ResolutionSelector",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "AI2GoResolutionSelector") return;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const findW = (n) => node.widgets?.find((w) => w.name === n);
      const profileWidget = findW("profile");
      const snapWidget = findW("snap_multiple");
      const modeWidget = findW("resolution_mode");
      const arWidget = findW("aspect_ratio");
      const orientWidget = findW("orientation");
      const mpWidget = findW("megapixels");
      const wWidget = findW("width");
      const hWidget = findW("height");

      const resMode = () => (modeWidget ? modeWidget.value : "raw");
      const profName = () => profileWidget?.value || DEFAULT_PROFILE;
      const orient = () => (orientWidget?.value === "portrait" ? "portrait" : "landscape");
      const currentDims = () => ({ w: parseInt(wWidget?.value, 10) || 0, h: parseInt(hWidget?.value, 10) || 0 });

      // Toggle a native widget's visibility while keeping it serializable (the proven prompt-builder
      // trick): saved computeSize is restored on show, [0,-4] collapses it on hide.
      function setWidgetVisible(w, vis) {
        if (!w) return;
        if (!vis) {
          if (!w._resHidden) { w._resPrevCompute = w.computeSize; w._resHidden = true; }
          w.hidden = true;
          w.computeSize = () => [0, -4];
        } else if (w._resHidden) {
          w.hidden = false;
          w.computeSize = w._resPrevCompute;
          w._resHidden = false;
        }
      }

      // Recompute width/height for the active mode, snapping/clamping to the profile. `driver` is the
      // side the user just edited in auto mode ("w"|"h"). Re-entrancy guarded.
      function recalcDims(driver) {
        if (node._resCalc || !wWidget || !hWidget) return;
        const mode = resMode(), p = effRules(profName(), snapWidget?.value), clamps = profClamps(profName());
        node._resCalc = true;
        let warn = false;
        try {
          if (mode === "raw") {                     // raw: literal sides, snapped + per-axis clamped
            const w = Number(wWidget.value) || 0, h = Number(hWidget.value) || 0;
            warn = clamps && (w > p.max || h > p.max);
            wWidget.value = snap(w, p);
            hWidget.value = snap(h, p);
          } else {                                  // auto / megapixel: aspect-locked, ratio preserved at cap
            const ar = effAR(arWidget?.value, orient());
            let tw;
            if (mode === "megapixel") tw = Math.sqrt(Math.max(0, parseFloat(mpWidget?.value) || 0) * 1e6 * ar);
            else if (driver === "h") tw = (Number(hWidget.value) || 0) * ar;   // auto, height edited
            else tw = Number(wWidget.value) || 0;                              // auto, width edited / ratio change
            warn = clamps && (tw > p.max || (ar ? tw / ar : 0) > p.max);       // ideal side exceeds the cap
            const [w, h] = fitW(tw, ar, p);
            wWidget.value = w;
            hWidget.value = h;
          }
        } finally { node._resCalc = false; node._resWarn = warn; }
      }

      function updateReadout() {
        if (!resLine) return;
        const d = currentDims(), p = effRules(profName(), snapWidget?.value);
        const mp = (d.w * d.h / 1e6).toFixed(2);
        let suffix = "";
        if (resMode() !== "raw") {                  // show the effective ratio + orientation
          const m = /(\d+)\s*:\s*(\d+)/.exec(arWidget?.value || "");
          if (m) {
            const a = +m[1], b = +m[2];
            if (a === b) suffix = `    ·    ${a}:${b} Square`;
            else if (orient() === "portrait") suffix = `    ·    ${b}:${a} Portrait`;
            else suffix = `    ·    ${a}:${b} Landscape`;
          }
        }
        resLine.textContent = `${d.w} × ${d.h}    ${mp} MP${suffix}`;
        if (node._resWarn) {
          warnLine.textContent = `⚠ ${profName()} max ${p.max} × ${p.max} px — clamped to keep aspect`;
          warnLine.style.display = "";
        } else {
          warnLine.style.display = "none";
        }
      }

      // Show/hide the mode-relevant widgets (snap_multiple only for the default profile; orientation
      // is always hidden — driven by the flip button), then relayout the node.
      function applyVisibility() {
        const mode = resMode();
        setWidgetVisible(arWidget, mode !== "raw");
        setWidgetVisible(mpWidget, mode === "megapixel");
        setWidgetVisible(wWidget, mode !== "megapixel");
        setWidgetVisible(hWidget, mode !== "megapixel");
        setWidgetVisible(snapWidget, profName() === DEFAULT_PROFILE);
        setWidgetVisible(orientWidget, false);
        if (node.computeSize) node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas?.(true, true);
      }

      // Push the current dims into every node wired to the width/height outputs (slot 0 = width,
      // 1 = height). Returns the number of target nodes touched.
      function pushToTargets() {
        if (!node.graph) return 0;
        const d = currentDims();
        const links = node.graph.links;
        const getLink = (id) => (links?.get ? links.get(id) : links?.[id]);
        const touched = new Set();
        (node.outputs || []).forEach((out, slot) => {
          const val = slot === 1 ? d.h : d.w;
          for (const id of (out.links || [])) {
            const link = getLink(id);
            if (!link) continue;
            const tgt = node.graph.getNodeById(link.target_id);
            if (!tgt) continue;
            const inp = tgt.inputs?.[link.target_slot];
            const tw = inp && tgt.widgets?.find((x) => x.name === inp.name);
            if (tw) { tw.value = val; tw.callback?.(val); }
            touched.add(tgt);
          }
        });
        for (const t of touched) t.setDirtyCanvas?.(true, true);
        return touched.size;
      }

      // Recompute + relabel; optionally push live to connected canvases.
      function refresh(driver, push) {
        recalcDims(driver);
        updateReadout();
        if (push) pushToTargets();
        node.setDirtyCanvas?.(true, true);
      }

      const flipLabel = () => `⟷ Orientation: ${orient() === "portrait" ? "Portrait" : "Landscape"}`;
      // Flip toggles orientation AND swaps the current width/height, then recomputes. In raw mode
      // (no aspect) the swap alone rotates the size; in auto/megapixel the inverted ratio drives it.
      function doFlip() {
        if (orientWidget) orientWidget.value = orient() === "portrait" ? "landscape" : "portrait";
        if (wWidget && hWidget) { const t = wWidget.value; wWidget.value = hWidget.value; hWidget.value = t; }
        if (flipBtn) flipBtn.name = flipLabel();
        refresh("w", true);
      }

      // On load, remap an old/bare aspect value ("16:9", or an old portrait "9:16") to a current
      // landscape label + orientation, so pre-change workflows don't reset to the default.
      function remapAspectOnLoad() {
        if (!arWidget) return;
        const opts = arWidget.options?.values || [];
        const v = String(arWidget.value ?? "");
        if (!opts.includes(v)) {
          const m = /(\d+)\s*:\s*(\d+)/.exec(v);
          if (m) {
            let a = +m[1], b = +m[2], portrait = false;
            if (a < b) { const t = a; a = b; b = t; portrait = true; }   // old portrait -> landscape base
            const preset = ASPECT_PRESETS.find(([r]) => r === `${a}:${b}`);
            if (preset) {
              arWidget.value = aspectLabel(preset[0], preset[1]);
              if (portrait && orientWidget) orientWidget.value = "portrait";
            }
          }
        }
        if (flipBtn) flipBtn.name = flipLabel();
      }

      // ── Read-only output readout (added last → sits under the flip button). ──
      const readoutEl = document.createElement("div");
      readoutEl.style.cssText = "width:100%;box-sizing:border-box;padding:2px 4px;text-align:center;line-height:1.45;";
      const resLine = document.createElement("div");
      resLine.style.cssText = "font:bold 13px monospace;color:#46b4e6;";
      const warnLine = document.createElement("div");
      warnLine.style.cssText = "color:#e0a020;font:10px sans-serif;display:none;";
      readoutEl.append(resLine, warnLine);

      // ── flip button (native, non-serialized) then the readout DOM widget ──
      const flipBtn = node.addWidget("button", flipLabel(), null, doFlip, { serialize: false });
      node.addDOMWidget("output_resolution", "info", readoutEl, { serialize: false });

      // ── wire widget callbacks (auto-push live so a connected canvas tracks edits) ──
      if (profileWidget) chainCallback(profileWidget, "callback", () => { applyVisibility(); refresh("w", true); });
      if (snapWidget) chainCallback(snapWidget, "callback", () => refresh("w", true));
      if (modeWidget) chainCallback(modeWidget, "callback", () => { applyVisibility(); refresh("w", true); });
      if (arWidget) chainCallback(arWidget, "callback", () => { if (resMode() !== "raw") refresh("w", true); });
      if (mpWidget) chainCallback(mpWidget, "callback", () => { if (resMode() === "megapixel") refresh(undefined, true); });
      if (wWidget) chainCallback(wWidget, "callback", () => { if (!node._resCalc) refresh("w", true); });
      if (hWidget) chainCallback(hWidget, "callback", () => { if (!node._resCalc) refresh("h", true); });

      // Push to a freshly-connected downstream node so its canvas reflects right away.
      chainCallback(node, "onConnectionsChange", function () { requestAnimationFrame(() => pushToTargets()); });

      // Apply the current state (remap on load + visibility + recompute + readout). Reused by onConfigure.
      node._resApply = () => { remapAspectOnLoad(); applyVisibility(); recalcDims("w"); updateReadout(); };
      requestAnimationFrame(node._resApply);
    });

    // Re-apply after a saved workflow loads (widget values restored first).
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const node = this;
      requestAnimationFrame(() => { node._resApply?.(); });
    });
  },
});
