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
	BACKGROUND_MODE,
	type ChatEntry,
	HISTORY_CHUNK,
	type PoseIndices,
	parseRoomListings,
	parseServerMessage,
	type RosterEntry,
} from "../protocol/room.js";
import { AvatarAtlasCache } from "./avatarAssets.js";
import { BackdropCache } from "./backdropAssets.js";
import { BodyCamWidget } from "./bodycamWidget.js";
import { CanvasPanelRenderer } from "./canvasRenderer.js";
import { CanvasSurface } from "./canvasSurface.js";
import {
	CanvasTextMeasurer,
	createCanvasMeasureContext,
	loadCanvasFonts,
} from "./canvasText.js";
import { syncPanelAccessibility } from "./panelAccessibility.js";
import { transcriptHeader, transcriptLine } from "./textView.js";

// square twips panels like SetPanelsWide; 3000 is what the original computed for a maximized 1024x768 window (traces pin the 2300 floor)
const CLASSIC_UNIT = 3000;
// larger unit shrinks text relative to the panel (~25 chars/line, 4-line balloons) so messages split less
const MODERN_UNIT = 4000;
const MODERN_TWEAKS_KEY = "comic-chat.modern-tweaks";
const TEXT_VIEW_KEY = "comic-chat.text-view";

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

