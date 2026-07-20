// Live room client: joins a Durable Object room and composes every message into panels.

import {
	AF_UNFROZEN,
	type Avatar,
	type AvatarData,
	AvatarRegistry,
} from "../engine/avatar.js";
import { toLowerAscii } from "../engine/ctype.js";
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
	MESSAGE_BLOCKED_REASON,
	type PoseIndices,
	parseRoomListings,
	parseServerMessage,
	RATE_LIMIT_REASON,
	type RosterEntry,
} from "../protocol/room.js";
import { parseAddressees } from "./addressing.js";
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
import {
	describeWebSocketClose,
	historyHasGap,
	reconnectDelay,
	shouldReconnect,
} from "./websocketReconnect.js";

// square twips panels like SetPanelsWide; 3000 is what the original computed for a maximized 1024x768 window (traces pin the 2300 floor)
const CLASSIC_UNIT = 3000;
// larger unit shrinks text relative to the panel (~32 chars/line, 5-line balloons) so messages split less
const MODERN_UNIT = 5200;
const MODERN_TWEAKS_KEY = "comic-chat.modern-tweaks";
const TEXT_VIEW_KEY = "comic-chat.text-view";
// client mirror of the server send bucket (worker/room.ts): kill Enter-mashing before it hits the wire
const SEND_BURST = 5;
const SEND_REFILL_MS = 1000;

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

const RELEASE_CHIP: Record<string, { label: string; tone: string }> = {
	buck: { label: "v2.1b", tone: "v2" },
	kirby: { label: "v2.1b", tone: "v2" },
	veronica: { label: "v2.1b", tone: "v2" },
	kevin: { label: "ART1", tone: "art1" },
	kwensa: { label: "ART1", tone: "art1" },
	maynard: { label: "ART1", tone: "art1" },
	rebecca: { label: "ART1", tone: "art1" },
	sage: { label: "ART1", tone: "art1" },
	scotty: { label: "ART1", tone: "art1" },
};

// backdrops sourced from artpack1 rather than the base comicart pack; base ones stay unlabeled
const BACKDROP_PACK: Record<string, string> = {
	den: "ART1",
	volcano: "ART1",
};

