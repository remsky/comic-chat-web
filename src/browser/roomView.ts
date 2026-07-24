// Composes room entries into comic panels and keeps the rendered strip in sync.

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
	type ComicAnnotation,
	MAX_TALK_TOS,
	NEUTRAL_EMOTION_INDEX,
	type RoomEntry,
	type RosterEntry,
} from "../protocol/room.js";
import { parseAddressees } from "./addressing.js";
import type { AvatarAtlasCache } from "./avatarAssets.js";
import type { BackdropCache } from "./backdropAssets.js";
import { CanvasPanelRenderer } from "./canvasRenderer.js";
import { CanvasSurface } from "./canvasSurface.js";
import {
	CanvasTextMeasurer,
	createCanvasMeasureContext,
} from "./canvasText.js";
import { nearBottom } from "./dom.js";
import { syncPanelAccessibility } from "./panelAccessibility.js";
import { SeatBook, seatKey } from "./seatBook.js";
import type { Features } from "./storage.js";

// square twips panels like SetPanelsWide; 3000 is what the original computed for a maximized 1024x768 window (traces pin the 2300 floor)
const CLASSIC_UNIT = 3000;
// larger unit shrinks text relative to the panel (~32 chars/line, 5-line balloons) so messages split less
const MODERN_UNIT = 5200;

interface RenderedPanel {
	panel: UnitPanel;
	card: HTMLElement;
	surface: CanvasSurface;
}

interface Composition {
	registry: AvatarRegistry;
	emotions: EmotionEngine;
	page: PanelPage;
	// nickname -> slot id, accumulated as entries replay so addressee facing recomputes identically
	speakers: Map<string, number>;
	// slot id -> its latest nick, for the collision chip and addressee resolution
	seatNick: Map<number, string>;
	// present only when shared-avatar co-occupancy is on; null keeps the classic sprite-id slotting
	seats: SeatBook | null;
}

export class RoomView {
	private readonly rendered: RenderedPanel[] = [];
	private readonly entries: RoomEntry[] = [];
	private readonly resolveStyle: ReturnType<
		CanvasTextMeasurer["styleResolver"]
	>;
	private composition: Composition;
	private features: Features;
	private unit: number;
	private localUserId = "";
	private localSprite: number | null = null;
	private baseBackdrop = "";
	private showAllNames = false;
	// off: the "Show nametags" toggle is the sole control; flip to restore auto-chips for co-occupying bodies only
	private readonly autoCollisionChips = false;

	private autoScroll = true;
	onComposed?: () => void;
	onRebuilt?: () => void;

	constructor(
		private readonly atlases: AvatarAtlasCache,
		private readonly backdrops: BackdropCache,
		private readonly avatars: AvatarData[],
		private readonly container: HTMLElement,
		private readonly scroller: HTMLElement,
		features: Features,
	) {
		scroller.addEventListener("scroll", () => {
			this.autoScroll = nearBottom(scroller);
		});
		const measurer = new CanvasTextMeasurer(createCanvasMeasureContext());
		this.resolveStyle = measurer.styleResolver();
		this.features = features;
		this.unit = features.modernSizing ? MODERN_UNIT : CLASSIC_UNIT;
		this.composition = this.createComposition();
	}

