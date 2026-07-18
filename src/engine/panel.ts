// Pure panel composition helpers, starting with avatar camera geometry from panel.cpp.

import {
	type Avatar,
	type AvatarBody,
	type AvatarData,
	type AvatarRegistry,
	cloneBody,
} from "./avatar.js";
import { checkWord } from "./emotion.js";
import type { MsvcRand } from "./rand.js";
import { round } from "./vector2d.js";

export interface PlacedAvatar {
	avatar: Avatar;
	body: AvatarBody;
}

export const BR_SPEAKER = 0;
export const BR_IMPORTANT = 1;
export const BR_GOODIDEA = 2;
export const BR_OK = 3;

export interface PanelBodyRecord extends PlacedAvatar {
	priority: number;
}

export function filterSpeakerBodies(
	bodies: readonly AvatarBody[],
	avatars: readonly Avatar[],
	balloonSpeakerIDs: ReadonlySet<number>,
): PanelBodyRecord[] {
	return bodies.flatMap((body) => {
		const avatar = avatars.find(
			(candidate) => candidate.avatarID === body.avatarID,
		);
		if (!avatar) return [];
		const requested = avatar.body?.requested === true;
		if (!requested && !balloonSpeakerIDs.has(body.avatarID)) return [];
		return [{ avatar, body, priority: BR_SPEAKER }];
	});
}

function displacementPenalty(records: readonly PanelBodyRecord[]): number {
	let penalty = 0;
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (!record) continue;
		if (i > 0 && record.avatar.lastRight !== records[i - 1]?.body.avatarID)
			penalty++;
		if (
			i < records.length - 1 &&
			record.avatar.lastLeft !== records[i + 1]?.body.avatarID
		)
			penalty++;
	}
	return penalty;
}

function pairRating(
	b1: PanelBodyRecord,
	b2: PanelBodyRecord,
	deltaPlacement: number,
): number {
	let desiredDir = false;
	let distance = deltaPlacement;
	if (distance <= 0) {
		desiredDir = true;
		distance = -distance;
	}

	let rating = 0;
	if (b1.avatar.talkTo.length === 0) {
		if (b1.body.flip !== desiredDir) rating += 4;
		if (b2.body.flip === desiredDir) rating += 2;
		return rating;
	}

	for (const avatarID of b1.avatar.talkTo) {
		if (avatarID !== b2.body.avatarID) continue;
		if (b1.body.flip === desiredDir) rating += 4 * (distance - 1);
		else rating += 40;
		if (b2.body.flip === desiredDir) rating += 4;
	}
	return rating;
}

function placementRating(
	placed: PanelBodyRecord[],
	candidate: PanelBodyRecord,
	index: number,
): { rating: number; flip: boolean } {
	placed.splice(index, 0, candidate);
	const penalty = displacementPenalty(placed);
	let ratingRight = penalty;
	let ratingLeft = penalty;

	candidate.body.flip = false;
	for (let i = 0; i < placed.length; i++) {
		const first = placed[i];
		if (!first) continue;
		for (let j = i + 1; j < placed.length; j++) {
			const second = placed[j];
			if (!second) continue;
			ratingRight +=
				pairRating(first, second, j - i) + pairRating(second, first, i - j);
		}
	}

	candidate.body.flip = true;
	for (let i = 0; i < placed.length; i++) {
		const first = placed[i];
		if (!first) continue;
		for (let j = i + 1; j < placed.length; j++) {
			const second = placed[j];
			if (!second) continue;
			ratingLeft +=
				pairRating(first, second, j - i) + pairRating(second, first, i - j);
		}
	}

	placed.splice(index, 1);
	if (ratingRight < ratingLeft) return { rating: ratingRight, flip: false };
	if (ratingRight > ratingLeft) return { rating: ratingLeft, flip: true };
	return { rating: ratingRight, flip: candidate.avatar.lastDir };
}

function addTalkTos(
	records: PanelBodyRecord[],
	avatars: readonly Avatar[],
): void {
	const initialCount = records.length;
	for (let i = 0; i < initialCount; i++) {
		const source = records[i];
		if (!source) continue;
		for (const avatarID of source.avatar.talkTo) {
			if (records.length >= 5) return;
			if (records.some((record) => record.body.avatarID === avatarID)) continue;
			const avatar = avatars.find(
				(candidate) => candidate.avatarID === avatarID,
			);
			if (!avatar) continue;
			records.push({
				avatar,
				body: avatar.getBodyFromEmotion(0, 0),
				priority: BR_GOODIDEA,
			});
		}
	}
}

