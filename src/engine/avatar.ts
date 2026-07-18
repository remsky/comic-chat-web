// Port of avatar.cpp's body selection, neutral rotation, state, and dimension model.

import { type Rect, toShort } from "./bbox.js";
import type { EmotionOpt, EmotionOpts } from "./emotion.js";
import { PI, subtractAngles } from "./vector2d.js";

export const BC_BODYDOUBLE = 1;
export const BC_BODYSINGLE = 2;

export const AF_UNFROZEN = 1;
export const AF_TEMPFROZEN = 2;
export const AF_FROZEN = 3;

export interface PoseData {
	poseID: number;
	localPoseID: number;
	width: number;
	height: number;
	sprite?: {
		atlasUrl: string;
		x: number;
		y: number;
	};
}

export interface FaceData {
	poseID: number;
	emotion: number;
	intensity: number;
	xCX: number;
	yCX: number;
	deltaXCX: number;
	deltaYCX: number;
	faceX: number;
	faceY: number;
}

export interface TorsoData {
	poseID: number;
	emotion: number;
	intensity: number;
	xCX: number;
	yCX: number;
}

export interface SimpleBodyData {
	poseID: number;
	emotion: number;
	intensity: number;
	faceX: number;
	faceY: number;
}

export interface AvatarData {
	avatarID: number;
	name: string;
	type: "simple" | "complex";
	iconPoseID: number;
	flags?: number;
	poses: PoseData[];
	faces: FaceData[];
	torsos: TorsoData[];
	bodies: SimpleBodyData[];
}

interface BodyCommon {
	avatarID: number;
	flip: boolean;
	requested: boolean;
	arrowX: number;
	bbox: Rect;
}

export interface ComplexBody extends BodyCommon {
	kind: "complex";
	faceIndex: number;
	torsoIndex: number;
}

export interface SimpleBody extends BodyCommon {
	kind: "simple";
	bodyIndex: number;
}

export type AvatarBody = ComplexBody | SimpleBody;

export interface BodyIndices {
	faceIndex: number;
	torsoIndex: number;
	requested: number;
}

export interface BodyDimInfo {
	xdim: number;
	ydim: number;
	normHeight: number;
	headHeight: number;
	faceX: number;
}

function bodyCommon(avatarID: number): BodyCommon {
	return {
		avatarID,
		flip: false,
		requested: true,
		arrowX: 0,
		bbox: { left: -1, bottom: 0, right: -1, top: 0 },
	};
}

function complexBody(
	avatarID: number,
	faceIndex = -1,
	torsoIndex = -1,
): ComplexBody {
	return {
		...bodyCommon(avatarID),
		kind: "complex",
		faceIndex,
		torsoIndex,
	};
}

function simpleBody(avatarID: number, bodyIndex = -1): SimpleBody {
	return { ...bodyCommon(avatarID), kind: "simple", bodyIndex };
}

export function cloneBody(body: AvatarBody): AvatarBody {
	return {
		...body,
		bbox: { ...body.bbox },
	};
}

export function bodiesAreSame(
	a: AvatarBody | null,
	b: AvatarBody | null,
): boolean {
	if (!a || !b || a.kind !== b.kind) return false;
	if (a.kind === "complex" && b.kind === "complex") {
		return a.faceIndex === b.faceIndex && a.torsoIndex === b.torsoIndex;
	}
	return (
		a.kind === "simple" && b.kind === "simple" && a.bodyIndex === b.bodyIndex
	);
}

function highestPriorityIndex(opts: readonly EmotionOpt[]): number {
	let bestIndex = -1;
	let minPriority = 0;
	for (let i = 0; i < opts.length; i++) {
		const priority = opts[i]?.priority ?? 0;
		if (priority > minPriority) {
			bestIndex = i;
			minPriority = priority;
		}
	}
	return bestIndex;
}

export abstract class Avatar {
	readonly data: AvatarData;
	body: AvatarBody | null = null;
	freeze = AF_UNFROZEN;
	lastDir = false;
	lastLeft = 0;
	lastRight = 0;
	nSends = 0;
	talkTo: number[] = [];

	protected constructor(data: AvatarData) {
		this.data = data;
	}

	get avatarID(): number {
		return this.data.avatarID;
	}

