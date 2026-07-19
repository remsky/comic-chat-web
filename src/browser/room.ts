// Live room client: joins a Durable Object room and composes every message into panels.

import {
	AF_UNFROZEN,
	type Avatar,
	type AvatarData,
	AvatarRegistry,
} from "../engine/avatar.js";
import { EmotionEngine } from "../engine/emotion.js";
import { PanelPage, type UnitPanel } from "../engine/panel.js";
import {
	layoutPanelBalloons,
	makeRuntimeBalloon,
} from "../engine/panelBalloon.js";
import { MsvcRand } from "../engine/rand.js";
import {
	type ChatEntry,
	HISTORY_CHUNK,
	type PoseIndices,
	parseServerMessage,
	type RosterEntry,
} from "../protocol/room.js";
import { AvatarAtlasCache } from "./avatarAssets.js";
import { BodyCamWidget } from "./bodycamWidget.js";
import { CanvasPanelRenderer } from "./canvasRenderer.js";
import { CanvasSurface } from "./canvasSurface.js";
import {
	CanvasTextMeasurer,
	createCanvasMeasureContext,
	loadCanvasFonts,
} from "./canvasText.js";
import { syncPanelAccessibility } from "./panelAccessibility.js";

// square twips panels like SetPanelsWide; 3000 is what the original computed for a maximized 1024x768 window (traces pin the 2300 floor)
const CLASSIC_UNIT = 3000;
// larger unit shrinks text relative to the panel (~25 chars/line, 4-line balloons) so messages split less
const MODERN_UNIT = 4000;
const MODERN_TWEAKS_KEY = "comic-chat.modern-tweaks";

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

interface Composition {
	registry: AvatarRegistry;
	emotions: EmotionEngine;
	page: PanelPage;
}

class RoomView {
	private readonly rendered: RenderedPanel[] = [];
	private readonly entries: ChatEntry[] = [];
	private readonly resolveStyle: ReturnType<
		CanvasTextMeasurer["styleResolver"]
	>;
	private composition: Composition;
	private unit: number;
	private localAvatarID: number | null = null;

	private autoScroll = true;
	onComposed?: () => void;
	onRebuilt?: () => void;

	constructor(
		private readonly atlases: AvatarAtlasCache,
		private readonly avatars: AvatarData[],
		private readonly container: HTMLElement,
		private readonly scroller: HTMLElement,
		modernTweaks: boolean,
	) {
		scroller.addEventListener("scroll", () => {
			this.autoScroll =
				scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
		});
		const measurer = new CanvasTextMeasurer(createCanvasMeasureContext());
		this.resolveStyle = measurer.styleResolver();
		this.unit = modernTweaks ? MODERN_UNIT : CLASSIC_UNIT;
		this.composition = this.createComposition();
	}

	private createComposition(): Composition {
		const registry = new AvatarRegistry(this.avatars);
		const unit = this.unit;
		const layoutOptions = {
			unitWidth: unit,
			unitHeight: unit,
			resolveStyle: this.resolveStyle,
		};
		const page = new PanelPage({
			registry,
			rand: new MsvcRand(1515),
			unitWidth: unit,
			unitHeight: unit,
			hooks: {
				makeBalloon: (text, mode, speaker) =>
					makeRuntimeBalloon(text, mode, speaker, this.resolveStyle),
				layoutBalloons: (panel, rand) =>
					layoutPanelBalloons(panel, rand, layoutOptions),
			},
		});
		return { registry, emotions: new EmotionEngine(), page };
	}

	private feed(entry: ChatEntry): void {
		const { registry, emotions, page } = this.composition;
		const avatar = registry.get(entry.avatar);
		if (!avatar) return;
		// SayEntry::Execute applies sent pose indices verbatim (histent.cpp:74-76); no pose = re-run text rules
		if (entry.pose)
			avatar.setIndices(entry.pose.expr, entry.pose.gest, entry.pose.req);
		else
			avatar.updateBody(
				avatar.getBodyFromOptions(emotions.getEmotionsFromString(entry.text)),
			);
		page.addLine(entry.avatar, entry.text, entry.mode);
	}

