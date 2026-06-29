/*
 * Part of ComfyUI-AI2Go-Utils.
 *
 * Front-end for the AI2Go Resolution Selector node. GPL-3.0, like the rest of the pack.
 *
 * Three modes (raw / auto / megapixel) compute a profile-valid width/height. The math mirrors
 * nodes/resolution_selector.py so the readout/UI and the INT outputs always agree. Edits auto-push the
 * dims into any connected node's width/height widgets and fire their callbacks — which, for the AI2Go
 * Ideogram 4 Prompt Builder, refreshes its editor canvas (same write pattern the Style Wizard uses).
 * A read-only readout shows the resulting WxH + megapixels and a profile-aware "clamped" warning. The
 * dims also flow normally on graph execution.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

// Per-profile rules — keep in sync with PROFILES in nodes/resolution_selector.py.
const PROFILES = { "Ideogram 4": { mult: 16, min: 256, max: 2048 } };
const DEFAULT_PROFILE = "Ideogram 4";

const parseAR = (s) => { const m = /^(\d+):(\d+)$/.exec(s || ""); return m ? (+m[1]) / (+m[2]) : 1; };
const snap = (v, p) => Math.min(p.max, Math.max(p.min, Math.round((Number(v) || 0) / p.mult) * p.mult));
// Largest width with aspect `ar` whose width AND height (=width/ar) both fit [min,max], aspect preserved —
// so hitting the per-side cap keeps the ratio (16:9 -> 2048x1152, not 2048x2048). Snapped to the multiple.
function fitW(tw, ar, p) {
  const wlo = Math.max(p.min, p.min * ar), whi = Math.min(p.max, p.max * ar);
  const w = snap(wlo > whi ? Math.min(p.max, Math.max(p.min, tw)) : Math.min(whi, Math.max(wlo, tw)), p);
  return [w, snap(w / ar, p)];
}

app.registerExtension({
  name: "AI2Go.ResolutionSelector",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "AI2GoResolutionSelector") return;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const findW = (n) => node.widgets?.find((w) => w.name === n);
      const profileWidget = findW("profile");
      const modeWidget = findW("resolution_mode");
      const arWidget = findW("aspect_ratio");
      const mpWidget = findW("megapixels");
      const wWidget = findW("width");
      const hWidget = findW("height");

      const prof = () => PROFILES[profileWidget?.value] || PROFILES[DEFAULT_PROFILE];
      const resMode = () => (modeWidget ? modeWidget.value : "raw");
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
        const mode = resMode(), p = prof();
        node._resCalc = true;
        let warn = false;
        try {
          if (mode === "raw") {                     // raw: literal sides, snapped + per-axis clamped
            const w = Number(wWidget.value) || 0, h = Number(hWidget.value) || 0;
            warn = w > p.max || h > p.max;
            wWidget.value = snap(w, p);
            hWidget.value = snap(h, p);
          } else {                                  // auto / megapixel: aspect-locked, ratio preserved at the cap
            const ar = parseAR(arWidget?.value);
            let tw;
            if (mode === "megapixel") tw = Math.sqrt(Math.max(0, parseFloat(mpWidget?.value) || 0) * 1e6 * ar);
            else if (driver === "h") tw = (Number(hWidget.value) || 0) * ar;   // auto, height edited
            else tw = Number(wWidget.value) || 0;                              // auto, width edited / ratio change
            warn = tw > p.max || (ar ? tw / ar : 0) > p.max;                   // ideal (aspect-correct) side exceeds the cap
            const [w, h] = fitW(tw, ar, p);
            wWidget.value = w;
            hWidget.value = h;
          }
        } finally { node._resCalc = false; node._resWarn = warn; }
      }

      function updateReadout() {
        if (!resLine) return;
        const d = currentDims(), p = prof();
        const mp = (d.w * d.h / 1e6).toFixed(2);
        resLine.textContent = `${d.w} × ${d.h}    ${mp} MP`;
        if (node._resWarn) {
          warnLine.textContent = `⚠ ${profileWidget?.value || "profile"} max ${p.max} × ${p.max} px — clamped to keep aspect`;
          warnLine.style.display = "";
        } else {
          warnLine.style.display = "none";
        }
      }

      // Show/hide the mode-relevant widgets, then relayout the node.
      function applyVisibility() {
        const mode = resMode();
        setWidgetVisible(arWidget, mode !== "raw");
        setWidgetVisible(mpWidget, mode === "megapixel");
        setWidgetVisible(wWidget, mode !== "megapixel");
        setWidgetVisible(hWidget, mode !== "megapixel");
        if (node.computeSize) node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas?.(true, true);
      }

      // Push the current dims into every node wired to the width/height outputs (slot 0 = width,
      // 1 = height). Setting the target widget + calling its callback is what refreshes a connected
      // Prompt Builder's canvas. Returns the number of target nodes touched.
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

      // ── Read-only output readout (added last → sits under width/height). Shows the resulting WxH +
      // megapixels, plus a profile-aware warning when the request was clamped to the profile's max. ──
      const readoutEl = document.createElement("div");
      readoutEl.style.cssText = "width:100%;box-sizing:border-box;padding:2px 4px;text-align:center;line-height:1.45;";
      const resLine = document.createElement("div");
      resLine.style.cssText = "font:bold 13px monospace;color:#46b4e6;";
      const warnLine = document.createElement("div");
      warnLine.style.cssText = "color:#e0a020;font:10px sans-serif;display:none;";
      readoutEl.append(resLine, warnLine);
      node.addDOMWidget("output_resolution", "info", readoutEl, { serialize: false });

      // ── wire widget callbacks (auto-push live so a connected canvas tracks edits) ──
      if (profileWidget) chainCallback(profileWidget, "callback", () => refresh("w", true));
      if (modeWidget) chainCallback(modeWidget, "callback", () => { applyVisibility(); refresh("w", true); });
      if (arWidget) chainCallback(arWidget, "callback", () => { if (resMode() !== "raw") refresh("w", true); });
      if (mpWidget) chainCallback(mpWidget, "callback", () => { if (resMode() === "megapixel") refresh(undefined, true); });
      if (wWidget) chainCallback(wWidget, "callback", () => { if (!node._resCalc) refresh("w", true); });
      if (hWidget) chainCallback(hWidget, "callback", () => { if (!node._resCalc) refresh("h", true); });

      // No Apply button — push to a freshly-connected downstream node so its canvas reflects right away.
      chainCallback(node, "onConnectionsChange", function () { requestAnimationFrame(() => pushToTargets()); });

      // Apply the current mode (visibility + recompute + readout). Exposed so onConfigure can reuse it.
      node._resApply = () => { applyVisibility(); recalcDims("w"); updateReadout(); };
      // Initial layout (deferred so size settles): hide the irrelevant widgets, fill the readout.
      requestAnimationFrame(node._resApply);
    });

    // Re-apply mode visibility + relabel after a saved workflow loads (widget values restored first).
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const node = this;
      requestAnimationFrame(() => { node._resApply?.(); });
    });
  },
});