	abstract getBodyFromOptions(opts: EmotionOpts | EmotionOpt[]): AvatarBody;
	abstract getBodyFromEmotion(emotion: number, intensity: number): AvatarBody;
	abstract setNeutral(): void;
	abstract recordBody(body: AvatarBody): void;
	abstract getIndices(): BodyIndices;
	abstract getDimInfo(body: AvatarBody): BodyDimInfo;

	updateBody(newBody: AvatarBody): void {
		if (!bodiesAreSame(newBody, this.body)) this.body = newBody;
	}

	reset(): void {
		if (this.freeze === AF_TEMPFROZEN) this.freeze = AF_UNFROZEN;
		if (this.freeze === AF_UNFROZEN) this.setNeutral();
	}

	protected optsArray(opts: EmotionOpts | EmotionOpt[]): EmotionOpt[] {
		return Array.isArray(opts) ? opts : opts.opts;
	}

	protected pose(poseID: number): PoseData | undefined {
		return this.data.poses.find((pose) => pose.poseID === poseID);
	}
}

export class ComplexAvatar extends Avatar {
	lastFace = -1;
	lastTorso = -1;

	constructor(data: AvatarData) {
		super(data);
		this.setNeutral();
	}

	private headAndBodyFromEmotion(
		emotion: number,
		intensity: number,
	): {
		faceIndex: number;
		torsoIndex: number;
	} {
		let faceIndex = -1;
		let torsoIndex = -1;
		if (emotion <= 2 * PI) {
			let nearestAngle = 3 * PI;
			let intensityOfNearest = 2.0;
			for (let i = 0; i < this.data.faces.length; i++) {
				const face = this.data.faces[i];
				if (!face) continue;
				const thisAngle = Math.abs(subtractAngles(face.emotion, emotion));
				if (thisAngle <= nearestAngle) {
					const delta = Math.abs(intensity - face.intensity);
					if (thisAngle === nearestAngle && delta >= intensityOfNearest)
						continue;
					nearestAngle = thisAngle;
					intensityOfNearest = delta;
					faceIndex = i;
				}
			}
		} else {
			for (let i = 0; i < this.data.torsos.length; i++) {
				if (this.data.torsos[i]?.emotion === emotion) {
					torsoIndex = i;
					break;
				}
			}
		}
		return { faceIndex, torsoIndex };
	}

	private setFaceNeutral(body: ComplexBody): void {
		let index = this.lastFace;
		for (let i = 0; i < this.data.faces.length; i++) {
			index = (index + 1) % this.data.faces.length;
			const face = this.data.faces[index];
			if (face?.emotion === 0 && face.intensity === 0) {
				body.faceIndex = index;
				return;
			}
		}
		body.faceIndex = 0;
	}

	private setTorsoNeutral(body: ComplexBody): void {
		let index = this.lastTorso;
		for (let i = 0; i < this.data.torsos.length; i++) {
			index = (index + 1) % this.data.torsos.length;
			const torso = this.data.torsos[index];
			if (torso?.emotion === 0 && torso.intensity === 0) {
				body.torsoIndex = index;
				return;
			}
		}
		body.torsoIndex = 0;
	}

	getBodyFromEmotion(emotion: number, intensity: number): ComplexBody {
		const body = complexBody(this.avatarID);
		let nearestAngle = 3 * PI;
		let intensityOfNearest = 2.0;
		let nearestIndex = 0;
		for (let i = 0; i < this.data.faces.length; i++) {
			const face = this.data.faces[i];
			if (!face) continue;
			const thisAngle = Math.abs(subtractAngles(face.emotion, emotion));
			if (thisAngle <= nearestAngle) {
				const delta = Math.abs(intensity - face.intensity);
				if (thisAngle === nearestAngle && delta >= intensityOfNearest) continue;
				nearestAngle = thisAngle;
				intensityOfNearest = delta;
				nearestIndex = i;
			}
		}
		body.faceIndex = nearestIndex;

		intensityOfNearest = 2.0;
		for (let i = 0; i < this.data.torsos.length; i++) {
			const index = (this.lastTorso + 1 + i) % this.data.torsos.length;
			const torso = this.data.torsos[index];
			if (!torso || torso.emotion > 7) continue;
			const thisAngle = Math.abs(subtractAngles(torso.emotion, emotion));
			if (thisAngle < PI / 8 || torso.emotion === 0) {
				const delta = Math.abs(intensity - torso.intensity);
				if (delta < intensityOfNearest) {
					intensityOfNearest = delta;
					nearestIndex = index;
				}
			}
		}
		body.torsoIndex = nearestIndex;
		return body;
	}