	compose(entry: ChatEntry): void {
		this.entries.push(entry);
		this.feed(entry);
		this.reconcile();
		this.onComposed?.();
	}

	prepend(entries: ChatEntry[]): void {
		const known = new Set(this.entries.map((entry) => entry.seq));
		const additions = entries.filter((entry) => !known.has(entry.seq));
		if (additions.length === 0) return;
		this.entries.unshift(...additions);
		this.composition = this.createComposition();
		for (const entry of this.entries) this.feed(entry);
		this.reconcile();
		this.onRebuilt?.();
	}

	setLocalAvatarID(avatarID: number): void {
		this.localAvatarID = avatarID;
	}

	localAvatar(): Avatar | undefined {
		if (this.localAvatarID === null) return undefined;
		return this.composition.registry.get(this.localAvatarID);
	}

	// ChatPreSendText (textpose.cpp:115-125) then GetIndices for the wire (chatprot.cpp:172-177)
	prepareOutgoing(text: string): PoseIndices | undefined {
		const avatar = this.localAvatar();
		if (!avatar) return undefined;
		if (avatar.freeze === AF_UNFROZEN)
			avatar.updateBody(
				avatar.getBodyFromOptions(
					this.composition.emotions.getEmotionsFromString(text),
				),
			);
		const indices = avatar.getIndices();
		return {
			expr: indices.faceIndex,
			gest: indices.torsoIndex,
			req: indices.requested,
		};
	}

	// rebuilds with fresh registry/emotion/rand state and replays history, so the result matches a fresh join in that mode
	setModernTweaks(on: boolean): void {
		const unit = on ? MODERN_UNIT : CLASSIC_UNIT;
		if (unit === this.unit) return;
		this.unit = unit;
		this.composition = this.createComposition();
		for (const entry of this.entries) this.feed(entry);
		this.reconcile();
		this.onRebuilt?.();
	}

	private makeCard(panel: UnitPanel): RenderedPanel {
		const card = document.createElement("figure");
		card.className = "panel";
		const canvas = document.createElement("canvas");
		canvas.width = 600;
		canvas.height = 600;
		const transcript = document.createElement("ol");
		transcript.className = "sr-only";
		card.append(canvas, transcript);
		syncPanelAccessibility(canvas, transcript, panel, this.avatars);
		const { registry } = this.composition;
		const unit = this.unit;
		let renderer: CanvasPanelRenderer | undefined;
		const surface = new CanvasSurface(canvas, unit, unit, (context) => {
			renderer ??= new CanvasPanelRenderer(
				context,
				this.atlases,
				registry.avatars,
				{ unitWidth: unit, unitHeight: unit },
			);
			renderer.render(panel);
		});
		return { panel, card, surface };
	}