interface Composition {
	registry: AvatarRegistry;
	emotions: EmotionEngine;
	page: PanelPage;
	// nickname -> avatarID, accumulated as entries replay so addressee facing recomputes identically
	speakers: Map<string, number>;
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
		return {
			registry,
			emotions: new EmotionEngine(),
			page,
			speakers: new Map(),
		};
	}

	// welcome's current room backdrop; historical changes replay through feed
	setBackground(name: string): void {
		this.baseBackdrop = name;
		this.composition.page.backdrop = name;
	}

	private feed(entry: ChatEntry): void {
		const { registry, emotions, page, speakers } = this.composition;
		if (entry.mode === BACKGROUND_MODE) {
			page.backdrop = entry.text;
			return;
		}
		const avatar = registry.get(entry.avatar);
		if (!avatar) return;
		avatar.talkTo = parseAddressees(entry.text, speakers, entry.avatar);
		speakers.set(toLowerAscii(entry.name), entry.avatar);
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

	// discard local history and recompose from scratch, matching what a fresh join would show
	reset(entries: ChatEntry[]): void {
		this.entries.length = 0;
		this.entries.push(...entries);
		this.composition = this.createComposition();
		for (const entry of this.entries) this.feed(entry);
		this.reconcile();
		this.onRebuilt?.();
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
	for (const avatar of avatars) {
		const label = document.createElement("label");
		label.className = "character-option";
		const radio = document.createElement("input");
		radio.type = "radio";
		radio.name = "avatar";
		radio.value = String(avatar.avatarID);
		radio.autocomplete = "off";
		// no default pick; selection is required, enforced inline on submit (see wireJoinForm submit)
		radio.addEventListener("change", () => {
			element("join-avatar-error").hidden = true;
		});
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
		const release = RELEASE_CHIP[avatar.name];
		if (release) {
			const chip = document.createElement("span");
			chip.className = `character-option-chip character-option-chip--${release.tone}`;
			chip.textContent = release.label;
			content.append(chip);
		}
		label.append(radio, content);
		options.append(label);
	}
}

// the room the user wants selected, honored once the directory options load
let desiredRoom = new URLSearchParams(location.search).get("room") ?? "";

// the Chat Room List, directory-backed instead of IRC LIST; fills the room dropdown
async function refreshRoomList(): Promise<void> {
	const select = element<HTMLSelectElement>("join-room");
	let listings: ReturnType<typeof parseRoomListings>;
	try {
		const response = await fetch("/api/rooms");
		listings = response.ok ? parseRoomListings(await response.json()) : null;
	} catch {
		listings = null;
	}
	// keep the current selection across a failed or empty refresh so the field never blanks out
	if (!listings || listings.length === 0) return;
	const keep = select.value || desiredRoom;
	select.replaceChildren(
		...listings.map((listing) => {
			const option = document.createElement("option");
			option.value = listing.name;
			const count =
				listing.members === 1 ? "1 member" : `${listing.members} members`;
			option.textContent = `${listing.name} (${count})`;
			return option;
		}),
	);
	if (keep && listings.some((listing) => listing.name === keep))
		select.value = keep;
	desiredRoom = "";
}

function wireRoomList(): void {
	// refresh counts when the user opens the dropdown, so they stay fresh without a manual button
	element<HTMLSelectElement>("join-room").addEventListener(
		"pointerdown",
		() => {
			void refreshRoomList();
		},
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

// pin the app to the visible viewport so the iOS keyboard slides over nothing but the composer
function trackVisibleViewport(): void {
	const viewport = window.visualViewport;
	if (!viewport) return;
	const apply = () => {
		document.documentElement.style.setProperty(
			"--app-height",
			`${viewport.height}px`,
		);
		// follow any iOS scroll offset so the pinned app stays glued to the visible area
		document.body.style.transform = `translateY(${viewport.offsetTop}px)`;
	};
	viewport.addEventListener("resize", apply);
	viewport.addEventListener("scroll", apply);
	apply();
}

// on phones the sidebar moves into a tap-open sheet above the send bar, one section at a time
function wireMobilePanels(): void {
	const sidebar = document.querySelector<HTMLElement>(".sidebar");
	const toolbar = document.querySelector<HTMLElement>(".mobile-toolbar");
	const sheet = element("mobile-sheet");
	const workspace = element("room");
	if (!sidebar || !toolbar) return;
	const buttons = [
		...toolbar.querySelectorAll<HTMLButtonElement>(".toolbar-button"),
	];
	const mobile = window.matchMedia("(max-width: 760px)");

	const closePanel = () => {
		sheet.hidden = true;
		sheet.removeAttribute("data-panel");
		for (const button of buttons) button.setAttribute("aria-expanded", "false");
	};

	const openPanel = (panel: string, active: HTMLButtonElement) => {
		sheet.dataset.panel = panel;
		sheet.hidden = false;
		for (const button of buttons)
			button.setAttribute("aria-expanded", String(button === active));
	};

	// desktop shows the sidebar inline; mobile parks it in the sheet
	const placeSidebar = () => {
		const host = mobile.matches ? sheet : workspace;
		if (sidebar.parentElement !== host) host.append(sidebar);
		if (!mobile.matches) closePanel();
	};

	for (const button of buttons) {
		button.addEventListener("click", () => {
			const panel = button.dataset.panel ?? "";
			if (!sheet.hidden && sheet.dataset.panel === panel) closePanel();
			else openPanel(panel, button);
		});
	}

	// dismiss the sheet on a tap outside it (but not on the wheel/roster inside)
	document.addEventListener("pointerdown", (event) => {
		if (sheet.hidden) return;
		const target = event.target;
		if (
			target instanceof Node &&
			(sheet.contains(target) || toolbar.contains(target))
		)
			return;
		closePanel();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !sheet.hidden) closePanel();
	});

	mobile.addEventListener("change", placeSidebar);
	placeSidebar();
}

async function main(): Promise<void> {
	const status = element("status");
	trackVisibleViewport();
	wireMobilePanels();
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
				const pack = BACKDROP_PACK[info.name];
				option.textContent = pack
					? `${displayName(info.name)} (${pack})`
					: displayName(info.name);
				return option;
			}),
		);
		element("background-picker").hidden = false;
		const backgroundButton = document.querySelector<HTMLButtonElement>(
			'.toolbar-button[data-panel="bg"]',
		);
		if (backgroundButton) backgroundButton.hidden = false;
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

	const roomInput = element<HTMLSelectElement>("join-room");
	element<HTMLFormElement>("join-form").addEventListener("submit", (event) => {
		event.preventDefault();
		// the dropdown only offers directory rooms, so any selected value is a valid room
		const room = roomInput.value.trim();
		const name = element<HTMLInputElement>("join-name").value.trim();
		const avatar = Number(
			element<HTMLFormElement>("join-form").querySelector<HTMLInputElement>(
				'input[name="avatar"]:checked',
			)?.value,
		);
		if (!room || !name) return;
		// inline requirement instead of a native bubble, which auto-scrolls the picker jarringly
		const avatarError = element("join-avatar-error");
		if (Number.isNaN(avatar)) {
			avatarError.hidden = false;
			return;
		}
		avatarError.hidden = true;
		element<HTMLFormElement>("join-form")
			.querySelector("button")
			?.setAttribute("disabled", "");
		history.replaceState(null, "", `?room=${encodeURIComponent(room)}`);
		const protocol = location.protocol === "https:" ? "wss" : "ws";
		const socketUrl = `${protocol}://${location.host}/api/rooms/${room}/websocket`;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | undefined;
		let reconnectAttempt = 0;
		let reconnectAllowed = true;
		let hasWelcomed = false;
		let statusRestoreTimer: number | undefined;
		let filterTimer: number | undefined;
		let lastComposerSend: string | null = null;
		status.textContent = "Connecting…";
		delete status.dataset.ready;
		const scroller = element("strip");
		const composer = element<HTMLFormElement>("composer");
		const setComposerEnabled = (enabled: boolean): void => {
			for (const control of composer.querySelectorAll<
				HTMLInputElement | HTMLSelectElement | HTMLButtonElement
			>("input, select, button"))
				control.disabled = !enabled;
		};
		setComposerEnabled(false);
		let oldestSeq: number | null = null;
		let historyPending = false;
		let historyDone = false;

		const requestOlderHistory = (): void => {
			if (
				historyPending ||
				historyDone ||
				oldestSeq === null ||
				socket?.readyState !== WebSocket.OPEN
			)
				return;
			historyPending = true;
			socket.send(JSON.stringify({ type: "history", before: oldestSeq }));
		};
		scroller.addEventListener("scroll", () => {
			if (scroller.scrollTop < 80) requestOlderHistory();
		});

		// cui.Say: run the presend hook, then transmit text plus pose indices
		const sendChat = (text: string, mode: number): boolean => {
			if (socket?.readyState !== WebSocket.OPEN) return false;
			const pose = view.prepareOutgoing(text);
			socket.send(
				JSON.stringify({ type: "chat", text, mode, ...(pose && { pose }) }),
			);
			return true;
		};

		backgroundSelect.addEventListener("change", () => {
			if (socket?.readyState !== WebSocket.OPEN) return;
			socket.send(
				JSON.stringify({ type: "background", name: backgroundSelect.value }),
			);
		});

		// Leave: drop the socket and return to the connect screen. A reload is the
		// clean teardown here — closing the tab's socket broadcasts our "left" to the
		// room, and the connect screen re-renders with the room prefilled from the URL.
		const leaveRoom = (): void => {
			reconnectAllowed = false;
			if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
			socket?.close();
			location.reload();
		};
		element<HTMLButtonElement>("leave-room").addEventListener(
			"click",
			leaveRoom,
		);
		// the titlebar name doubles as a "home" link back to the connect screen
		element<HTMLButtonElement>("title-home").addEventListener(
			"click",
			leaveRoom,
		);

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

		// the server dropped the message: put the text back for a resend and toast the status briefly
		const notifyRateLimited = (): void => {
			const input = element<HTMLInputElement>("composer-text");
			if (lastComposerSend !== null && !input.value)
				input.value = lastComposerSend;
			lastComposerSend = null;
			status.textContent = "Sending too fast; the last message was dropped.";
			delete status.dataset.ready;
			if (statusRestoreTimer !== undefined)
				window.clearTimeout(statusRestoreTimer);
			statusRestoreTimer = window.setTimeout(() => {
				statusRestoreTimer = undefined;
				if (socket?.readyState === WebSocket.OPEN)
					status.dataset.ready = "true";
			}, 4000);
		};

		// the content filter rejected the message: lock the composer and count the mute down inline
		const notifyBlocked = (retryAfter: number | undefined): void => {
			const input = element<HTMLInputElement>("composer-text");
			if (lastComposerSend !== null && !input.value)
				input.value = lastComposerSend;
			lastComposerSend = null;
			const notice = element("filter-notice");
			let remaining = Math.max(1, Math.ceil((retryAfter ?? 30_000) / 1000));
			const render = (): void => {
				notice.textContent = `Content filter: wait ${remaining}s before trying again.`;
			};
			const release = (): void => {
				if (filterTimer !== undefined) window.clearInterval(filterTimer);
				filterTimer = undefined;
				notice.hidden = true;
				if (socket?.readyState === WebSocket.OPEN) {
					setComposerEnabled(true);
					input.focus();
				}
			};
			setComposerEnabled(false);
			notice.hidden = false;
			render();
			if (filterTimer !== undefined) window.clearInterval(filterTimer);
			filterTimer = window.setInterval(() => {
				remaining -= 1;
				if (remaining <= 0) release();
				else render();
			}, 1000);
		};

		const handleMessage = (message: MessageEvent): void => {
			const parsed = parseServerMessage(message.data);
			if (!parsed) return;
			if (parsed.type === "welcome") {
				const previousNewestSeq = view.entriesView().at(-1)?.seq ?? 0;
				document.body.classList.add("joined");
				element("title-room").textContent = `- ${room}`;
				status.textContent = "Connected.";
				status.dataset.ready = "true";
				if (filterTimer !== undefined) {
					window.clearInterval(filterTimer);
					filterTimer = undefined;
					element("filter-notice").hidden = true;
				}
				setComposerEnabled(true);
				reconnectAttempt = 0;
				roster = parsed.roster;
				renderRoster(roster, manifest.avatars);
				view.setLocalAvatarID(parsed.avatar);
				backgroundSelect.value = parsed.background ?? "";
				const firstSeq = parsed.history[0]?.seq;
				if (hasWelcomed && historyHasGap(previousNewestSeq, firstSeq)) {
					// the outage outran the welcome chunk; recompose wholesale so the strip matches a fresh join
					view.setBackground(parsed.background ?? "");
					view.reset(parsed.history);
					oldestSeq = firstSeq ?? null;
					historyDone = parsed.history.length < HISTORY_CHUNK;
				} else if (hasWelcomed) {
					// missed entries resume the stream; any mode-6 among them brings the backdrop forward
					for (const entry of parsed.history)
						if (entry.seq > previousNewestSeq) view.compose(entry);
					if (oldestSeq === null) {
						oldestSeq = firstSeq ?? null;
						historyDone = parsed.history.length < HISTORY_CHUNK;
					}
				} else {
					view.setBackground(parsed.background ?? "");
					for (const entry of parsed.history) view.compose(entry);
					oldestSeq = firstSeq ?? null;
					historyDone = parsed.history.length < HISTORY_CHUNK;
				}
				historyPending = false;
				if (!bodycam) mountBodycam();
				hasWelcomed = true;
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
				if (parsed.reason === RATE_LIMIT_REASON && hasWelcomed) {
					notifyRateLimited();
				} else if (parsed.reason === MESSAGE_BLOCKED_REASON && hasWelcomed) {
					notifyBlocked(parsed.retryAfter);
				} else {
					status.textContent = parsed.reason;
					delete status.dataset.ready;
				}
			}
		};

		const connect = (): void => {
			if (reconnectTimer !== undefined) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = undefined;
			}
			if (
				socket?.readyState === WebSocket.CONNECTING ||
				socket?.readyState === WebSocket.OPEN
			)
				return;
			status.textContent = hasWelcomed ? "Reconnecting…" : "Connecting…";
			delete status.dataset.ready;
			const next = new WebSocket(socketUrl);
			socket = next;
			next.addEventListener("open", () => {
				next.send(JSON.stringify({ type: "join", name, avatar }));
			});
			next.addEventListener("message", handleMessage);
			next.addEventListener("close", (event) => {
				if (socket !== next) return;
				socket = null;
				historyPending = false;
				setComposerEnabled(false);
				delete status.dataset.ready;
				const detail = describeWebSocketClose(event.code, event.reason);
				const delay = reconnectDelay(reconnectAttempt);
				if (!shouldReconnect(event.code)) {
					reconnectAllowed = false;
					status.textContent = `Disconnected: ${detail}. Reload to rejoin.`;
					return;
				}
				reconnectAttempt++;
				status.textContent = `Disconnected: ${detail}. Reconnecting in ${delay / 1000}s…`;
				reconnectTimer = window.setTimeout(connect, delay);
			});
		};

		window.addEventListener("online", () => {
			if (socket === null && reconnectAllowed) connect();
		});
		connect();

		// client-side mirror of the server bucket: a mash drains tokens locally and toasts instead of flooding the wire
		let sendTokens = SEND_BURST;
		let sendAt = 0;
		const takeSendToken = (): boolean => {
			const now = Date.now();
			sendTokens = Math.min(
				SEND_BURST,
				sendTokens + (now - sendAt) / SEND_REFILL_MS,
			);
			sendAt = now;
			if (sendTokens < 1) return false;
			sendTokens -= 1;
			return true;
		};
		composer.addEventListener("submit", (sendEvent) => {
			sendEvent.preventDefault();
			const text = element<HTMLInputElement>("composer-text");
			const mode = Number(element<HTMLSelectElement>("composer-mode").value);
			if (!text.value.trim()) return;
			if (!takeSendToken()) {
				status.textContent = "Slow down a moment.";
				delete status.dataset.ready;
				if (statusRestoreTimer !== undefined)
					window.clearTimeout(statusRestoreTimer);
				statusRestoreTimer = window.setTimeout(() => {
					statusRestoreTimer = undefined;
					if (socket?.readyState === WebSocket.OPEN)
						status.dataset.ready = "true";
				}, 1500);
				return;
			}
			if (sendChat(text.value, mode)) {
				lastComposerSend = text.value;
				text.value = "";
			}
		});
	});
}

main().catch((error: unknown) => {
	const status = document.getElementById("status");
	if (status)
		status.textContent = error instanceof Error ? error.message : String(error);
	throw error;
});