	getBodyFromOptions(opts: EmotionOpts | EmotionOpt[]): ComplexBody {
		const entries = this.optsArray(opts);
		const body = complexBody(this.avatarID);
		let foundFace = false;
		let foundTorso = false;
		while (true) {
			const bestIndex = highestPriorityIndex(entries);
			if (bestIndex < 0) break;
			const entry = entries[bestIndex];
			if (!entry) break;
			const found = this.headAndBodyFromEmotion(entry.emotion, entry.intensity);
			entry.priority = 0;
			if (found.faceIndex >= 0 && !foundFace) {
				body.faceIndex = found.faceIndex;
				foundFace = true;
			}
			if (found.torsoIndex >= 0 && !foundTorso) {
				body.torsoIndex = found.torsoIndex;
				foundTorso = true;
			}
			if (foundFace && foundTorso) break;
		}
		if (!foundFace) this.setFaceNeutral(body);
		if (!foundTorso) this.setTorsoNeutral(body);
		return body;
	}

	setNeutral(): void {
		const body = complexBody(this.avatarID);
		this.setTorsoNeutral(body);
		this.setFaceNeutral(body);
		body.requested = false;
		this.updateBody(body);
	}

	recordBody(body: AvatarBody): void {
		if (body.kind !== "complex") return;
		this.lastFace = body.faceIndex;
		this.lastTorso = body.torsoIndex;
	}

	getIndices(): BodyIndices {
		if (this.body?.kind !== "complex") {
			return { faceIndex: 0, torsoIndex: 0, requested: 0 };
		}
		return {
			faceIndex: this.body.faceIndex,
			torsoIndex: this.body.torsoIndex,
			requested: this.freeze === AF_UNFROZEN ? 0 : 1,
		};
	}

	getDimInfo(body: AvatarBody): BodyDimInfo {
		if (body.kind !== "complex") {
			return {
				xdim: 100,
				ydim: 100,
				normHeight: 100,
				headHeight: 50,
				faceX: 50,
			};
		}
		const face = this.data.faces[body.faceIndex];
		const torso = this.data.torsos[body.torsoIndex];
		const headPose = face ? this.pose(face.poseID) : undefined;
		const torsoPose = torso ? this.pose(torso.poseID) : undefined;
		const headWidth = headPose?.width ?? 50;
		const headHeightPx = headPose?.height ?? 50;
		const torsoWidth = torsoPose?.width ?? 50;
		const torsoHeight = torsoPose?.height ?? 50;
		const xOffset =
			(torso?.xCX ?? 0) + (face?.deltaXCX ?? 0) - (face?.xCX ?? 0);
		const yOffset =
			(torso?.yCX ?? 0) + (face?.deltaYCX ?? 0) - (face?.yCX ?? 0);
		const bitLeft = Math.min(0, xOffset);
		const bitRight = Math.max(torsoWidth, xOffset + headWidth);
		const bitTop = Math.min(0, yOffset);
		let headHeight = yOffset + headHeightPx;
		const bitBottom = Math.max(torsoHeight, headHeight);
		const xdim = toShort(bitRight - bitLeft);
		const ydim = toShort(bitBottom - bitTop);
		headHeight = toShort(headHeight - toShort(bitTop));
		let faceX = toShort((face?.faceX ?? 0) + xOffset - bitLeft);
		if (body.flip) faceX = xdim - faceX;
		return { xdim, ydim, normHeight: 100, headHeight, faceX };
	}
}

export class SimpleAvatar extends Avatar {
	lastBody = -1;

	constructor(data: AvatarData) {
		super(data);
		this.setNeutral();
	}

	private bodyIndexFromEmotion(emotion: number, intensity: number): number {
		let nearestAngle = 3 * PI;
		let intensityOfNearest = 2.0;
		let bodyIndex = -1;
		if (emotion <= 2 * PI) {
			for (let i = 0; i < this.data.bodies.length; i++) {
				const rec = this.data.bodies[i];
				if (!rec) continue;
				const thisAngle = Math.abs(subtractAngles(rec.emotion, emotion));
				if (thisAngle <= nearestAngle) {
					const delta = Math.abs(intensity - rec.intensity);
					if (thisAngle === nearestAngle && delta >= intensityOfNearest)
						continue;
					nearestAngle = thisAngle;
					intensityOfNearest = delta;
					bodyIndex = i;
				}
			}
		} else {
			bodyIndex = this.data.bodies.findIndex((rec) => rec.emotion === emotion);
		}
		return bodyIndex;
	}

