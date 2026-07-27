// Studio entry: boots the cast, keeps one strip in memory, and re-renders it on every edit.

import { AvatarAtlasCache } from "../browser/avatarAssets.js";
import { BackdropCache } from "../browser/backdropAssets.js";
import {
	CanvasTextMeasurer,
	createCanvasMeasureContext,
	loadCanvasFonts,
} from "../browser/canvasText.js";
import { element } from "../browser/dom.js";
import { avatarIconUrl } from "../browser/pickerTiles.js";
import type { AvatarData } from "../engine/avatar.js";
import { type AnimateDeps, exportGif, exportMp4 } from "./animate.js";
import { emptyArt } from "./art.js";
import { composeStrip } from "./compose.js";
import { PanelEditor } from "./editor.js";
import { StripScreen } from "./moderation.js";
import { StripPreview } from "./preview.js";
import {
	buildCatalog,
	COLUMNS_DEFAULT,
	COLUMNS_MAX,
	COLUMNS_MIN,
	parseStrip,
	parseStripJson,
	STRIP_VERSION,
	type Strip,
	type StripCatalog,
	type StripIssue,
	type StripSize,
	stripToJson,
} from "./script.js";
import { wireSplit, wireZoom } from "./viewport.js";

const RENDER_DELAY_MS = 120;
const SKILL_COMMAND = "npx skills add remsky/comic-chat-web";

const DEMO: unknown = {
	version: 2,
	panels: [
		{
			camera: "wide",
			actors: [
				{ avatar: "anna", text: "Welcome to the studio", gesture: "wave" },
				{
					avatar: "tiki",
					text: "Build a strip panel by panel",
					facing: "left",
				},
			],
		},
		{
			camera: "close",
			actors: [{ avatar: "tiki", emotion: "happy", text: "No chat required" }],
		},
	],
};