export function orderAvatars(
	records: readonly PanelBodyRecord[],
	avatars: readonly Avatar[],
): PanelBodyRecord[] {
	const candidates = [...records];
	if (candidates.length < 5) addTalkTos(candidates, avatars);
	const placed: PanelBodyRecord[] = [];
	for (const candidate of candidates) {
		let bestRating = 1000;
		let bestPosition = 0;
		let bestFlip = false;
		for (let position = 0; position <= placed.length; position++) {
			const result = placementRating(placed, candidate, position);
			if (result.rating < bestRating) {
				bestRating = result.rating;
				bestPosition = position;
				bestFlip = result.flip;
			}
		}
		candidate.body.flip = bestFlip;
		placed.splice(bestPosition, 0, candidate);
	}
	return placed;
}

export function updateAvatarHysteresis(placed: readonly PlacedAvatar[]): void {
	for (let i = 0; i < placed.length; i++) {
		const entry = placed[i];
		if (!entry) continue;
		entry.avatar.lastDir = entry.body.flip;
		if (i > 0) entry.avatar.lastRight = placed[i - 1]?.body.avatarID ?? 0;
		if (i < placed.length - 1)
			entry.avatar.lastLeft = placed[i + 1]?.body.avatarID ?? 0;
	}
}

export const BF_NOZOOM = 1;

export const SM_SAY = 1;
export const SM_WHISPER = 2;
export const SM_THINK = 3;
export const SM_SHOUT = 4;
export const SM_ACTION = 5;

export interface PanelBalloon {
	text: string;
	mode: number;
	speaker: AvatarBody;
	runtime?: CloneableBalloonRuntime;
}

export interface CloneableBalloonRuntime {
	clone(): CloneableBalloonRuntime;
}

export interface UnitPanel {
	seed: number;
	hasBorder: boolean;
	backdropMode: number;
	bodies: AvatarBody[];
	balloons: PanelBalloon[];
}

export interface PanelDecision {
	cloned: boolean;
	speaker: number;
	words: string;
}

export interface BalloonLayoutResult {
	fits: boolean;
	leftover?: string;
}

export interface PanelPageHooks {
	layoutBalloons(panel: UnitPanel, rand: MsvcRand): BalloonLayoutResult;
	makeBalloon?(text: string, mode: number, speaker: AvatarBody): PanelBalloon;
	onDecision?(decision: PanelDecision): void;
	onRetry?(): void;
	onCommit?(panel: UnitPanel): void;
}

export interface PanelPageOptions {
	registry: AvatarRegistry;
	rand: MsvcRand;
	unitWidth: number;
	unitHeight: number;
	panelsAtStart?: number;
	hooks: PanelPageHooks;
}

export function cloneUnitPanel(panel: UnitPanel): UnitPanel {
	const bodies = panel.bodies.map(cloneBody);
	// the CPanel copy ctor (panel.cpp:492) copies seed/border/bodies/balloons but not m_backDrop
	return {
		seed: panel.seed,
		hasBorder: panel.hasBorder,
		backdropMode: 0,
		bodies,
		balloons: panel.balloons.map((balloon) => {
			const bodyIndex = panel.bodies.indexOf(balloon.speaker);
			const speaker = bodies[bodyIndex];
			if (!speaker)
				throw new Error("panel balloon has no matching speaker body");
			return {
				...balloon,
				speaker,
				runtime: balloon.runtime?.clone(),
			};
		}),
	};
}

function fetchSpeaker(panel: UnitPanel, avatar: Avatar): AvatarBody {
	const existing = panel.bodies.find(
		(body) => body.avatarID === avatar.avatarID,
	);
	if (existing) return existing;
	if (!avatar.body) throw new Error(`avatar ${avatar.avatarID} has no body`);
	const body = cloneBody(avatar.body);
	avatar.recordBody(body);
	panel.bodies.push(body);
	return body;
}

function replaceBody(panel: UnitPanel, avatar: Avatar): boolean {
	const index = panel.bodies.findIndex(
		(body) => body.avatarID === avatar.avatarID,
	);
	if (index < 0) return false;
	if (!avatar.body) throw new Error(`avatar ${avatar.avatarID} has no body`);
	const oldBody = panel.bodies[index];
	const newBody = cloneBody(avatar.body);
	newBody.requested = true;
	panel.bodies[index] = newBody;
	avatar.recordBody(newBody);
	for (const balloon of panel.balloons) {
		if (balloon.speaker === oldBody) balloon.speaker = newBody;
	}
	return true;
}

