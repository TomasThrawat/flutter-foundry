"use client";

import Image from "next/image";
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

const sample =
	'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000000"/><path d="M150 82 H290 L366 158 V420 H150 Z" fill="#ffffff"/><path d="M290 82 V158 H366" fill="none" stroke="#000000" stroke-width="12" stroke-linejoin="round"/><path d="M205 236 H310 M205 280 H310 M205 324 H310" fill="none" stroke="#000000" stroke-width="18" stroke-linecap="round"/></svg>';

type Quality = {
	score: number;
	findings: Array<{
		severity: string;
		code: string;
		message: string;
		recommendation: string;
	}>;
	metrics: Record<string, number | null> & {
		elementCount: number;
		approximateColors: number;
		artworkCoverage: number;
	};
};
type ElementSummary = {
	id: string;
	tag: string;
	fill: string | null;
	stroke: string | null;
	label: string;
};
type Variant = {
	style: string;
	svgMarkup: string;
	pngBase64: string;
	quality: Quality;
};
type Version = { svg: string; label: string; createdAt: number };

const HISTORY_STORAGE_KEY = "flutter-foundry-icon-history-v1";
const HISTORY_CHANGE_EVENT = "flutter-foundry-icon-history-change";
let fallbackHistorySnapshot = "[]";

function getHistorySnapshot(): string {
	if (typeof window === "undefined") return "[]";
	try {
		return (
			window.localStorage.getItem(HISTORY_STORAGE_KEY) ??
			fallbackHistorySnapshot
		);
	} catch {
		return fallbackHistorySnapshot;
	}
}

function getServerHistorySnapshot(): string {
	return "[]";
}

function subscribeToHistory(onStoreChange: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	window.addEventListener("storage", onStoreChange);
	window.addEventListener(HISTORY_CHANGE_EVENT, onStoreChange);
	return () => {
		window.removeEventListener("storage", onStoreChange);
		window.removeEventListener(HISTORY_CHANGE_EVENT, onStoreChange);
	};
}

function writeHistorySnapshot(versions: Version[]): boolean {
	const snapshot = JSON.stringify(versions.slice(-30));
	fallbackHistorySnapshot = snapshot;
	let stored = true;
	try {
		window.localStorage.setItem(HISTORY_STORAGE_KEY, snapshot);
	} catch {
		stored = false;
	}
	window.dispatchEvent(new Event(HISTORY_CHANGE_EVENT));
	return stored;
}

function parseHistorySnapshot(snapshot: string): Version[] {
	try {
		const parsed = JSON.parse(snapshot) as Version[];
		if (
			Array.isArray(parsed) &&
			parsed.length &&
			parsed.every(
				(item) =>
					typeof item.svg === "string" &&
					typeof item.label === "string" &&
					typeof item.createdAt === "number",
			)
		) {
			return parsed.slice(-30);
		}
	} catch {
		/* Invalid browser data falls back to the starter icon. */
	}
	return [{ svg: sample, label: "Starter", createdAt: 0 }];
}

async function requestPipeline(
	operation: string,
	payload: Record<string, unknown> = {},
	signal?: AbortSignal,
) {
	const response = await fetch("/api/icons/pipeline", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ operation, ...payload }),
		signal,
	});
	if (operation === "export") {
		if (!response.ok) {
			let message = "Icon pipeline request failed.";
			try {
				const error = await response.json();
				message = error.error || message;
			} catch {
				/* Keep the generic service error when the response is not JSON. */
			}
			throw new Error(message);
		}
		return {
			blob: await response.blob(),
			fileCount: Number(response.headers.get("x-icon-file-count")) || 0,
			bytes: Number(response.headers.get("x-icon-bytes")) || 0,
		};
	}
	let data: Awaited<ReturnType<typeof response.json>>;
	try {
		data = await response.json();
	} catch {
		throw new Error("The icon service returned an unreadable response.");
	}
	if (!response.ok)
		throw new Error(data.error || "Icon pipeline request failed.");
	return data;
}