	private reconcile(): void {
		const panels = this.composition.page.panels.filter(
			(panel): panel is UnitPanel => panel !== null,
		);
		for (let i = 0; i < panels.length; i++) {
			const panel = panels[i];
			if (!panel) continue;
			const existing = this.rendered[i];
			if (existing?.panel === panel) continue;
			const replacement = this.makeCard(panel);
			if (existing) {
				existing.surface.dispose();
				existing.card.replaceWith(replacement.card);
			} else {
				this.container.append(replacement.card);
			}
			this.rendered[i] = replacement;
		}
		for (let i = panels.length; i < this.rendered.length; i++) {
			const extra = this.rendered[i];
			if (!extra) continue;
			extra.surface.dispose();
			extra.card.remove();
		}
		this.rendered.length = panels.length;
		if (this.autoScroll) this.scroller.scrollTop = this.scroller.scrollHeight;
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
	const list = element<HTMLUListElement>("roster");
	const items = roster.map((entry) => {
		const cast = avatars.find((avatar) => avatar.avatarID === entry.avatar);
		const item = document.createElement("li");
		const name = document.createElement("strong");
		name.textContent = entry.name;
		const character = document.createElement("span");
		character.textContent = ` ${displayName(cast?.name ?? "?")}`;
		item.append(name, character);
		return item;
	});
	if (items.length === 0) {
		const empty = document.createElement("li");
		empty.textContent = "Nobody here yet.";
		items.push(empty);
	}
	list.replaceChildren(...items);
}

async function main(): Promise<void> {
	const status = element("status");
	await loadCanvasFonts();
	const response = await fetch("/assets/avatars/manifest.json");
	if (!response.ok)
		throw new Error(`failed to load avatar manifest: ${response.status}`);
	const manifest = (await response.json()) as { avatars: AvatarData[] };
	const atlases = new AvatarAtlasCache();
	await atlases.preload(manifest.avatars);
	wireJoinForm(manifest.avatars);
	status.dataset.ready = "true";

	let roster: RosterEntry[] = [];
	const tweaks = element<HTMLInputElement>("modern-toggle");
	tweaks.checked = localStorage.getItem(MODERN_TWEAKS_KEY) !== "off";
	const view = new RoomView(
		atlases,
		manifest.avatars,
		element("panels"),
		element("strip"),
		tweaks.checked,
	);
	tweaks.addEventListener("change", () => {
		localStorage.setItem(MODERN_TWEAKS_KEY, tweaks.checked ? "on" : "off");
		view.setModernTweaks(tweaks.checked);
	});

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
		const scroller = element("strip");
		let oldestSeq: number | null = null;
		let historyPending = false;
		let historyDone = false;

		const requestOlderHistory = (): void => {
			if (
				historyPending ||
				historyDone ||
				oldestSeq === null ||
				socket.readyState !== WebSocket.OPEN
			)
				return;
			historyPending = true;
			socket.send(JSON.stringify({ type: "history", before: oldestSeq }));
		};
		scroller.addEventListener("scroll", () => {
			if (scroller.scrollTop < 80) requestOlderHistory();
		});

		// cui.Say: run the presend hook, then transmit text plus pose indices
		const sendChat = (text: string, mode: number): void => {
			const pose = view.prepareOutgoing(text);
			socket.send(
				JSON.stringify({ type: "chat", text, mode, ...(pose && { pose }) }),
			);
		};

		let bodycam: BodyCamWidget | null = null;
		const mountBodycam = (): void => {
			element("bodycam-heading").hidden = false;
			element("bodycam").hidden = false;
			bodycam = new BodyCamWidget({
				canvas: element<HTMLCanvasElement>("bodycam-canvas"),
				atlases,
				getAvatar: () => view.localAvatar(),
				setStatus: (text) => {
					element("bodycam-status").textContent = text ?? "";
				},
				sendExpression: () => sendChat("<Chr>", 1),
				forwardTyping: (key) => {
					const input = element<HTMLInputElement>("composer-text");
					input.value += key;
					input.focus();
				},
			});
			view.onComposed = () => bodycam?.refresh();
			view.onRebuilt = () => bodycam?.restore();
		};

		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ type: "join", name, avatar }));
		});
		socket.addEventListener("message", (message) => {
			const parsed = parseServerMessage(message.data);
			if (!parsed) return;
			if (parsed.type === "welcome") {
				document.body.classList.add("joined");
				element("title-room").textContent = `- ${room}`;
				status.dataset.ready = "true";
				roster = parsed.roster;
				renderRoster(roster, manifest.avatars);
				view.setLocalAvatarID(parsed.avatar);
				for (const entry of parsed.history) view.compose(entry);
				oldestSeq = parsed.history[0]?.seq ?? null;
				historyDone = parsed.history.length < HISTORY_CHUNK;
				mountBodycam();
				element<HTMLInputElement>("composer-text").focus();
			} else if (parsed.type === "chat") {
				view.compose(parsed.entry);
			} else if (parsed.type === "history") {
				const previousHeight = scroller.scrollHeight;
				const previousTop = scroller.scrollTop;
				historyPending = false;
				if (parsed.entries.length === 0) {
					historyDone = true;
					return;
				}
				view.prepend(parsed.entries);
				oldestSeq = parsed.entries[0]?.seq ?? oldestSeq;
				historyDone = parsed.entries.length < HISTORY_CHUNK;
				scroller.scrollTop =
					previousTop + (scroller.scrollHeight - previousHeight);
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
				sendChat(text.value, mode);
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