export class PanelPage {
	readonly registry: AvatarRegistry;
	readonly rand: MsvcRand;
	readonly unitWidth: number;
	readonly unitHeight: number;
	readonly hooks: PanelPageHooks;
	readonly panels: (UnitPanel | null)[];
	newPanel = true;

	constructor(options: PanelPageOptions) {
		this.registry = options.registry;
		this.rand = options.rand;
		this.unitWidth = options.unitWidth;
		this.unitHeight = options.unitHeight;
		this.hooks = options.hooks;
		this.panels = Array.from(
			{ length: options.panelsAtStart ?? 1 },
			() => null,
		);
	}

	startNewPanel(): void {
		this.newPanel = true;
	}

	private createPanel(): UnitPanel {
		return {
			seed: this.rand.rand(),
			hasBorder: true,
			backdropMode: 0,
			bodies: [],
			balloons: [],
		};
	}

	private addSemantics(panel: UnitPanel, words: string): void {
		if (checkWord(words, "Ohio")) {
			// semantic.cpp:22 draws randfloat and sets BF_NOZOOM; both backdrop branches are dead (r < 0.0)
			this.rand.randfloat();
			panel.backdropMode = BF_NOZOOM;
		}
	}

	private layoutAvatars(panel: UnitPanel, establishing: boolean): void {
		const speakerIDs = new Set(
			panel.balloons.map((balloon) => balloon.speaker.avatarID),
		);
		const filtered = filterSpeakerBodies(
			panel.bodies,
			this.registry.avatars,
			speakerIDs,
		);
		const placed = orderAvatars(filtered, this.registry.avatars);
		panel.bodies = placed.map((entry) => entry.body);
		layoutAvatarGeometry(placed, {
			unitWidth: this.unitWidth,
			unitHeight: this.unitHeight,
			establishing,
		});
		updateAvatarHysteresis(placed);
	}

	addLine(speakerID: number, words: string, mode: number): void {
		if (mode === SM_ACTION) this.startNewPanel();
		if (words === "<Brk>") {
			this.startNewPanel();
			return;
		}
		if (words === "<Chr>")
			throw new Error("reaction panels are not part of the trace port yet");

		const avatar = this.registry.get(speakerID);
		if (!avatar) throw new Error(`missing avatar ${speakerID}`);
		const oldPanel = this.panels.at(-1) ?? null;
		const replaceLast = !(
			this.newPanel ||
			(oldPanel?.balloons.length ?? 0) >= 5 ||
			this.panels.length < 2 ||
			oldPanel?.bodies.some((body) => body.avatarID === speakerID)
		);
		const panel =
			replaceLast && oldPanel ? cloneUnitPanel(oldPanel) : this.createPanel();
		if (!replaceLast) this.newPanel = false;
		const establishing =
			this.panels.length <= 1 || (replaceLast && this.panels.length <= 2);

		this.hooks.onDecision?.({ cloned: replaceLast, speaker: speakerID, words });
		this.addSemantics(panel, words);
		const speaker = fetchSpeaker(panel, avatar);
		const balloon = this.hooks.makeBalloon?.(words, mode, speaker) ?? {
			text: words,
			mode,
			speaker,
		};
		panel.balloons.push(balloon);
		replaceBody(panel, avatar);
		this.layoutAvatars(panel, establishing);
		const result = this.hooks.layoutBalloons(panel, this.rand);
		if (!result.fits) {
			this.hooks.onRetry?.();
			this.startNewPanel();
			this.addLine(speakerID, words, mode);
			return;
		}

		if (replaceLast) this.panels.pop();
		this.panels.push(panel);
		this.hooks.onCommit?.(panel);
		avatar.reset();
		if (result.leftover) this.addLine(speakerID, result.leftover, mode);
	}
}

export interface AvatarLayoutOptions {
	unitWidth: number;
	unitHeight: number;
	establishing: boolean;
	zoomIn?: boolean;
}

export interface AvatarLayoutResult {
	zoomFactor: number;
	bodyWidth: number;
	margin: number;
}

