// Live room client: joins a Durable Object room and composes every message into panels.

import { type AvatarData, AvatarRegistry } from "../engine/avatar.js";
import { EmotionEngine } from "../engine/emotion.js";
import { PanelPage, type UnitPanel } from "../engine/panel.js";
import {
	layoutPanelBalloons,
	makeRuntimeBalloon,
} from "../engine/panelBalloon.js";
import { MsvcRand } from "../engine/rand.js";
import {
	type ChatEntry,
	parseServerMessage,
	type RosterEntry,
} from "../protocol/room.js";
import { AvatarAtlasCache } from "./avatarAssets.js";
import { CanvasPanelRenderer } from "./canvasRenderer.js";
import { CanvasSurface } from "./canvasSurface.js";
import {
	CanvasTextMeasurer,
	createCanvasMeasureContext,
	loadCanvasFonts,
} from "./canvasText.js";
import { syncPanelAccessibility } from "./panelAccessibility.js";

const UNIT_WIDTH = 2300;
const UNIT_HEIGHT = 5400;

interface RenderedPanel {
	panel: UnitPanel;
	card: HTMLElement;
	surface: CanvasSurface;
}

function element<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`room shell is missing #${id}`);
	return found as T;
}

function displayName(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

class RoomView {
	private readonly rendered: RenderedPanel[] = [];
	private readonly page: PanelPage;
	private readonly emotions = new EmotionEngine();

	constructor(
		private readonly registry: AvatarRegistry,
		private readonly atlases: AvatarAtlasCache,
		private readonly avatars: AvatarData[],
		private readonly container: HTMLElement,
	) {
		const measurer = new CanvasTextMeasurer(createCanvasMeasureContext());
		const resolveStyle = measurer.styleResolver();
		const layoutOptions = {
			unitWidth: UNIT_WIDTH,
			unitHeight: UNIT_HEIGHT,
			resolveStyle,
		};
		this.page = new PanelPage({
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
	}

	compose(entry: ChatEntry): void {
		const avatar = this.registry.get(entry.avatar);
		if (!avatar) return;
		avatar.updateBody(
			avatar.getBodyFromOptions(
				this.emotions.getEmotionsFromString(entry.text),
			),
		);
		this.page.addLine(entry.avatar, entry.text, entry.mode);
		this.reconcile();
	}

	private makeCard(panel: UnitPanel, index: number): RenderedPanel {
		const card = document.createElement("figure");
		card.className = "panel-card";
		card.style.setProperty("--panel-index", String(index));
		const canvas = document.createElement("canvas");
		canvas.width = 460;
		canvas.height = 1080;
		const details = document.createElement("details");
		const summary = document.createElement("summary");
		summary.textContent = `Panel ${index + 1} transcript`;
		const transcript = document.createElement("ol");
		details.append(summary, transcript);
		card.append(canvas, details);
		syncPanelAccessibility(canvas, transcript, panel, this.avatars);
		let renderer: CanvasPanelRenderer | undefined;
		const surface = new CanvasSurface(
			canvas,
			UNIT_WIDTH,
			UNIT_HEIGHT,
			(context) => {
				renderer ??= new CanvasPanelRenderer(
					context,
					this.atlases,
					this.registry.avatars,
					{ unitWidth: UNIT_WIDTH, unitHeight: UNIT_HEIGHT },
				);
				renderer.render(panel);
			},
		);
		return { panel, card, surface };
	}

	private reconcile(): void {
		const panels = this.page.panels.filter(
			(panel): panel is UnitPanel => panel !== null,
		);
		for (let i = 0; i < panels.length; i++) {
			const panel = panels[i];
			if (!panel) continue;
			const existing = this.rendered[i];
			if (existing?.panel === panel) continue;
			const replacement = this.makeCard(panel, i);
			if (existing) {
				existing.surface.dispose();
				existing.card.replaceWith(replacement.card);
			} else {
				this.container.append(replacement.card);
			}
			this.rendered[i] = replacement;
		}
		this.rendered.at(-1)?.card.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}
}

function wireJoinForm(avatars: AvatarData[]): void {
	const select = element<HTMLSelectElement>("join-avatar");
	for (const avatar of avatars) {
		const option = document.createElement("option");
		option.value = String(avatar.avatarID);
		option.textContent = displayName(avatar.name);
		select.append(option);
	}
	const params = new URLSearchParams(location.search);
	const room = params.get("room");
	if (room) element<HTMLInputElement>("join-room").value = room;
}

function renderRoster(roster: RosterEntry[], avatars: AvatarData[]): void {
	const names = roster.map((entry) => {
		const cast = avatars.find((avatar) => avatar.avatarID === entry.avatar);
		return `${entry.name} (${displayName(cast?.name ?? "?")})`;
	});
	element("roster").textContent = names.length
		? `In this room: ${names.join(", ")}`
		: "Nobody else is here yet.";
}

async function main(): Promise<void> {
	const status = element("status");
	await loadCanvasFonts();
	const response = await fetch("/assets/avatars/manifest.json");
	if (!response.ok)
		throw new Error(`failed to load avatar manifest: ${response.status}`);
	const manifest = (await response.json()) as { avatars: AvatarData[] };
	const registry = new AvatarRegistry(manifest.avatars);
	const atlases = new AvatarAtlasCache();
	await atlases.preload(manifest.avatars);
	wireJoinForm(manifest.avatars);
	status.dataset.ready = "true";

	let roster: RosterEntry[] = [];
	const view = new RoomView(
		registry,
		atlases,
		manifest.avatars,
		element("panels"),
	);

	element<HTMLFormElement>("join-form").addEventListener("submit", (event) => {
		event.preventDefault();
		element<HTMLFormElement>("join-form")
			.querySelector("button")
			?.setAttribute("disabled", "");
		const room = element<HTMLInputElement>("join-room").value.trim();
		const name = element<HTMLInputElement>("join-name").value.trim();
		const avatar = Number(element<HTMLSelectElement>("join-avatar").value);
		if (!room || !name) return;
		history.replaceState(null, "", `?room=${encodeURIComponent(room)}`);
		const protocol = location.protocol === "https:" ? "wss" : "ws";
		const socket = new WebSocket(
			`${protocol}://${location.host}/api/rooms/${room}/websocket`,
		);
		status.textContent = "Connecting…";
		delete status.dataset.ready;

		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ type: "join", name, avatar }));
		});
		socket.addEventListener("message", (message) => {
			const parsed = parseServerMessage(message.data);
			if (!parsed) return;
			if (parsed.type === "welcome") {
				element("join").hidden = true;
				element("room").hidden = false;
				status.dataset.ready = "true";
				roster = parsed.roster;
				renderRoster(roster, manifest.avatars);
				for (const entry of parsed.history) view.compose(entry);
			} else if (parsed.type === "chat") {
				view.compose(parsed.entry);
			} else if (parsed.type === "joined") {
				if (
					!roster.some(
						(entry) =>
							entry.avatar === parsed.who.avatar &&
							entry.name === parsed.who.name,
					)
				)
					roster.push(parsed.who);
				renderRoster(roster, manifest.avatars);
			} else if (parsed.type === "left") {
				const index = roster.findIndex(
					(entry) =>
						entry.avatar === parsed.who.avatar &&
						entry.name === parsed.who.name,
				);
				if (index >= 0) roster.splice(index, 1);
				renderRoster(roster, manifest.avatars);
			} else if (parsed.type === "error") {
				status.textContent = parsed.reason;
				delete status.dataset.ready;
			}
		});
		socket.addEventListener("close", () => {
			status.textContent = "Disconnected. Reload to rejoin.";
			delete status.dataset.ready;
		});

		element<HTMLFormElement>("composer").addEventListener(
			"submit",
			(sendEvent) => {
				sendEvent.preventDefault();
				const text = element<HTMLInputElement>("composer-text");
				const mode = Number(element<HTMLSelectElement>("composer-mode").value);
				if (!text.value.trim()) return;
				socket.send(JSON.stringify({ type: "chat", text: text.value, mode }));
				text.value = "";
			},
		);
	});
}

main().catch((error: unknown) => {
	const status = document.getElementById("status");
	if (status)
		status.textContent = error instanceof Error ? error.message : String(error);
	throw error;
});