	private createComposition(): Composition {
		// shared mode starts with an empty cast and grows a seat per person; classic keeps the fixed 1:1 sprite cast
		const registry = new AvatarRegistry(
			this.features.sharedAvatars ? [] : this.avatars,
		);
		const seats = this.features.sharedAvatars
			? new SeatBook(registry, this.avatars)
			: null;
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
			seatNick: new Map(),
			seats,
		};
	}

	// classic slots on the sprite id; shared resolves a per-person seat so same-avatar users co-exist
	private slotFor(userId: string, avatar: number): number {
		const { seats } = this.composition;
		return seats
			? seats.resolve(seatKey(userId, avatar), userId, avatar)
			: avatar;
	}

	// the backdrop a replayed chunk starts from; changes within it replay through feed
	setHistoryBackground(name: string): void {
		this.baseBackdrop = name;
		this.composition.page.backdrop = name;
	}

	private feed(entry: RoomEntry): void {
		const { registry, page, speakers, seatNick } = this.composition;
		if (entry.type === "background") {
			page.backdrop = entry.name;
			return;
		}
		if (entry.type === "announce") {
			// a rename teaches addressee facing the new nickname
			if (entry.kind === "nick") {
				const slot = this.slotFor(entry.userId, entry.avatar);
				speakers.set(toLowerAscii(entry.detail), slot);
				seatNick.set(slot, entry.detail);
			}
			return;
		}
		const slot = this.slotFor(entry.userId, entry.avatar);
		const avatar = registry.get(slot);
		if (!avatar) return;
		avatar.talkTo = entry.annotation.talkTos
			.map((nick) => speakers.get(toLowerAscii(nick)))
			.filter((id): id is number => id !== undefined && id !== slot);
		speakers.set(toLowerAscii(entry.name), slot);
		seatNick.set(slot, entry.name);
		// SayEntry::Execute applies the sender's resolved indexes verbatim (histent.cpp:94-106); no receiver inference
		avatar.setIndices(
			entry.annotation.faceIndex,
			entry.annotation.torsoIndex,
			entry.annotation.requested ? 1 : 0,
		);
		page.addLine(slot, entry.text, entry.mode);
	}

	compose(entry: RoomEntry): void {
		this.entries.push(entry);
		this.feed(entry);
		this.reconcile();
		this.onComposed?.();
	}

	// discard local history and recompose from scratch, matching what a fresh join would show
	reset(entries: RoomEntry[]): void {
		this.entries.length = 0;
		this.entries.push(...entries);
		this.composition = this.createComposition();
		for (const entry of this.entries) this.feed(entry);
		this.reconcile();
		this.onRebuilt?.();
	}

	prepend(entries: RoomEntry[]): void {
		const known = new Set(this.entries.map((entry) => entry.seq));
		const additions = entries.filter((entry) => !known.has(entry.seq));
		if (additions.length === 0) return;
		this.entries.unshift(...additions);
		this.composition = this.createComposition();
		for (const entry of this.entries) this.feed(entry);
		this.reconcile();
		this.onRebuilt?.();
	}

	setLocalUserId(userId: string): void {
		this.localUserId = userId;
	}

	setLocalAvatarID(avatarID: number): void {
		this.localSprite = avatarID;
	}

	// the local person's slot; in shared mode this creates their seat eagerly so prepareOutgoing and the bodycam have it
	private localSlot(): number | null {
		if (this.localSprite === null) return null;
		return this.slotFor(this.localUserId, this.localSprite);
	}

	entriesView(): readonly RoomEntry[] {
		return this.entries;
	}

	panelCount(): number {
		return this.rendered.length;
	}

	// File > Save's web stand-in: composite the newest panels into one PNG grid
	async exportPng(limit = Number.POSITIVE_INFINITY): Promise<Blob | null> {
		const panels = this.rendered.slice(-limit);
		if (panels.length === 0) return null;
		const size = 600;
		const perRow = 4;
		// the on-screen 1.2%-of-container grid gap, expressed against a 600px panel
		const gap = 31;
		const cols = Math.min(perRow, panels.length);
		const rows = Math.ceil(panels.length / perRow);
		const sheet = document.createElement("canvas");
		sheet.width = gap + cols * (size + gap);
		sheet.height = gap + rows * (size + gap);
		const context = sheet.getContext("2d");
		if (!context) return null;
		context.fillStyle = "#fff";
		context.fillRect(0, 0, sheet.width, sheet.height);
		panels.forEach((entry, index) => {
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
		const slot = this.localSlot();
		if (slot === null) return undefined;
		return this.composition.registry.get(slot);
	}

	// ChatPreSendText (textpose.cpp:115-125) then GetIndices/GetEmotions for the wire (protsupp.cpp:3040-3041)
	prepareOutgoing(
		text: string,
		roster: readonly RosterEntry[],
	): ComicAnnotation | undefined {
		const avatar = this.localAvatar();
		if (!avatar) return undefined;
		if (avatar.freeze === AF_UNFROZEN)
			avatar.updateBody(
				avatar.getBodyFromOptions(
					this.composition.emotions.getEmotionsFromString(text),
				),
			);
		const indices = avatar.getIndices();
		const requested = indices.requested !== 0;
		const talkTos: string[] = [];
		const localSlot = this.localSlot();
		if (localSlot !== null) {
			const { speakers, seatNick, seats } = this.composition;
			for (const id of parseAddressees(text, speakers, localSlot)) {
				// shared slots resolve to the seat's own nick; classic ones to the sprite's current wearer
				const nick = seats
					? seatNick.get(id)
					: roster.find((seat) => seat.avatar === id)?.name;
				if (nick !== undefined) talkTos.push(nick);
				if (talkTos.length >= MAX_TALK_TOS) break;
			}
		}
		if (avatar.data.type === "simple") {
			// GetEmotions carries the body emotion in the face slots (avatar.cpp:811-817)
			const body = avatar.data.bodies[indices.torsoIndex];
			return {
				faceIndex: 0,
				faceEmotionIndex: body?.emotionIndex ?? NEUTRAL_EMOTION_INDEX,
				faceIntensity: (body?.intensityTenths ?? 0) / 10,
				torsoIndex: indices.torsoIndex,
				torsoEmotionIndex: 0,
				torsoIntensity: 0,
				requested,
				talkTos,
			};
		}
		const face = avatar.data.faces[indices.faceIndex];
		const torso = avatar.data.torsos[indices.torsoIndex];
		return {
			faceIndex: indices.faceIndex,
			faceEmotionIndex: face?.emotionIndex ?? NEUTRAL_EMOTION_INDEX,
			faceIntensity: (face?.intensityTenths ?? 0) / 10,
			torsoIndex: indices.torsoIndex,
			torsoEmotionIndex: torso?.emotionIndex ?? NEUTRAL_EMOTION_INDEX,
			torsoIntensity: (torso?.intensityTenths ?? 0) / 10,
			requested,
			talkTos,
		};
	}

	// rebuilds with fresh registry/emotion/rand state and replays history, so the result matches a fresh join in that mode
	setFeatures(features: Features): void {
		if (
			features.modernSizing === this.features.modernSizing &&
			features.sharedAvatars === this.features.sharedAvatars
		)
			return;
		this.features = features;
		this.unit = features.modernSizing ? MODERN_UNIT : CLASSIC_UNIT;
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
		const { registry, seats } = this.composition;
		// seat avatars carry the sprite's character name, so accessibility labels resolve in either mode
		const names = seats ? registry.avatars.map((a) => a.data) : this.avatars;
		syncPanelAccessibility(canvas, transcript, panel, names);
		const labels = this.chipLabels(panel);
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
					...(labels ? { labels } : {}),
				},
			);
			renderer.render(panel);
		});
		return { panel, card, surface };
	}

	// re-label existing panels without recomposing; nametags are a render-time choice, not a layout one
	setShowAllNames(on: boolean): void {
		if (on === this.showAllNames) return;
		this.showAllNames = on;
		for (const rendered of this.rendered) {
			rendered.surface.dispose();
			rendered.card.remove();
		}
		this.rendered.length = 0;
		this.reconcile();
	}

	// nick chips: all bodies when the toggle is on; else the gated-off co-occupancy-only path
	private chipLabels(panel: UnitPanel): Map<number, string> | undefined {
		const { seats, seatNick } = this.composition;
		if (this.showAllNames) {
			const labels = new Map<number, string>();
			for (const body of panel.bodies) {
				const nick = seatNick.get(body.avatarID);
				if (nick !== undefined) labels.set(body.avatarID, nick);
			}
			return labels.size > 0 ? labels : undefined;
		}
		if (!this.autoCollisionChips || !seats) return undefined;
		const spriteCount = new Map<number, number>();
		for (const body of panel.bodies) {
			const sprite = seats.spriteOf(body.avatarID);
			if (sprite !== undefined)
				spriteCount.set(sprite, (spriteCount.get(sprite) ?? 0) + 1);
		}
		const labels = new Map<number, string>();
		for (const body of panel.bodies) {
			const sprite = seats.spriteOf(body.avatarID);
			if (sprite === undefined || (spriteCount.get(sprite) ?? 0) < 2) continue;
			const nick = seatNick.get(body.avatarID);
			if (nick !== undefined) labels.set(body.avatarID, nick);
		}
		return labels.size > 0 ? labels : undefined;
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