export function bodyFromPoseIDs(
	data: AvatarData,
	facePoseID: number,
	torsoPoseID: number,
): AvatarBody {
	const common = {
		avatarID: data.avatarID,
		flip: false,
		requested: true,
		arrowX: 0,
		bbox: { left: -1, bottom: 0, right: -1, top: 0 },
	};
	if (data.type === "simple") {
		const bodyIndex = data.bodies.findIndex((rec) => rec.poseID === facePoseID);
		return {
			...common,
			kind: "simple",
			bodyIndex,
		};
	}
	const faceIndex = data.faces.findIndex((rec) => rec.poseID === facePoseID);
	const torsoIndex = data.torsos.findIndex((rec) => rec.poseID === torsoPoseID);
	return {
		...common,
		kind: "complex",
		faceIndex,
		torsoIndex,
	};
}

export function layoutAvatarGeometry(
	placed: readonly PlacedAvatar[],
	options: AvatarLayoutOptions,
): AvatarLayoutResult {
	const { unitWidth, unitHeight, establishing } = options;
	const zoomIn = options.zoomIn ?? true;
	const maxBodyHeight = Math.trunc(unitHeight / 1.9);
	const widths: number[] = [];
	const heights: number[] = [];
	const normHeights: number[] = [];
	const headHeights: number[] = [];
	const tops: number[] = [];
	const arrowFractions: number[] = [];
	let maxNorm = 0;

	for (let i = 0; i < placed.length; i++) {
		const entry = placed[i];
		if (!entry) continue;
		const dims = entry.avatar.getDimInfo(entry.body);
		widths[i] = dims.xdim;
		heights[i] = dims.ydim;
		normHeights[i] = dims.normHeight;
		headHeights[i] = dims.headHeight;
		arrowFractions[i] = dims.faceX / dims.xdim;
		maxNorm = Math.max(maxNorm, dims.normHeight);
	}

	let bodyWidth = 0;
	for (let i = 0; i < placed.length; i++) {
		const height = heights[i] ?? 0;
		const width = widths[i] ?? 0;
		const newHeight = round(
			maxBodyHeight * Math.fround((normHeights[i] ?? 0) / maxNorm),
		);
		const scaleRatio = Math.fround(newHeight / height);
		heights[i] = newHeight;
		widths[i] = round(Math.fround(scaleRatio * width));
		tops[i] = -unitHeight + newHeight;
		headHeights[i] = round(Math.fround(scaleRatio * (headHeights[i] ?? 0)));
		bodyWidth += widths[i] ?? 0;
	}

	let zoomFactor = 1.0;
	const sumWidth = bodyWidth;
	if (sumWidth > unitWidth) {
		const reduction = Math.fround(unitWidth / sumWidth);
		bodyWidth = 0;
		for (let i = 0; i < placed.length; i++) {
			heights[i] = round(Math.fround((heights[i] ?? 0) * reduction));
			widths[i] = round(Math.fround((widths[i] ?? 0) * reduction));
			tops[i] = -unitHeight + (heights[i] ?? 0);
			bodyWidth += widths[i] ?? 0;
		}
	} else if (zoomIn && !establishing) {
		zoomFactor = unitWidth / sumWidth;
		let maxHeadHeight = 0;
		for (const height of headHeights)
			maxHeadHeight = Math.max(maxHeadHeight, height);
		const headFactor = maxBodyHeight / (maxHeadHeight * 1.2);
		zoomFactor = Math.min(zoomFactor, headFactor);
		if (zoomFactor < 1.1) zoomFactor = 1.0;
		bodyWidth = 0;
		for (let i = 0; i < placed.length; i++) {
			heights[i] = round((heights[i] ?? 0) * zoomFactor);
			widths[i] = round((widths[i] ?? 0) * zoomFactor);
			bodyWidth += widths[i] ?? 0;
		}
	}

	const margin = Math.trunc((unitWidth - bodyWidth) / (placed.length + 1));
	let xOffset = margin;
	for (let i = 0; i < placed.length; i++) {
		const entry = placed[i];
		if (!entry) continue;
		const width = widths[i] ?? 0;
		const height = heights[i] ?? 0;
		const top = tops[i] ?? 0;
		entry.body.bbox = {
			left: xOffset,
			bottom: top - height,
			right: xOffset + width,
			top,
		};
		entry.body.arrowX =
			entry.body.bbox.left +
			round(
				(arrowFractions[i] ?? 0) *
					(entry.body.bbox.right - entry.body.bbox.left),
			);
		xOffset += width + margin;
	}

	return { zoomFactor, bodyWidth, margin };
}

export function clonePlacedAvatars(
	placed: readonly PlacedAvatar[],
): PlacedAvatar[] {
	return placed.map((entry) => ({
		avatar: entry.avatar,
		body: cloneBody(entry.body),
	}));
}