async function downloadBase64(base64: string, mime: string, filename: string) {
	// Let the browser decode large base64 responses natively instead of looping over every byte on the UI thread.
	const response = await fetch("data:" + mime + ";base64," + base64);
	if (!response.ok)
		throw new Error("The generated download could not be decoded.");
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBlob(blob: Blob, filename: string) {
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
	const [prompt, setPrompt] = useState(
		"minimal white document icon with three equal horizontal lines on a pure black background",
	);
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
	const [editStroke, setEditStroke] = useState("#000000");
	const [applyFill, setApplyFill] = useState(false);
	const [applyStroke, setApplyStroke] = useState(false);
	const [editOpacity, setEditOpacity] = useState("");
	const [editStrokeWidth, setEditStrokeWidth] = useState("");
	const [translateX, setTranslateX] = useState("");
	const [translateY, setTranslateY] = useState("");
	const [editScale, setEditScale] = useState("");
	const [editRotation, setEditRotation] = useState("");
	const [newElementTag, setNewElementTag] = useState("circle");
	const [iosBackgroundColor, setIosBackgroundColor] = useState("#000000");
	const activeAbortController = useRef<AbortController | null>(null);
	const [variants, setVariants] = useState<Variant[]>([]);
	const historySnapshot = useSyncExternalStore(
		subscribeToHistory,
		getHistorySnapshot,
		getServerHistorySnapshot,
	);
	const history = useMemo(
		() => parseHistorySnapshot(historySnapshot),
		[historySnapshot],
	);
	const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<
		number | null
	>(null);
	const historyIndex = selectedHistoryIndex ?? history.length - 1;
	const [status, setStatus] = useState(
		"Ready. Generate, import, edit or inspect an icon.",
	);
	const [busy, setBusy] = useState(false);
	const [appName, setAppName] = useState("My App");
	const [packageName, setPackageName] = useState("com.example.app");

	const canUndo = historyIndex > 0;
	const canRedo = historyIndex < history.length - 1;

	function saveVersion(
		nextSvg: string,
		label: string,
		preserveVariants = false,
	) {
		const snapshot = {
			svg: nextSvg,
			label,
			createdAt: (history[history.length - 1]?.createdAt ?? 0) + 1,
		};
		const prefix = history.slice(0, historyIndex + 1);
		const next = [...prefix, snapshot].slice(-30);
		const stored = writeHistorySnapshot(next);
		setSelectedHistoryIndex(next.length - 1);
		setSvg(nextSvg);
		if (!preserveVariants) setVariants([]);
		if (!stored)
			setStatus(
				"Browser storage is unavailable; version history is kept in memory for this tab.",
			);
	}

	function restoreVersion(index: number) {
		const version = history[index];
		if (!version) return;
		setSelectedHistoryIndex(index);
		setSelectedElement("");
		setSvg(version.svg);
		setPng("");
		setQuality(null);
		setElements([]);
		setVariants([]);
		setStatus("Restored version: " + version.label);
	}

	function cancelTask() {
		activeAbortController.current?.abort();
	}

	async function runTask(
		label: string,
		task: (signal: AbortSignal) => Promise<void>,
	) {
		const controller = new AbortController();
		activeAbortController.current = controller;
		setBusy(true);
		setStatus(label + "…");
		const timeout = window.setTimeout(() => {
			controller.abort(
				new DOMException(
					"The operation timed out after 65 seconds.",
					"TimeoutError",
				),
			);
		}, 65_000);
		try {
			await task(controller.signal);
		} catch (error) {
			const reason = controller.signal.reason;
			if (reason instanceof DOMException && reason.name === "TimeoutError") {
				setStatus(reason.message);
			} else if (
				controller.signal.aborted ||
				(error instanceof DOMException && error.name === "AbortError")
			) {
				setStatus("Operation cancelled.");
			} else {
				setStatus(
					error instanceof Error ? error.message : "The icon operation failed.",
				);
			}
		} finally {
			window.clearTimeout(timeout);
			if (activeAbortController.current === controller)
				activeAbortController.current = null;
			setBusy(false);
		}
	}

	function updateSvgDraft(value: string) {
		setSvg(value);
		setPng("");
		setQuality(null);
		setElements([]);
		setSelectedElement("");
		setVariants([]);
	}

	function generate() {
		return runTask("Generating SVG and PNG", async (signal) => {
			const data = await requestPipeline(
				"generate",
				{
					prompt,
					style,
					size,
					backgroundColor,
					foregroundColor,
					accentColor,
				},
				signal,
			);
			saveVersion(data.svgMarkup, "Generated " + style);
			setSelectedElement("");
			setPng(data.pngBase64);
			setQuality(data.quality);
			setElements(data.elements || []);
			setVariants([]);
			setStatus(
				"Generated icon and PNG. Automated quality score: " +
					data.quality.score +
					"/100.",
			);
		});
	}

	function createVariants() {
		return runTask("Creating style variants", async (signal) => {
			const data = await requestPipeline(
				"variants",
				{
					prompt,
					size,
					backgroundColor,
					foregroundColor,
					accentColor,
					styles: ["minimal", "geometric", "rounded", "outline"],
				},
				signal,
			);
			setVariants(data.variants || []);
			setStatus(
				"Created " + (data.variants || []).length + " comparable variants.",
			);
		});
	}

	function selectVariant(variant: Variant) {
		saveVersion(variant.svgMarkup, "Variant " + variant.style, true);
		setSelectedElement("");
		setPng(variant.pngBase64);
		setQuality(variant.quality);
		setElements([]);
		setStatus("Selected the " + variant.style + " variant.");
	}

	function analyze() {
		return runTask("Analyzing and optimizing SVG", async (signal) => {
			const data = await requestPipeline("analyze", { svgMarkup: svg }, signal);
			setSvg(data.svgMarkup);
			setSelectedElement("");
			setQuality(data.quality);
			setElements(data.elements || []);
			setPng(data.pngBase64);
			setStatus(
				"Analysis complete. SVG reduced by " +
					data.savedBytes +
					" bytes. Quality score: " +
					data.quality.score +
					"/100.",
			);
		});
	}

	async function applyElementOperations(
		operations: Array<Record<string, unknown>>,
		label: string,
	) {
		await runTask(label, async (signal) => {
			const data = await requestPipeline(
				"edit",
				{ svgMarkup: svg, operations },
				signal,
			);
			saveVersion(data.svgMarkup, label);
			setPng(String(data.pngBase64 || ""));
			setQuality(data.quality as Quality);
			setElements((data.elements || []) as ElementSummary[]);
			setSelectedElement("");
			setVariants([]);
			setStatus(
				label + " completed. The SVG preview and element list were refreshed.",
			);
		});
	}

	async function editSelected() {
		if (!selectedElement) {
			setStatus("Select an SVG element first.");
			return;
		}
		const attributes: Record<string, string> = {};
		if (applyFill && editFill.trim()) attributes.fill = editFill.trim();
		if (applyStroke && editStroke.trim()) attributes.stroke = editStroke.trim();
		if (editOpacity.trim()) attributes.opacity = editOpacity.trim();
		if (editStrokeWidth.trim())
			attributes["stroke-width"] = editStrokeWidth.trim();
		const hasTransform = [translateX, translateY, editScale, editRotation].some(
			(value) => value.trim(),
		);
		if (hasTransform) {
			const x = Number(translateX || 0);
			const y = Number(translateY || 0);
			const scale = Number(editScale || 1);
			const rotation = Number(editRotation || 0);
			if (![x, y, scale, rotation].every(Number.isFinite) || scale <= 0) {
				setStatus(
					"Enter valid transform values. Scale must be greater than zero.",
				);
				return;
			}
			attributes.transform =
				"translate(" +
				x +
				" " +
				y +
				") scale(" +
				scale +
				") rotate(" +
				rotation +
				" 256 256)";
		}
		if (!Object.keys(attributes).length) {
			setStatus("Choose at least one property to apply.");
			return;
		}
		await applyElementOperations(
			[{ id: selectedElement, action: "set-attributes", attributes }],
			"Edit " + selectedElement,
		);
	}

	async function removeSelectedElement() {
		if (!selectedElement) return;
		await applyElementOperations(
			[{ id: selectedElement, action: "remove-element" }],
			"Delete " + selectedElement,
		);
	}

	async function removeSelectedAttribute(attribute: "fill" | "stroke") {
		if (!selectedElement) return;
		await applyElementOperations(
			[
				{
					id: selectedElement,
					action: "remove-attributes",
					attributes: [attribute],
				},
			],
			"Remove " + attribute + " from " + selectedElement,
		);
	}

	async function addShape() {
		const usedIds = new Set(elements.map((element) => element.id));
		for (const match of svg.match(/\bid=["'][^"']+["']/g) || []) {
			const id = match.match(/^[^=]+=["']([^"']+)["']$/)?.[1];
			if (id) usedIds.add(id);
		}
		let sequence = 1;
		while (usedIds.has("ff-added-" + sequence)) sequence++;
		const id = "ff-added-" + sequence;
		const attributes: Record<string, string> = {};
		if (newElementTag === "circle") {
			Object.assign(attributes, {
				cx: "256",
				cy: "256",
				r: "72",
				fill: editFill,
			});
		} else if (newElementTag === "rect") {
			Object.assign(attributes, {
				x: "160",
				y: "160",
				width: "192",
				height: "192",
				rx: "24",
				fill: editFill,
			});
		} else if (newElementTag === "line") {
			Object.assign(attributes, {
				x1: "112",
				y1: "256",
				x2: "400",
				y2: "256",
				fill: "none",
				stroke: editStroke || editFill,
				"stroke-width": editStrokeWidth || "16",
				"stroke-linecap": "round",
			});
		} else {
			Object.assign(attributes, {
				d: "M256 112 L400 400 H112 Z",
				fill: editFill,
			});
		}
		if (editOpacity.trim()) attributes.opacity = editOpacity.trim();
		await applyElementOperations(
			[{ id, action: "add-element", tag: newElementTag, attributes }],
			"Add " + newElementTag,
		);
	}

	async function importRaster(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
			setStatus("Choose a PNG, JPEG or WebP image.");
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			setStatus("Image imports are limited to 5 MB.");
			return;
		}
		await runTask("Vectorizing imported image", async (signal) => {
			const imageBase64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () =>
					reject(new Error("The selected image could not be read."));
				reader.onload = () => resolve(String(reader.result || ""));
				reader.readAsDataURL(file);
			});
			const data = await requestPipeline(
				"vectorize",
				{
					imageBase64,
					size: 48,
					colors: 6,
				},
				signal,
			);
			saveVersion(data.svgMarkup, "Imported and vectorized image");
			setSelectedElement("");
			setPng(data.pngBase64);
			setQuality(data.quality);
			setElements(data.elements || []);
			setStatus(data.note);
		});
		event.target.value = "";
	}

	function editInSvgEdit() {
		return runTask("Checking the SVG-Edit round trip", async (signal) => {
			const response = await fetch("/api/icons/edit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ svg }),
				signal,
			});
			const data = await response.json();
			if (!response.ok)
				throw new Error(data.error || "SVG-Edit processing failed.");
			const analysis = await requestPipeline(
				"analyze",
				{
					svgMarkup: data.svg,
				},
				signal,
			);
			saveVersion(analysis.svgMarkup, "SVG-Edit round trip");
			setSelectedElement("");
			setPng(data.previewPngBase64);
			setQuality(analysis.quality);
			setElements(analysis.elements || []);
			setStatus(
				"SVG-Edit compatibility round trip completed in " +
					data.elapsedMs +
					" ms. The edited SVG was saved as a new version.",
			);
		});
	}

	function exportBundle() {
		return runTask(
			"Building Android, iOS and Flutter icon bundle",
			async (signal) => {
				const data = await requestPipeline(
					"export",
					{
						svgMarkup: svg,
						appName,
						packageName,
						iosBackgroundColor,
					},
					signal,
				);
				downloadBlob(data.blob, "flutter-foundry-icon-pack.zip");
				setStatus(
					"Exported " +
						data.fileCount +
						" files (" +
						Math.round(data.bytes / 1024) +
						" KB) for Android, iOS and Flutter.",
				);
			},
		);
	}

	function undo() {
		if (canUndo) restoreVersion(historyIndex - 1);
	}
	function redo() {
		if (canRedo) restoreVersion(historyIndex + 1);
	}

	return (
		<section className="workspace">
			<div className="workspace-intro">
				<div className="eyebrow">Flutter Foundry · Icon Maker Pipeline</div>
				<h1 style={{ fontSize: "clamp(34px,6vw,58px)" }}>Icon Maker</h1>
				<p className="lead">
					Generate custom vector icons, compare styles, edit individual SVG
					elements, inspect quality and export complete Android and iOS icon
					packs.
				</p>
				<div className="actions">
					<a
						className="button"
						href="https://svgedit.netlify.app/index.html"
						target="_blank"
						rel="noreferrer"
					>
						Open SVG-Edit ↗
					</a>
					<a
						className="button"
						href="https://github.com/SVG-Edit/svgedit"
						target="_blank"
						rel="noreferrer"
					>
						SVG-Edit source ↗
					</a>
				</div>
			</div>

			<div className="workspace-grid">
				<section className="card">
					<h2>1. Generate</h2>
					<div className="field">
						<label htmlFor="icon-prompt">Describe the icon</label>
						<textarea
							id="icon-prompt"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							rows={3}
							maxLength={500}
						/>
					</div>
					<div className="actions" style={{ flexWrap: "wrap" }}>
						<label className="field" style={{ flex: "1 1 150px" }}>
							Style
							<select
								value={style}
								onChange={(event) => setStyle(event.target.value)}
								className="button"
							>
								{[
									"auto",
									"minimal",
									"geometric",
									"rounded",
									"outline",
									"pixel",
									"abstract",
								].map((item) => (
									<option key={item} value={item}>
										{item}
									</option>
								))}
							</select>
						</label>
						<label className="field" style={{ flex: "1 1 120px" }}>
							PNG size
							<select
								value={size}
								onChange={(event) => setSize(Number(event.target.value))}
								className="button"
							>
								{[128, 256, 512, 1024].map((item) => (
									<option key={item} value={item}>
										{item} px
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="actions" style={{ flexWrap: "wrap" }}>
						<label className="field">
							Background{" "}
							<input
								type="color"
								value={backgroundColor}
								onChange={(event) => setBackgroundColor(event.target.value)}
							/>
						</label>
						<label className="field">
							Foreground{" "}
							<input
								type="color"
								value={foregroundColor}
								onChange={(event) => setForegroundColor(event.target.value)}
							/>
						</label>
						<label className="field">
							Accent{" "}
							<input
								type="color"
								value={accentColor}
								onChange={(event) => setAccentColor(event.target.value)}
							/>
						</label>
					</div>
					<div className="actions">
						<button
							type="button"
							className="button primary"
							disabled={busy || prompt.trim().length < 3}
							onClick={generate}
						>
							{busy ? "Working…" : "Generate icon"}
						</button>
						<button
							type="button"
							className="button"
							disabled={busy}
							onClick={createVariants}
						>
							Create 4 variants
						</button>
					</div>
					<div className="field" style={{ marginTop: 18 }}>
						<label htmlFor="raster-import">
							Import PNG, JPEG or WebP and convert to editable SVG
						</label>
						<input
							id="raster-import"
							type="file"
							accept="image/png,image/jpeg,image/webp"
							onChange={importRaster}
						/>
						<p className="small">
							Raster conversion uses a limited-color, pixel-region trace. It
							works best for flat art and logos; detailed photographs will be
							simplified.
						</p>
					</div>
					<p className="status" aria-live="polite">
						{status}
					</p>
					<button
						type="button"
						className="button"
						disabled={!busy}
						onClick={cancelTask}
					>
						Cancel operation
					</button>
				</section>

				<section className="card">
					<h2>2. Preview and compare</h2>
					<p>
						See the exported icon inside common launcher masks and compare
						generated variants.
					</p>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-around",
							gap: 18,
							flexWrap: "wrap",
							margin: "20px 0",
						}}
					>
						{["circle", "squircle", "rounded"].map((mask) => (
							<div key={mask} style={{ textAlign: "center" }}>
								<div
									style={{
										width: 112,
										height: 112,
										overflow: "hidden",
										borderRadius:
											mask === "circle"
												? "50%"
												: mask === "squircle"
													? "28%"
													: "18%",
										background: "#000",
										display: "grid",
										placeItems: "center",
										border: "1px solid #555",
									}}
								>
									{png ? (
										<Image
											alt="Current icon preview"
											src={"data:image/png;base64," + png}
											width={112}
											height={112}
											unoptimized
											style={{
												width: "100%",
												height: "100%",
												objectFit: "contain",
											}}
										/>
									) : (
										<span style={{ color: "#888", fontSize: 12 }}>Preview</span>
									)}
								</div>
								<span className="small">{mask}</span>
							</div>
						))}
					</div>
					{png && (
						<div
							style={{
								display: "flex",
								alignItems: "end",
								gap: 18,
								flexWrap: "wrap",
								marginBottom: 18,
							}}
						>
							<strong className="small">Small-size legibility</strong>
							{[32, 48, 64].map((previewSize) => (
								<div
									key={previewSize}
									style={{ display: "grid", justifyItems: "center", gap: 6 }}
								>
									<div
										style={{
											width: previewSize,
											height: previewSize,
											overflow: "hidden",
											borderRadius: "22%",
											background: "#000",
											border: "1px solid #555",
										}}
									>
										<Image
											alt={previewSize + " pixel icon preview"}
											src={"data:image/png;base64," + png}
											width={previewSize}
											height={previewSize}
											unoptimized
											style={{
												width: "100%",
												height: "100%",
												objectFit: "contain",
											}}
										/>
									</div>
									<span className="small">{previewSize}px</span>
								</div>
							))}
						</div>
					)}
					<div className="actions">
						<button
							type="button"
							className="button"
							disabled={!png}
							onClick={() =>
								downloadBase64(png, "image/png", "flutter-foundry-icon.png")
							}
						>
							Download PNG
						</button>
						<button
							type="button"
							className="button"
							onClick={() =>
								downloadText(
									svg,
									"image/svg+xml;charset=utf-8",
									"flutter-foundry-icon.svg",
								)
							}
						>
							Download SVG
						</button>
						<button
							type="button"
							className="button"
							disabled={busy}
							onClick={analyze}
						>
							Analyze current SVG
						</button>
					</div>
					{variants.length > 0 && (
						<div style={{ marginTop: 22 }}>
							<h3>Style variants</h3>
							<div
								className="workspace-grid"
								style={{
									gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
								}}
							>
								{variants.map((variant) => (
									<button
										type="button"
										key={variant.style}
										className="card"
										onClick={() => selectVariant(variant)}
										style={{ cursor: "pointer", textAlign: "center" }}
									>
										<Image
											alt={variant.style + " icon variant"}
											src={"data:image/png;base64," + variant.pngBase64}
											width={128}
											height={128}
											unoptimized
											style={{ width: "100%", maxWidth: 128, height: "auto" }}
										/>
										<strong>{variant.style}</strong>
										<span className="small">
											Score {variant.quality.score}/100 · Select
										</span>
									</button>
								))}
							</div>
						</div>
					)}
				</section>
			</div>

			<div className="workspace-grid" style={{ marginTop: 20 }}>
				<section className="card">
					<h2>3. Edit SVG elements</h2>
					<div className="field">
						<label htmlFor="svg-input">SVG source</label>
						<textarea
							id="svg-input"
							spellCheck={false}
							value={svg}
							onChange={(event) => updateSvgDraft(event.target.value)}
							style={{ minHeight: 300 }}
						/>
					</div>
					<div className="actions" style={{ flexWrap: "wrap" }}>
						<label className="field" style={{ flex: "1 1 200px" }}>
							Target element
							<select
								className="button"
								value={selectedElement}
								onChange={(event) => setSelectedElement(event.target.value)}
							>
								<option value="">Analyze SVG to list elements</option>
								{elements.map((element) => (
									<option key={element.id} value={element.id}>
										{element.label}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="actions">
						<label className="field">
							<span>
								<input
									type="checkbox"
									aria-label="Apply fill color"
									checked={applyFill}
									onChange={(event) => setApplyFill(event.target.checked)}
								/>{" "}
								Apply fill
							</span>
							<input
								type="color"
								aria-label="New fill color"
								value={editFill}
								onChange={(event) => {
									setEditFill(event.target.value);
									setApplyFill(true);
								}}
							/>
						</label>
						<label className="field">
							<span>
								<input
									type="checkbox"
									aria-label="Apply stroke color"
									checked={applyStroke}
									onChange={(event) => setApplyStroke(event.target.checked)}
								/>{" "}
								Apply stroke
							</span>
							<input
								type="color"
								aria-label="New stroke color"
								value={editStroke}
								onChange={(event) => {
									setEditStroke(event.target.value);
									setApplyStroke(true);
								}}
							/>
						</label>
						<button
							type="button"
							className="button primary"
							disabled={busy || !selectedElement}
							onClick={editSelected}
						>
							Apply to selected element
						</button>
					</div>
					<p className="small">
						Targeted edits only change the selected element. Unsupported or
						unsafe SVG attributes are rejected.
					</p>
					<div className="actions" style={{ flexWrap: "wrap", marginTop: 12 }}>
						<label className="field">
							Opacity (0–1)
							<input
								aria-label="Element opacity"
								type="number"
								min="0"
								max="1"
								step="0.05"
								placeholder="Keep current"
								value={editOpacity}
								onChange={(event) => setEditOpacity(event.target.value)}
							/>
						</label>
						<label className="field">
							Stroke width
							<input
								aria-label="Element stroke width"
								type="number"
								min="0"
								max="128"
								step="1"
								placeholder="Keep current"
								value={editStrokeWidth}
								onChange={(event) => setEditStrokeWidth(event.target.value)}
							/>
						</label>
						<label className="field">
							Move X
							<input
								aria-label="Move X"
								type="number"
								min="-512"
								max="512"
								placeholder="0"
								value={translateX}
								onChange={(event) => setTranslateX(event.target.value)}
							/>
						</label>
						<label className="field">
							Move Y
							<input
								aria-label="Move Y"
								type="number"
								min="-512"
								max="512"
								placeholder="0"
								value={translateY}
								onChange={(event) => setTranslateY(event.target.value)}
							/>
						</label>
						<label className="field">
							Scale
							<input
								aria-label="Element scale"
								type="number"
								min="0.1"
								max="5"
								step="0.1"
								placeholder="1"
								value={editScale}
								onChange={(event) => setEditScale(event.target.value)}
							/>
						</label>
						<label className="field">
							Rotation (degrees)
							<input
								aria-label="Element rotation"
								type="number"
								min="-360"
								max="360"
								step="1"
								placeholder="0"
								value={editRotation}
								onChange={(event) => setEditRotation(event.target.value)}
							/>
						</label>
					</div>
					<div className="actions" style={{ flexWrap: "wrap", marginTop: 12 }}>
						<button
							type="button"
							className="button primary"
							disabled={busy || !selectedElement}
							onClick={editSelected}
						>
							Apply properties
						</button>
						<button
							type="button"
							className="button"
							disabled={busy || !selectedElement}
							onClick={() => removeSelectedAttribute("fill")}
						>
							Remove fill
						</button>
						<button
							type="button"
							className="button"
							disabled={busy || !selectedElement}
							onClick={() => removeSelectedAttribute("stroke")}
						>
							Remove stroke
						</button>
						<button
							type="button"
							className="button"
							disabled={busy || !selectedElement}
							onClick={removeSelectedElement}
						>
							Delete selected element
						</button>
					</div>
					<div className="actions" style={{ flexWrap: "wrap", marginTop: 12 }}>
						<label className="field">
							Add shape
							<select
								className="button"
								value={newElementTag}
								onChange={(event) => setNewElementTag(event.target.value)}
							>
								<option value="circle">Circle</option>
								<option value="rect">Rounded rectangle</option>
								<option value="path">Triangle</option>
								<option value="line">Line</option>
							</select>
						</label>
						<button
							type="button"
							className="button"
							disabled={busy || !svg.trim()}
							onClick={addShape}
						>
							Add shape
						</button>
					</div>
					<p className="small">
						Shape insertion and attribute changes are validated on the server.
						Translate, scale and rotation apply to the selected SVG element;
						Undo restores prior versions.
					</p>
					<div className="actions" style={{ marginTop: 14 }}>
						<button
							type="button"
							className="button"
							disabled={!canUndo || busy}
							onClick={undo}
						>
							Undo
						</button>
						<button
							type="button"
							className="button"
							disabled={!canRedo || busy}
							onClick={redo}
						>
							Redo
						</button>
						<button
							type="button"
							className="button"
							disabled={busy}
							onClick={editInSvgEdit}
						>
							Check via SVG-Edit
						</button>
						<button
							type="button"
							className="button"
							onClick={() => saveVersion(svg, "Manual checkpoint")}
						>
							Save version
						</button>
						<button
							type="button"
							className="button"
							onClick={() => {
								setSvg(sample);
								setSelectedElement("");
								setPng("");
								setQuality(null);
								setElements([]);
								saveVersion(sample, "Reset sample");
							}}
						>
							Reset sample
						</button>
					</div>
					<div className="field" style={{ marginTop: 14 }}>
						<label htmlFor="versions">Saved versions (this browser)</label>
						<select
							id="versions"
							className="button"
							value={historyIndex}
							onChange={(event) => restoreVersion(Number(event.target.value))}
						>
							{history.map((version, index) => (
								<option key={version.createdAt} value={index}>
									{index + 1}. {version.label}
								</option>
							))}
						</select>
					</div>
					<p className="small">
						Version history is kept in this browser, up to 30 snapshots. It is
						not uploaded to the server.
					</p>
				</section>

				<section className="card">
					<h2>4. Quality checks</h2>
					{quality ? (
						<>
							<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
								<strong style={{ fontSize: 42 }}>{quality.score}</strong>
								<span className="small">/ 100 automated heuristic score</span>
							</div>
							<p className="small">
								{quality.metrics.elementCount} elements ·{" "}
								{quality.metrics.approximateColors} approximate colors ·{" "}
								{Math.round(quality.metrics.artworkCoverage * 100)}% artwork
								bounding-box coverage
							</p>
							<p className="small">
								Minimum stroke at 48 px:{" "}
								{quality.metrics.minimumStrokeWidthAt48px == null
									? "not detected"
									: quality.metrics.minimumStrokeWidthAt48px + " px"}{" "}
								· Minimum opaque-canvas contrast:{" "}
								{quality.metrics.minimumContrastRatio == null
									? "not measured"
									: quality.metrics.minimumContrastRatio + ":1"}
							</p>
							{quality.findings.map((finding) => (
								<div
									key={finding.code}
									style={{ padding: "12px 0", borderTop: "1px solid #333" }}
								>
									<strong>
										{finding.severity.toUpperCase()}: {finding.message}
									</strong>
									<p className="small">{finding.recommendation}</p>
								</div>
							))}
							<p className="small">
								Automated checks are heuristics, not a substitute for reviewing
								the icon at actual launcher size on each target device.
							</p>
						</>
					) : (
						<p className="small">
							Generate an icon or choose Analyze current SVG to inspect margins,
							centering, aspect ratio, color complexity and SVG element count.
						</p>
					)}
				</section>
			</div>

			<section className="card" style={{ marginTop: 20 }}>
				<h2>5. Export a complete icon pack</h2>
				<p>
					Build Android adaptive icons, iOS AppIcon assets, Flutter Launcher
					Icons configuration and source images in one ZIP.
				</p>
				<div className="actions" style={{ flexWrap: "wrap" }}>
					<label className="field" style={{ flex: "1 1 200px" }}>
						App name{" "}
						<input
							value={appName}
							onChange={(event) => setAppName(event.target.value)}
						/>
					</label>
					<label className="field" style={{ flex: "1 1 240px" }}>
						Android package name{" "}
						<input
							value={packageName}
							onChange={(event) => setPackageName(event.target.value)}
						/>
					</label>
					<label className="field">
						iOS background for transparent source icons
						<input
							aria-label="iOS background color"
							type="color"
							value={iosBackgroundColor}
							onChange={(event) => setIosBackgroundColor(event.target.value)}
						/>
					</label>
					<button
						type="button"
						className="button primary"
						disabled={busy || !svg.trim()}
						onClick={exportBundle}
					>
						{busy ? "Preparing…" : "Export Android + iOS + Flutter ZIP"}
					</button>
				</div>
				<p className="small">
					The ZIP includes Flutter Launcher Icons configuration and assets for
					Android adaptive icons, iOS alpha-free icons, and iOS dark/tinted
					sources. Android VectorDrawable conversion still rejects unsupported
					SVG features rather than silently changing their appearance.
				</p>
			</section>
		</section>
	);
}