function download(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function scriptBytes(encoded: string): Uint8Array<ArrayBuffer> {
	const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// ?s= is deflated, ?script= plain; strip-link.mjs writes the short one
async function scriptFromUrl(): Promise<string | null> {
	const params = new URLSearchParams(location.search);
	try {
		const packed = params.get("s");
		if (packed) {
			const stream = new Blob([scriptBytes(packed)])
				.stream()
				.pipeThrough(new DecompressionStream("deflate-raw"));
			return await new Response(stream).text();
		}
		const inline = params.get("script");
		if (inline) return new TextDecoder().decode(scriptBytes(inline));
	} catch {
		return null;
	}
	return null;
}

async function main(): Promise<void> {
	await loadCanvasFonts();
	const response = await fetch("/assets/avatars/manifest.json");
	if (!response.ok)
		throw new Error(`failed to load avatar manifest: ${response.status}`);
	const manifest = (await response.json()) as { avatars: AvatarData[] };
	const atlases = new AvatarAtlasCache();
	const backdrops = new BackdropCache();
	await Promise.all([atlases.preload(manifest.avatars), backdrops.load()]);

	const catalog: StripCatalog = buildCatalog(
		manifest.avatars,
		backdrops.backdrops.map((info) => info.name),
	);
	// the catalog probes each character once; compose reads that same memo instead of keeping its own
	const catalogByName = new Map(catalog.avatars.map((e) => [e.name, e]));
	const artFor = (name: string) => catalogByName.get(name)?.art ?? emptyArt();
	const measurer = new CanvasTextMeasurer(createCanvasMeasureContext());
	const resolveStyle = measurer.styleResolver();
	const stage = element("studio-stage");
	const panels = element("studio-panels");
	const preview = new StripPreview({
		container: panels,
		scroller: stage,
		atlases,
		backdrops,
		avatars: manifest.avatars,
	});

	const sizeSelect = element<HTMLSelectElement>("studio-size");
	const seedInput = element<HTMLInputElement>("studio-seed");
	const columnsInput = element<HTMLInputElement>("studio-columns");
	const cardSize = element<HTMLInputElement>("studio-cardsize");
	const status = element("studio-status");
	const countLabel = element("studio-count");
	const jsonArea = element<HTMLTextAreaElement>("studio-json");
	const issueList = element("studio-issues");

	const source = await scriptFromUrl();
	const initial = source
		? parseStripJson(source, catalog)
		: parseStrip(DEMO, catalog);

	const editor = new PanelEditor(initial.strip, {
		container: element("studio-editor"),
		scroller: element("studio-inspector"),
		catalog,
		icon: (name) => {
			const data = manifest.avatars.find((entry) => entry.name === name);
			if (!data) return null;
			const img = document.createElement("img");
			img.src = avatarIconUrl(data, atlases);
			img.alt = "";
			img.width = 40;
			img.height = 40;
			return img;
		},
		onEdit: () => schedule(),
		onSelect: (index) => {
			editor.focus(index);
			preview.select(index);
			preview.scrollTo(index);
		},
	});

	let timer = 0;
	const screen = new StripScreen();
	let structural: StripIssue[] = [];
	let flagged: StripIssue[] = [];

	function showIssues(issues: readonly StripIssue[]): void {
		editor.showIssues(issues);
		issueList.replaceChildren();
		for (const issue of issues) {
			const item = document.createElement("li");
			item.className = `sissue sissue--${issue.severity}`;
			item.textContent = issue.path
				? `${issue.path}: ${issue.message}`
				: issue.message;
			issueList.append(item);
		}
		issueList.hidden = issues.length === 0;
	}

	function draw(): void {
		const strip = editor.strip;
		const validated = parseStrip(JSON.parse(stripToJson(strip)), catalog);
		const composed = composeStrip(screen.drawable(strip), {
			avatars: manifest.avatars,
			resolveStyle,
			artFor,
		});
		preview.columns = strip.columns ?? COLUMNS_DEFAULT;
		panels.style.setProperty("--columns", String(preview.columns));
		preview.render(composed);
		countLabel.textContent =
			strip.panels.length === 1 ? "1 panel" : `${strip.panels.length} panels`;
		jsonArea.value = stripToJson(strip);
		structural = [...validated.issues, ...composed.issues];
		flagged = screen.issues(strip);
		showIssues([...structural, ...flagged]);
	}

	function render(): void {
		draw();
		status.textContent = "";
		void update();
		document.body.dataset.studioReady = "true";
	}

	// a verdict only ever adds to what the canvas may draw, so it redraws from whatever the strip is by then
	async function update(): Promise<void> {
		if (await screen.update(editor.strip)) draw();
	}

	// the screen answers on a delay, so an export asks again about every line
	async function cleared(): Promise<boolean> {
		await screen.recheck(editor.strip);
		draw();
		if (flagged.length === 0) return true;
		status.textContent = "Export blocked: flagged text";
		return false;
	}

	function schedule(): void {
		if (timer !== 0) clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = 0;
			render();
		}, RENDER_DELAY_MS);
	}

	function replace(strip: Strip): void {
		editor.strip = strip;
		editor.rebuild();
		sizeSelect.value = strip.size ?? "modern";
		seedInput.value = strip.seed === undefined ? "" : String(strip.seed);
		columnsInput.value = String(strip.columns ?? COLUMNS_DEFAULT);
		render();
	}

	preview.onSelect = (index) => {
		editor.focus(index);
		preview.select(index);
		editor.scrollTo(index);
	};
	preview.onAdd = () => editor.addPanel();
	preview.onReorder = (from, to) => editor.move(from, to);

	wireSplit(element("studio-app"), element("studio-divider"));
	const zoom = wireZoom({
		stage,
		panels,
		slider: cardSize,
		columns: () => preview.columns,
	});

	sizeSelect.addEventListener("change", () => {
		editor.strip.size = sizeSelect.value as StripSize;
		render();
	});
	seedInput.addEventListener("change", () => {
		const value = Number(seedInput.value);
		if (seedInput.value === "" || !Number.isInteger(value))
			delete editor.strip.seed;
		else editor.strip.seed = value;
		render();
	});
	columnsInput.addEventListener("input", () => {
		const value = Math.round(Number(columnsInput.value));
		if (!Number.isInteger(value) || value < COLUMNS_MIN || value > COLUMNS_MAX)
			return;
		editor.strip.columns = value;
		render();
	});

	const skillText = element("studio-skill-text");
	element("studio-skill-line").addEventListener("click", () => {
		void navigator.clipboard.writeText(SKILL_COMMAND).then(() => {
			skillText.textContent = "copied";
			setTimeout(() => {
				skillText.textContent = SKILL_COMMAND;
			}, 1200);
		});
	});

	element("studio-apply-json").addEventListener("click", () => {
		const parsed = parseStripJson(jsonArea.value, catalog);
		if (parsed.issues.some((issue) => issue.severity === "error")) {
			showIssues(parsed.issues);
			return;
		}
		replace(parsed.strip);
	});

	element("studio-new").addEventListener("click", () => {
		replace(parseStrip({ version: STRIP_VERSION, panels: [] }, catalog).strip);
	});

	const saveMenu = element<HTMLDetailsElement>("studio-save");
	document.addEventListener("pointerdown", (event) => {
		if (!saveMenu.contains(event.target as Node)) saveMenu.open = false;
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") saveMenu.open = false;
	});

	element("studio-export-json").addEventListener("click", () => {
		saveMenu.open = false;
		void cleared().then((ok) => {
			if (!ok) return;
			download(
				new Blob([stripToJson(editor.strip)], { type: "application/json" }),
				"strip.json",
			);
		});
	});

	element("studio-export-png").addEventListener("click", () => {
		saveMenu.open = false;
		void cleared()
			.then((ok) => (ok ? preview.exportPng() : null))
			.then((blob) => {
				if (blob) download(blob, "strip.png");
			});
	});

	element("studio-export-png-square").addEventListener("click", () => {
		saveMenu.open = false;
		void cleared()
			.then((ok) => (ok ? preview.exportPng({ square: true }) : null))
			.then((blob) => {
				if (blob) download(blob, "strip-square.png");
			});
	});

	const animateDeps: AnimateDeps = {
		atlases,
		backdrops,
		compose: { avatars: manifest.avatars, resolveStyle, artFor },
	};

	function wireAnimation(
		id: string,
		label: string,
		filename: string,
		render: (progress: (fraction: number) => void) => Promise<Blob | null>,
	): void {
		element(id).addEventListener("click", () => {
			saveMenu.open = false;
			void cleared().then(async (ok) => {
				if (!ok) return;
				status.textContent = `Encoding ${label} 0%`;
				try {
					const blob = await render((fraction) => {
						status.textContent = `Encoding ${label} ${Math.round(fraction * 100)}%`;
					});
					if (blob) download(blob, filename);
					status.textContent = blob
						? ""
						: `${label} export unavailable in this browser`;
				} catch {
					status.textContent = `${label} export failed`;
				}
			});
		});
	}

	wireAnimation("studio-export-mp4", "MP4", "strip.mp4", (progress) =>
		exportMp4(editor.strip, animateDeps, progress),
	);
	wireAnimation("studio-export-gif", "GIF", "strip.gif", (progress) =>
		exportGif(editor.strip, animateDeps, progress),
	);

	const importInput = element<HTMLInputElement>("studio-import");
	importInput.addEventListener("change", () => {
		const file = importInput.files?.[0];
		if (!file) return;
		void file.text().then((text) => {
			const parsed = parseStripJson(text, catalog);
			if (parsed.issues.some((issue) => issue.severity === "error"))
				showIssues(parsed.issues);
			else replace(parsed.strip);
			importInput.value = "";
		});
	});

	sizeSelect.value = initial.strip.size ?? "modern";
	columnsInput.value = String(initial.strip.columns ?? COLUMNS_DEFAULT);
	editor.rebuild();
	render();
	zoom.fit();
	if (initial.issues.length > 0) showIssues(initial.issues);

	// automation hook: drive the page from a script without touching the controls
	Object.defineProperty(window, "__studio", {
		value: {
			catalog: () => catalog,
			current: () => editor.strip,
			load: (script: unknown) => {
				const parsed = parseStrip(script, catalog);
				replace(parsed.strip);
				return parsed.issues;
			},
			png: () => preview.exportPng(),
			mp4: () => exportMp4(editor.strip, animateDeps),
			gif: () => exportGif(editor.strip, animateDeps),
		},
	});
}

main().catch((error: unknown) => {
	const status = document.getElementById("studio-status");
	if (status)
		status.textContent = error instanceof Error ? error.message : String(error);
	throw error;
});
