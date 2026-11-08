"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";

const sample = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000000"/><path d="M150 82 H290 L366 158 V420 H150 Z" fill="#ffffff"/><path d="M290 82 V158 H366" fill="none" stroke="#000000" stroke-width="12" stroke-linejoin="round"/><path d="M205 236 H310 M205 280 H310 M205 324 H310" fill="none" stroke="#000000" stroke-width="18" stroke-linecap="round"/></svg>';

type Quality = { score: number; findings: Array<{ severity: string; code: string; message: string; recommendation: string }>; metrics: Record<string, number> };
type ElementSummary = { id: string; tag: string; fill: string | null; stroke: string | null; label: string };
type Variant = { style: string; svgMarkup: string; pngBase64: string; quality: Quality };
type Version = { svg: string; label: string; createdAt: number };

async function requestPipeline(operation: string, payload: Record<string, unknown> = {}) {
  const response = await fetch("/api/icons/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...payload })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Icon pipeline request failed.");
  return data;
}

function downloadBase64(base64: string, mime: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(text: string, mime: string, filename: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function IconMakerPage() {
  const [prompt, setPrompt] = useState("minimal white document icon with three equal horizontal lines on a pure black background");
  const [style, setStyle] = useState("minimal");
  const [size, setSize] = useState(512);
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [foregroundColor, setForegroundColor] = useState("#ffffff");
  const [accentColor, setAccentColor] = useState("#ffffff");
  const [svg, setSvg] = useState(sample);
  const [png, setPng] = useState("");
  const [quality, setQuality] = useState<Quality | null>(null);
  const [elements, setElements] = useState<ElementSummary[]>([]);
  const [selectedElement, setSelectedElement] = useState("");
  const [editFill, setEditFill] = useState("#ffffff");
  const [editStroke, setEditStroke] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [history, setHistory] = useState<Version[]>([{ svg: sample, label: "Starter", createdAt: 0 }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyReady, setHistoryReady] = useState(false);
  const [status, setStatus] = useState("Ready. Generate, import, edit or inspect an icon.");
  const [busy, setBusy] = useState(false);
  const [appName, setAppName] = useState("My App");
  const [packageName, setPackageName] = useState("com.example.app");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("flutter-foundry-icon-history-v1");
      if (saved) {
        const parsed = JSON.parse(saved) as Version[];
        if (Array.isArray(parsed) && parsed.length) {
          setHistory(parsed.slice(-30));
          setHistoryIndex(Math.min(parsed.length - 1, 29));
          setSvg(parsed[parsed.length - 1].svg);
        }
      }
    } catch { /* Ignore invalid or unavailable browser storage. */ }
    finally { setHistoryReady(true); }
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    try { localStorage.setItem("flutter-foundry-icon-history-v1", JSON.stringify(history.slice(-30))); }
    catch { setStatus("Browser storage is full; current edits remain available in this tab."); }
  }, [history, historyReady]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  function saveVersion(nextSvg: string, label: string) {
    const snapshot = { svg: nextSvg, label, createdAt: Date.now() };
    const prefix = history.slice(0, historyIndex + 1);
    const next = [...prefix, snapshot].slice(-30);
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setSvg(nextSvg);
  }

  function restoreVersion(index: number) {
    const version = history[index];
    if (!version) return;
    setHistoryIndex(index);
    setSvg(version.svg);
    setPng("");
    setQuality(null);
    setElements([]);
    setStatus("Restored version: " + version.label);
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(true);
    setStatus(label + "…");
    try { await task(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The icon operation failed."); }
    finally { setBusy(false); }
  }

  function generate() {
    return runTask("Generating SVG and PNG", async () => {
      const data = await requestPipeline("generate", { prompt, style, size, backgroundColor, foregroundColor, accentColor });
      saveVersion(data.svgMarkup, "Generated " + style);
      setPng(data.pngBase64);
      setQuality(data.quality);
      setElements(data.elements || []);
      setVariants([]);
      setStatus("Generated icon and PNG. Automated quality score: " + data.quality.score + "/100.");
    });
  }

  function createVariants() {
    return runTask("Creating style variants", async () => {
      const data = await requestPipeline("variants", { prompt, size, backgroundColor, foregroundColor, accentColor, styles: ["minimal", "geometric", "rounded", "outline"] });
      setVariants(data.variants || []);
      setStatus("Created " + (data.variants || []).length + " comparable variants.");
    });
  }

  function selectVariant(variant: Variant) {
    saveVersion(variant.svgMarkup, "Variant " + variant.style);
    setPng(variant.pngBase64);
    setQuality(variant.quality);
    setElements([]);
    setStatus("Selected the " + variant.style + " variant.");
  }

  function analyze() {
    return runTask("Analyzing and optimizing SVG", async () => {
      const data = await requestPipeline("analyze", { svgMarkup: svg });
      setSvg(data.svgMarkup);
      setQuality(data.quality);
      setElements(data.elements || []);
      setPng(data.pngBase64);
      setStatus("Analysis complete. SVG reduced by " + data.savedBytes + " bytes. Quality score: " + data.quality.score + "/100.");
    });
  }

  async function editSelected() {
    if (!selectedElement) { setStatus("Select an SVG element first."); return; }
    const attributes: Record<string, string> = {};
    if (editFill.trim()) attributes.fill = editFill.trim();
    if (editStroke.trim()) attributes.stroke = editStroke.trim();
    if (!Object.keys(attributes).length) { setStatus("Choose a fill or stroke color to apply."); return; }
    await runTask("Applying a targeted element edit", async () => {
      const data = await requestPipeline("edit", { svgMarkup: svg, operations: [{ id: selectedElement, action: "set-attributes", attributes }] });
      saveVersion(data.svgMarkup, "Edit " + selectedElement);
      setPng(data.pngBase64);
      setQuality(data.quality);
      setElements(data.elements || []);
      setStatus("Updated only " + selectedElement + "; other SVG elements were preserved.");
    });
  }

  async function importRaster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setStatus("Choose a PNG, JPEG or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setStatus("Image imports are limited to 5 MB."); return; }
    await runTask("Vectorizing imported image", async () => {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The selected image could not be read."));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
      const data = await requestPipeline("vectorize", { imageBase64, size: 48, colors: 6 });
      saveVersion(data.svgMarkup, "Imported and vectorized image");
      setPng(data.pngBase64);
      setQuality(data.quality);
      setElements(data.elements || []);
      setStatus(data.note);
    });
    event.target.value = "";
  }

  function editInSvgEdit() {
    return runTask("Opening SVG-Edit in Chromium", async () => {
      const response = await fetch("/api/icons/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ svg })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "SVG-Edit processing failed.");
      const analysis = await requestPipeline("analyze", { svgMarkup: data.svg });
      saveVersion(analysis.svgMarkup, "SVG-Edit round trip");
      setPng(data.previewPngBase64);
      setQuality(analysis.quality);
      setElements(analysis.elements || []);
      setStatus("SVG-Edit round trip completed in " + data.elapsedMs + " ms. The edited SVG was saved as a new version.");
    });
  }

  function exportBundle() {
    return runTask("Building Android and iOS icon bundle", async () => {
      const data = await requestPipeline("export", { svgMarkup: svg, appName, packageName });
      downloadBase64(data.zipBase64, "application/zip", "flutter-foundry-icon-pack.zip");
      setStatus("Exported " + data.fileCount + " files (" + Math.round(data.bytes / 1024) + " KB) for Android and iOS.");
    });
  }

  function undo() { if (canUndo) restoreVersion(historyIndex - 1); }
  function redo() { if (canRedo) restoreVersion(historyIndex + 1); }

  return (
    <section className="workspace">
      <div className="workspace-intro">
        <div className="eyebrow">Flutter Foundry · Icon Maker Pipeline</div>
        <h1 style={{ fontSize: "clamp(34px,6vw,58px)" }}>Icon Maker</h1>
        <p className="lead">Generate custom vector icons, compare styles, edit individual SVG elements, inspect quality and export complete Android and iOS icon packs.</p>
        <div className="actions">
          <a className="button" href="https://svgedit.netlify.app/index.html" target="_blank" rel="noreferrer">Open SVG-Edit ↗</a>
          <a className="button" href="https://github.com/SVG-Edit/svgedit" target="_blank" rel="noreferrer">SVG-Edit source ↗</a>
        </div>
      </div>

      <div className="workspace-grid">
        <section className="card">
          <h2>1. Generate</h2>
          <div className="field">
            <label htmlFor="icon-prompt">Describe the icon</label>
            <textarea id="icon-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={500} />
          </div>
          <div className="actions" style={{ flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 150px" }}>Style
              <select value={style} onChange={(event) => setStyle(event.target.value)} className="button">
                {["auto", "minimal", "geometric", "rounded", "outline", "pixel", "abstract"].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="field" style={{ flex: "1 1 120px" }}>PNG size
              <select value={size} onChange={(event) => setSize(Number(event.target.value))} className="button">
                {[128, 256, 512, 1024].map((item) => <option key={item} value={item}>{item} px</option>)}
              </select>
            </label>
          </div>
          <div className="actions" style={{ flexWrap: "wrap" }}>
            <label className="field">Background <input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /></label>
            <label className="field">Foreground <input type="color" value={foregroundColor} onChange={(event) => setForegroundColor(event.target.value)} /></label>
            <label className="field">Accent <input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></label>
          </div>
          <div className="actions">
            <button className="button primary" disabled={busy || prompt.trim().length < 3} onClick={generate}>{busy ? "Working…" : "Generate icon"}</button>
            <button className="button" disabled={busy} onClick={createVariants}>Create 4 variants</button>
          </div>
          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="raster-import">Import PNG, JPEG or WebP and convert to editable SVG</label>
            <input id="raster-import" type="file" accept="image/png,image/jpeg,image/webp" onChange={importRaster} />
            <p className="small">Raster conversion uses a limited-color, pixel-region trace. It works best for flat art and logos; detailed photographs will be simplified.</p>
          </div>
          <p className="status" aria-live="polite">{status}</p>
        </section>

        <section className="card">
          <h2>2. Preview and compare</h2>
          <p>See the exported icon inside common launcher masks and compare generated variants.</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", gap: 18, flexWrap: "wrap", margin: "20px 0" }}>
            {["circle", "squircle", "rounded"].map((mask) => (
              <div key={mask} style={{ textAlign: "center" }}>
                <div style={{ width: 112, height: 112, overflow: "hidden", borderRadius: mask === "circle" ? "50%" : mask === "squircle" ? "28%" : "18%", background: "#000", display: "grid", placeItems: "center", border: "1px solid #555" }}>
                  {png ? <Image alt="Current icon preview" src={"data:image/png;base64," + png} width={112} height={112} unoptimized style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ color: "#888", fontSize: 12 }}>Preview</span>}
                </div>
                <span className="small">{mask}</span>
              </div>
            ))}
          </div>
          <div className="actions">
            <button className="button" disabled={!png} onClick={() => downloadBase64(png, "image/png", "flutter-foundry-icon.png")}>Download PNG</button>
            <button className="button" onClick={() => downloadText(svg, "image/svg+xml;charset=utf-8", "flutter-foundry-icon.svg")}>Download SVG</button>
            <button className="button" disabled={busy} onClick={analyze}>Analyze current SVG</button>
          </div>
          {variants.length > 0 && <div style={{ marginTop: 22 }}>
            <h3>Style variants</h3>
            <div className="workspace-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
              {variants.map((variant) => <button key={variant.style} className="card" onClick={() => selectVariant(variant)} style={{ cursor: "pointer", textAlign: "center" }}>
                <Image alt={variant.style + " icon variant"} src={"data:image/png;base64," + variant.pngBase64} width={128} height={128} unoptimized style={{ width: "100%", maxWidth: 128, height: "auto" }} />
                <strong>{variant.style}</strong>
                <span className="small">Score {variant.quality.score}/100 · Select</span>
              </button>)}
            </div>
          </div>}
        </section>
      </div>

      <div className="workspace-grid" style={{ marginTop: 20 }}>
        <section className="card">
          <h2>3. Edit SVG elements</h2>
          <div className="field">
            <label htmlFor="svg-input">SVG source</label>
            <textarea id="svg-input" spellCheck={false} value={svg} onChange={(event) => setSvg(event.target.value)} style={{ minHeight: 300 }} />
          </div>
          <div className="actions" style={{ flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 200px" }}>Target element
              <select className="button" value={selectedElement} onChange={(event) => setSelectedElement(event.target.value)}>
                <option value="">Analyze SVG to list elements</option>
                {elements.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}
              </select>
            </label>
          </div>
          <div className="actions">
            <label className="field">New fill <input type="color" value={editFill} onChange={(event) => setEditFill(event.target.value)} /></label>
            <label className="field">New stroke <input type="color" value={editStroke || "#000000"} onChange={(event) => setEditStroke(event.target.value)} /></label>
            <button className="button primary" disabled={busy || !selectedElement} onClick={editSelected}>Apply to selected element</button>
          </div>
          <p className="small">Targeted edits only change the selected element. Unsupported or unsafe SVG attributes are rejected.</p>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="button" disabled={!canUndo || busy} onClick={undo}>Undo</button>
            <button className="button" disabled={!canRedo || busy} onClick={redo}>Redo</button>
            <button className="button" disabled={busy} onClick={editInSvgEdit}>Open in SVG-Edit</button>
            <button className="button" onClick={() => saveVersion(svg, "Manual checkpoint")}>Save version</button>
            <button className="button" onClick={() => { setSvg(sample); setPng(""); setQuality(null); setElements([]); saveVersion(sample, "Reset sample"); }}>Reset sample</button>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="versions">Saved versions (this browser)</label>
            <select id="versions" className="button" value={historyIndex} onChange={(event) => restoreVersion(Number(event.target.value))}>
              {history.map((version, index) => <option key={version.createdAt + "-" + index} value={index}>{index + 1}. {version.label}</option>)}
            </select>
          </div>
          <p className="small">Version history is stored locally in this browser, up to 30 snapshots. It is not uploaded to the server.</p>
        </section>

        <section className="card">
          <h2>4. Quality checks</h2>
          {quality ? <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <strong style={{ fontSize: 42 }}>{quality.score}</strong><span className="small">/ 100 automated heuristic score</span>
            </div>
            <p className="small">{quality.metrics.elementCount} elements · {quality.metrics.approximateColors} approximate colors · {Math.round(quality.metrics.artworkCoverage * 100)}% artwork bounding-box coverage</p>
            {quality.findings.map((finding) => <div key={finding.code} style={{ padding: "12px 0", borderTop: "1px solid #333" }}>
              <strong>{finding.severity.toUpperCase()}: {finding.message}</strong>
              <p className="small">{finding.recommendation}</p>
            </div>)}
            <p className="small">Automated checks are heuristics, not a substitute for reviewing the icon at actual launcher size on each target device.</p>
          </> : <p className="small">Generate an icon or choose Analyze current SVG to inspect margins, centering, aspect ratio, color complexity and SVG element count.</p>}
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>5. Export a complete icon pack</h2>
        <p>Build Android adaptive icons, monochrome VectorDrawable, legacy density PNGs, iOS AppIcon assets and extra PNG sizes in one ZIP.</p>
        <div className="actions" style={{ flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 200px" }}>App name <input value={appName} onChange={(event) => setAppName(event.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 240px" }}>Android package name <input value={packageName} onChange={(event) => setPackageName(event.target.value)} /></label>
          <button className="button primary" disabled={busy || !svg.trim()} onClick={exportBundle}>{busy ? "Preparing…" : "Export Android + iOS ZIP"}</button>
        </div>
        <p className="small">The Android VectorDrawable exporter supports paths and basic vector shapes. Gradients, masks, filters, text and unsupported transforms are reported instead of being silently flattened.</p>
      </section>
    </section>
  );
}