function avatarIndexForName(name: string, count: number): number {
	if (count < 1) return -1;
	const normalized = name.trim().toLowerCase();
	if (!normalized) return 0;
	let hash = 0;
	for (const character of normalized)
		hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
	return hash % count;
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
	private baseBackdrop = "";

	private autoScroll = true;
	onComposed?: () => void;
	onRebuilt?: () => void;

	constructor(
		private readonly atlases: AvatarAtlasCache,
		private readonly backdrops: BackdropCache,
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
		page.backdrop = this.baseBackdrop;
		return { registry, emotions: new EmotionEngine(), page };
	}

	// welcome's current room backdrop; historical changes replay through feed
	setBackground(name: string): void {
		this.baseBackdrop = name;
		this.composition.page.backdrop = name;
	}

	private feed(entry: ChatEntry): void {
		const { registry, emotions, page } = this.composition;
		if (entry.mode === BACKGROUND_MODE) {
			page.backdrop = entry.text;
			return;
		}
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

	entriesView(): readonly ChatEntry[] {
		return this.entries;
	}

	// File > Save's web stand-in: composite the strip grid into one PNG
	async exportPng(): Promise<Blob | null> {
		if (this.rendered.length === 0) return null;
		const size = 600;
		const perRow = 4;
		// the on-screen 1.2%-of-container grid gap, expressed against a 600px panel
		const gap = 31;
		const cols = Math.min(perRow, this.rendered.length);
		const rows = Math.ceil(this.rendered.length / perRow);
		const sheet = document.createElement("canvas");
		sheet.width = gap + cols * (size + gap);
		sheet.height = gap + rows * (size + gap);
		const context = sheet.getContext("2d");
		if (!context) return null;
		context.fillStyle = "#fff";
		context.fillRect(0, 0, sheet.width, sheet.height);
		this.rendered.forEach((entry, index) => {
			const canvas = entry.card.querySelector("canvas");
			if (!canvas) return;
			context.drawImage(
				canvas,
				gap + (index % perRow) * (size + gap),
				gap + Math.floor(index / perRow) * (size + gap),
				size,
				size,
			);
		});
		return new Promise((resolve) => sheet.toBlob(resolve, "image/png"));
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
				{
					unitWidth: unit,
					unitHeight: unit,
					resolveBackdrop: (name) => this.backdrops.get(name),
				},
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

function wireJoinForm(avatars: AvatarData[], atlases: AvatarAtlasCache): void {
	const picker = element<HTMLFieldSetElement>("join-avatar");
	const options = picker.querySelector<HTMLElement>(".character-options");
	if (!options) throw new Error("character picker is missing its options");
	const radios = avatars.map((avatar, index) => {
		const label = document.createElement("label");
		label.className = "character-option";
		const radio = document.createElement("input");
		radio.type = "radio";
		radio.name = "avatar";
		radio.value = String(avatar.avatarID);
		radio.autocomplete = "off";
		radio.checked = index === 0;
		const canvas = document.createElement("canvas");
		canvas.width = 40;
		canvas.height = 40;
		canvas.setAttribute("aria-hidden", "true");
		const name = document.createElement("span");
		name.className = "character-option-name";
		name.textContent = displayName(avatar.name);
		const content = document.createElement("span");
		content.className = "character-option-content";
		const icon = avatar.poses.find((pose) => pose.poseID === avatar.iconPoseID);
		if (icon?.sprite) {
			const context = canvas.getContext("2d");
			context?.drawImage(
				atlases.get(icon),
				icon.sprite.x,
				icon.sprite.y,
				icon.width,
				icon.height,
				0,
				0,
				40,
				40,
			);
		}
		content.append(canvas, name);
		label.append(radio, content);
		options.append(label);
		return radio;
	});
	const nameInput = element<HTMLInputElement>("join-name");
	const suggestAvatar = (): void => {
		const index = avatarIndexForName(nameInput.value, radios.length);
		const radio = radios[index];
		if (!radio) return;
		radio.checked = true;
		radio.closest(".character-option")?.scrollIntoView({ block: "nearest" });
	};
	nameInput.addEventListener("change", suggestAvatar);
	suggestAvatar();
	const params = new URLSearchParams(location.search);
	const room = params.get("room");
	if (room) element<HTMLInputElement>("join-room").value = room;
}

// the Chat Room List, directory-backed instead of IRC LIST; clicking a row fills the room field
async function refreshRoomList(): Promise<void> {
	const list = element<HTMLUListElement>("room-list");
	const note = (text: string): void => {
		const item = document.createElement("li");
		item.className = "room-list-empty";
		item.textContent = text;
		list.replaceChildren(item);
	};
	note("Loading…");
	let listings: ReturnType<typeof parseRoomListings>;
	try {
		const response = await fetch("/api/rooms");
		listings = response.ok ? parseRoomListings(await response.json()) : null;
	} catch {
		listings = null;
	}
	if (!listings) {
		note("Room list unavailable.");
		return;
	}
	if (listings.length === 0) {
		note("No rooms yet. Name one to create it.");
		return;
	}
	list.replaceChildren(
		...listings.map((listing) => {
			const item = document.createElement("li");
			const row = document.createElement("button");
			row.type = "button";
			const name = document.createElement("strong");
			name.textContent = listing.name;
			const members = document.createElement("span");
			members.textContent =
				listing.members === 1 ? "1 member" : `${listing.members} members`;
			row.append(name, members);
			row.addEventListener("click", () => {
				element<HTMLInputElement>("join-room").value = listing.name;
				element<HTMLInputElement>("join-name").focus();
			});
			item.append(row);
			return item;
		}),
	);
}

function wireRoomList(): void {
	element<HTMLButtonElement>("room-list-update").addEventListener("click", () =>
		refreshRoomList(),
	);
	void refreshRoomList();
}

function renderTranscript(
	list: HTMLOListElement,
	entries: readonly ChatEntry[],
): void {
	const items: HTMLLIElement[] = [];
	for (const entry of entries) {
		const line = transcriptLine(entry);
		if (!line) continue;
		const item = document.createElement("li");
		item.className = `transcript-${line.kind}`;
		if (line.kind === "system") {
			item.textContent = `${line.name} ${line.body}`;
		} else {
			const header = document.createElement("strong");
			header.textContent = transcriptHeader(line);
			item.append(header, ` ${line.body}`);
		}
		items.push(item);
	}
	list.replaceChildren(...items);
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
	const backdrops = new BackdropCache();
	await Promise.all([atlases.preload(manifest.avatars), backdrops.load()]);
	wireJoinForm(manifest.avatars, atlases);
	wireRoomList();
	const backgroundSelect = element<HTMLSelectElement>("background-select");
	if (backdrops.backdrops.length > 0) {
		const none = document.createElement("option");
		none.value = "";
		none.textContent = "None";
		backgroundSelect.append(
			none,
			...backdrops.backdrops.map((info) => {
				const option = document.createElement("option");
				option.value = info.name;
				option.textContent = displayName(info.name);
				return option;
			}),
		);
		element("background-picker").hidden = false;
	}
	status.dataset.ready = "true";

	let roster: RosterEntry[] = [];
	const tweaks = element<HTMLInputElement>("modern-toggle");
	tweaks.checked = localStorage.getItem(MODERN_TWEAKS_KEY) !== "off";
	const view = new RoomView(
		atlases,
		backdrops,
		manifest.avatars,
		element("panels"),
		element("strip"),
		tweaks.checked,
	);
	tweaks.addEventListener("change", () => {
		localStorage.setItem(MODERN_TWEAKS_KEY, tweaks.checked ? "on" : "off");
		view.setModernTweaks(tweaks.checked);
	});

	// ID_VIEW_COMICS / ID_VIEW_TEXT: one strip pane, two renderings
	const textToggle = element<HTMLInputElement>("text-toggle");
	textToggle.checked = localStorage.getItem(TEXT_VIEW_KEY) === "on";
	document.body.classList.toggle("text-view", textToggle.checked);
	textToggle.addEventListener("change", () => {
		localStorage.setItem(TEXT_VIEW_KEY, textToggle.checked ? "on" : "off");
		document.body.classList.toggle("text-view", textToggle.checked);
		const strip = element("strip");
		strip.scrollTop = strip.scrollHeight;
	});

	element<HTMLFormElement>("join-form").addEventListener("submit", (event) => {
		event.preventDefault();
		element<HTMLFormElement>("join-form")
			.querySelector("button")
			?.setAttribute("disabled", "");
		const room = element<HTMLInputElement>("join-room").value.trim();
		const name = element<HTMLInputElement>("join-name").value.trim();
		const avatar = Number(
			element<HTMLFormElement>("join-form").querySelector<HTMLInputElement>(
				'input[name="avatar"]:checked',
			)?.value,
		);
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

		backgroundSelect.addEventListener("change", () => {
			socket.send(
				JSON.stringify({ type: "background", name: backgroundSelect.value }),
			);
		});

		element<HTMLButtonElement>("save-strip").addEventListener(
			"click",
			async () => {
				const blob = await view.exportPng();
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement("a");
				anchor.href = url;
				const stamp = new Date().toISOString().slice(0, 16).replace(":", "-");
				anchor.download = `comic-chat-${room}-${stamp}.png`;
				anchor.click();
				URL.revokeObjectURL(url);
			},
		);

		const transcript = element<HTMLOListElement>("transcript");
		const refreshTranscript = (): void => {
			const atBottom =
				scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
			renderTranscript(transcript, view.entriesView());
			if (atBottom) scroller.scrollTop = scroller.scrollHeight;
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
			view.onComposed = () => {
				bodycam?.refresh();
				refreshTranscript();
			};
			view.onRebuilt = () => {
				bodycam?.restore();
				refreshTranscript();
			};
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
				view.setBackground(parsed.background ?? "");
				backgroundSelect.value = parsed.background ?? "";
				for (const entry of parsed.history) view.compose(entry);
				oldestSeq = parsed.history[0]?.seq ?? null;
				historyDone = parsed.history.length < HISTORY_CHUNK;
				mountBodycam();
				refreshTranscript();
				element<HTMLInputElement>("composer-text").focus();
			} else if (parsed.type === "chat") {
				view.compose(parsed.entry);
				if (parsed.entry.mode === BACKGROUND_MODE)
					backgroundSelect.value = parsed.entry.text;
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
