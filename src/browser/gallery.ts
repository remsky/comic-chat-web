import { type AvatarData, AvatarRegistry } from "../engine/avatar.js";
import { EmotionEngine } from "../engine/emotion.js";
import {
	PanelPage,
	SM_SAY,
	SM_THINK,
	SM_WHISPER,
	type UnitPanel,
} from "../engine/panel.js";
import {
	layoutPanelBalloons,
	makeRuntimeBalloon,
} from "../engine/panelBalloon.js";
import { MsvcRand } from "../engine/rand.js";
import { AvatarAtlasCache } from "./avatarAssets.js";
import { CanvasPanelRenderer } from "./canvasRenderer.js";
import { CanvasSurface } from "./canvasSurface.js";
import {
	CanvasTextMeasurer,
	createCanvasMeasureContext,
	loadCanvasFonts,
} from "./canvasText.js";
import { syncPanelAccessibility } from "./panelAccessibility.js";

// the oracle traces pin square panels: SetUnitPanelWidth/Height(MINUNITPANELWIDTH) in trace mode
const UNIT_WIDTH = 2300;
const UNIT_HEIGHT = 2300;

const messages = [
	{ speaker: 1, mode: SM_SAY, text: "Hello there Bolo!" },
	{ speaker: 2, mode: SM_SAY, text: "hey anna" },
	{
		speaker: 1,
		mode: SM_THINK,
		text: "I wonder if he knows about the treasure",
	},
	{ speaker: 2, mode: SM_WHISPER, text: "psst, I heard that" },
	{ speaker: 1, mode: SM_SAY, text: "WHAT DID YOU SAY?" },
	{ speaker: 2, mode: SM_SAY, text: "LOL you shout a lot" },
	{ speaker: 1, mode: SM_SAY, text: "<Brk>" },
	{ speaker: 1, mode: SM_SAY, text: "Are you pointing at me?" },
] as const;

async function loadManifest(): Promise<{ avatars: AvatarData[] }> {
	const response = await fetch("/assets/avatars/manifest.json");
	if (!response.ok)
		throw new Error(`failed to load avatar manifest: ${response.status}`);
	return response.json() as Promise<{ avatars: AvatarData[] }>;
}

function composePanels(
	registry: AvatarRegistry,
	resolveStyle: ReturnType<CanvasTextMeasurer["styleResolver"]>,
): UnitPanel[] {
	const layoutOptions = {
		unitWidth: UNIT_WIDTH,
		unitHeight: UNIT_HEIGHT,
		resolveStyle,
	};
	const page = new PanelPage({
		registry,
		rand: new MsvcRand(1515),
		unitWidth: UNIT_WIDTH,
		unitHeight: UNIT_HEIGHT,
		hooks: {
			makeBalloon: (text, mode, speaker) =>
				makeRuntimeBalloon(text, mode, speaker, resolveStyle),
			layoutBalloons: (panel, rand) =>
				layoutPanelBalloons(panel, rand, layoutOptions),
		},
	});
	const emotions = new EmotionEngine();
	for (const message of messages) {
		const avatar = registry.get(message.speaker);
		if (!avatar) throw new Error(`missing avatar ${message.speaker}`);
		avatar.updateBody(
			avatar.getBodyFromOptions(emotions.getEmotionsFromString(message.text)),
		);
		page.addLine(message.speaker, message.text, message.mode);
	}
	return page.panels.filter((panel): panel is UnitPanel => panel !== null);
}

async function main(): Promise<void> {
	const gallery = document.querySelector<HTMLElement>("#gallery");
	const status = document.querySelector<HTMLElement>("#status");
	if (!gallery || !status) throw new Error("gallery shell is incomplete");
	await loadCanvasFonts();
	const manifest = await loadManifest();
	const registry = new AvatarRegistry(manifest.avatars);
	const measurer = new CanvasTextMeasurer(createCanvasMeasureContext());
	const panels = composePanels(registry, measurer.styleResolver());
	const atlases = new AvatarAtlasCache();
	await atlases.preload(manifest.avatars);
	const surfaces: CanvasSurface[] = [];

	for (let index = 0; index < panels.length; index++) {
		const panel = panels[index];
		if (!panel) continue;
		const card = document.createElement("figure");
		card.className = "panel-card";
		card.style.setProperty("--panel-index", String(index));
		const canvas = document.createElement("canvas");
		canvas.width = 460;
		canvas.height = 460;
		const details = document.createElement("details");
		const summary = document.createElement("summary");
		summary.textContent = `Panel ${index + 1} transcript`;
		const transcript = document.createElement("ol");
		details.append(summary, transcript);
		card.append(canvas, details);
		gallery.append(card);
		syncPanelAccessibility(canvas, transcript, panel, manifest.avatars);
		let renderer: CanvasPanelRenderer | undefined;
		const surface = new CanvasSurface(
			canvas,
			UNIT_WIDTH,
			UNIT_HEIGHT,
			(context) => {
				renderer ??= new CanvasPanelRenderer(
					context,
					atlases,
					registry.avatars,
					{ unitWidth: UNIT_WIDTH, unitHeight: UNIT_HEIGHT },
				);
				renderer.render(panel);
			},
		);
		surfaces.push(surface);
	}

	const firstSurface = surfaces[0];
	if (firstSurface) await firstSurface.ready;
	gallery.setAttribute("aria-busy", "false");
	status.dataset.ready = "true";
	status.textContent = `${panels.length} panels prepared`;
	import.meta.hot?.dispose(() => {
		for (const surface of surfaces) surface.dispose();
		atlases.dispose();
	});
}

main().catch((error: unknown) => {
	const status = document.querySelector<HTMLElement>("#status");
	if (status)
		status.textContent = error instanceof Error ? error.message : String(error);
	throw error;
});