	private setBodyNeutral(body: SimpleBody): void {
		let index = this.lastBody;
		for (let i = 0; i < this.data.bodies.length; i++) {
			index = (index + 1) % this.data.bodies.length;
			const rec = this.data.bodies[index];
			if (rec?.emotion === 0 && rec.intensity === 0) {
				body.bodyIndex = index;
				return;
			}
		}
		body.bodyIndex = 0;
	}

	getBodyFromEmotion(emotion: number, intensity: number): SimpleBody {
		const body = simpleBody(this.avatarID);
		let intensityOfNearest = 2.0;
		let nearestIndex = -1;
		for (let i = 0; i < this.data.bodies.length; i++) {
			const index = (this.lastBody + 1 + i) % this.data.bodies.length;
			const rec = this.data.bodies[index];
			if (!rec || rec.emotion > 7) continue;
			const thisAngle = Math.abs(subtractAngles(rec.emotion, emotion));
			const isFirstNeutral =
				rec.emotion === 0 && rec.intensity === 0 && nearestIndex === -1;
			if (thisAngle < PI / 8 || isFirstNeutral) {
				const delta =
					isFirstNeutral && intensity > 0
						? 1.5
						: Math.abs(intensity - rec.intensity);
				if (delta < intensityOfNearest) {
					intensityOfNearest = delta;
					nearestIndex = index;
				}
			}
		}
		body.bodyIndex = nearestIndex;
		return body;
	}

	getBodyFromOptions(opts: EmotionOpts | EmotionOpt[]): SimpleBody {
		const entries = this.optsArray(opts);
		const body = simpleBody(this.avatarID);
		while (true) {
			const bestIndex = highestPriorityIndex(entries);
			if (bestIndex < 0) break;
			const entry = entries[bestIndex];
			if (!entry) break;
			const bodyIndex = this.bodyIndexFromEmotion(
				entry.emotion,
				entry.intensity,
			);
			entry.priority = 0;
			if (bodyIndex >= 0) {
				body.bodyIndex = bodyIndex;
				return body;
			}
		}
		this.setBodyNeutral(body);
		return body;
	}

	setNeutral(): void {
		const body = this.getBodyFromEmotion(0, 0);
		body.requested = false;
		this.updateBody(body);
	}

	recordBody(body: AvatarBody): void {
		if (body.kind === "simple") this.lastBody = body.bodyIndex;
	}

	getIndices(): BodyIndices {
		if (this.body?.kind !== "simple") {
			return { faceIndex: 0, torsoIndex: 0, requested: 0 };
		}
		return {
			faceIndex: 0,
			torsoIndex: this.body.bodyIndex,
			requested: this.freeze === AF_UNFROZEN ? 0 : 1,
		};
	}

	getDimInfo(body: AvatarBody): BodyDimInfo {
		if (body.kind !== "simple") {
			return {
				xdim: 100,
				ydim: 100,
				normHeight: 100,
				headHeight: 50,
				faceX: 50,
			};
		}
		const rec = this.data.bodies[body.bodyIndex];
		const pose = rec ? this.pose(rec.poseID) : undefined;
		const xdim = toShort(pose?.width ?? 100);
		const ydim = toShort(pose?.height ?? 100);
		let faceX = rec?.faceX ?? 0;
		if (body.flip) faceX = xdim - faceX;
		return {
			xdim,
			ydim,
			normHeight: 100,
			headHeight: Math.trunc(ydim / 2),
			faceX,
		};
	}
}

export function createAvatar(data: AvatarData): Avatar {
	return data.type === "complex"
		? new ComplexAvatar(data)
		: new SimpleAvatar(data);
}

export class AvatarRegistry {
	readonly avatars: Avatar[];

	constructor(data: readonly AvatarData[]) {
		this.avatars = data.map(createAvatar);
	}

	get(avatarID: number): Avatar | undefined {
		return this.avatars.find((avatar) => avatar.avatarID === avatarID);
	}
}
