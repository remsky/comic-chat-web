import type { Avatar, AvatarBody, PoseData } from "../engine/avatar.js";
import {
	type Arc,
	boxBalloonTraj,
	normalBalloonTraj,
} from "../engine/balloonTail.js";
import type { PanelBalloon, UnitPanel } from "../engine/panel.js";
import { SM_THINK, SM_WHISPER } from "../engine/panel.js";
import { BalloonRuntime } from "../engine/panelBalloon.js";
import { BetaSpline } from "../engine/spline.js";
import {
	angleBetweenVecs,
	angleToVector,
	dpointNorm,
	dpointScalmult,
	dpointToPoint,
	PI,
	pointAdd,
	pointMagn,
	pointScalmult,
	pointSub,
	pointToDpoint,
	round,
	vectorToAngle,
} from "../engine/vector2d.js";
import type { AvatarAtlasCache } from "./avatarAssets.js";
import { BALLOON_FONT_SIZE, gdiCellFont } from "./canvasText.js";

const TORSOFIRST = 4;

export interface SpriteLayer {
	pose: PoseData;
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function poseByID(avatar: Avatar, poseID: number): PoseData {
	const pose = avatar.data.poses.find(
		(candidate) => candidate.poseID === poseID,
	);
	if (!pose) throw new Error(`avatar ${avatar.avatarID} has no pose ${poseID}`);
	return pose;
}

function flipLayer(
	layer: SpriteLayer,
	fullLeft: number,
	fullRight: number,
): void {
	const width = layer.right - layer.left;
	layer.left = fullRight - (layer.left - fullLeft);
	layer.right = layer.left - width;
}

export function bodySpriteLayers(
	avatar: Avatar,
	body: AvatarBody,
): SpriteLayer[] {
	const client = body.bbox;
	const clientWidth = client.right - client.left;
	const clientHeight = client.top - client.bottom;
	if (body.kind === "simple") {
		const bodyRec = avatar.data.bodies[body.bodyIndex];
		if (!bodyRec)
			throw new Error(
				`avatar ${avatar.avatarID} has no body ${body.bodyIndex}`,
			);
		const pose = poseByID(avatar, bodyRec.poseID);
		const widthScale = clientWidth / pose.width;
		const heightScale = clientHeight / pose.height;
		let fullWidth: number;
		let fullHeight: number;
		if (widthScale <= heightScale) {
			fullWidth = clientWidth;
			fullHeight = Math.trunc(widthScale * pose.height);
		} else {
			fullHeight = clientHeight;
			fullWidth = Math.trunc(heightScale * pose.width);
		}
		const layer: SpriteLayer = {
			pose,
			left: client.left + Math.trunc((clientWidth - fullWidth) / 2),
			right: 0,
			// bodycam.cpp:594 adds the slack to top even in y-up space, floating the body above its bbox
			top: client.top + (clientHeight - fullHeight),
			bottom: 0,
		};
		layer.right = layer.left + fullWidth;
		layer.bottom = layer.top - fullHeight;
		if (body.flip) {
			const oldLeft = layer.left;
			layer.left = layer.right;
			layer.right = oldLeft;
		}
		return [layer];
	}

	const face = avatar.data.faces[body.faceIndex];
	const torso = avatar.data.torsos[body.torsoIndex];
	if (!face || !torso)
		throw new Error(`avatar ${avatar.avatarID} has incomplete body records`);
	const headPose = poseByID(avatar, face.poseID);
	const torsoPose = poseByID(avatar, torso.poseID);
	const xOffset = torso.xCX + face.deltaXCX - face.xCX;
	const yOffset = torso.yCX + face.deltaYCX - face.yCX;
	const bitLeft = Math.min(0, xOffset);
	const bitRight = Math.max(torsoPose.width, xOffset + headPose.width);
	const bitTop = Math.min(0, yOffset);
	const bitBottom = Math.max(torsoPose.height, yOffset + headPose.height);
	const bitWidth = bitRight - bitLeft;
	const bitHeight = bitBottom - bitTop;
	const scale = Math.min(clientWidth / bitWidth, clientHeight / bitHeight);
	const fullHeight = round(scale * bitHeight);
	const fullWidth = round(scale * bitWidth);
	const fullLeft = client.left + Math.trunc((clientWidth - fullWidth) / 2);
	// bodycam.cpp:559 "centered on bottom" adds the slack upward in y-up space
	const fullTop = client.top + (clientHeight - fullHeight);
	const fullRight = fullLeft + fullWidth;
	const head: SpriteLayer = {
		pose: headPose,
		left: round((xOffset - bitLeft) * scale) + fullLeft,
		right: 0,
		top: round((yOffset - bitTop) * scale) + fullTop,
		bottom: 0,
	};
	head.right = head.left + round(headPose.width * scale) + 1;
	head.bottom = head.top - (round(headPose.height * scale) + 1);
	const torsoLayer: SpriteLayer = {
		pose: torsoPose,
		left: round(-bitLeft * scale) + fullLeft,
		right: 0,
		top: fullTop - round(-bitTop * scale),
		bottom: 0,
	};
	torsoLayer.right = torsoLayer.left + round(torsoPose.width * scale) + 1;
	torsoLayer.bottom = torsoLayer.top - (round(torsoPose.height * scale) + 1);
	if (body.flip) {
		flipLayer(head, fullLeft, fullRight);
		flipLayer(torsoLayer, fullLeft, fullRight);
	}
	return avatar.data.flags && avatar.data.flags & TORSOFIRST
		? [torsoLayer, head]
		: [head, torsoLayer];
}

function addArc(
	context: CanvasRenderingContext2D,
	arc: Arc,
	ox: number,
	oy: number,
): void {
	if (arc.altitude < 1 && arc.altitude > -1) {
		context.lineTo(arc.hi.x + ox, -(arc.hi.y + oy));
		return;
	}
	const mid = pointScalmult(0.5, pointAdd(arc.lo, arc.hi));
	const endToMid = pointSub(mid, arc.hi);
	const endToMidDist = pointMagn(endToMid);
	const radius =
		(endToMidDist * endToMidDist + arc.altitude * arc.altitude) /
		(2 * arc.altitude);
	const midToCenterDist = radius - arc.altitude;
	const perpendicular = { x: endToMid.y, y: -endToMid.x };
	const perpendicularMagnitude = pointMagn(perpendicular);
	const midToCenter = pointScalmult(
		midToCenterDist / perpendicularMagnitude,
		perpendicular,
	);
	const center = pointAdd(pointAdd(arc.hi, endToMid), midToCenter);
	let a = pointToDpoint(pointSub(arc.lo, center));
	const finalC = pointToDpoint(pointSub(arc.hi, center));
	const scanRadius = Math.hypot(a.x, a.y);
	let trueAngle = angleBetweenVecs(finalC, a);
	const ccw = arc.altitude > 0;
	if (ccw) trueAngle = -trueAngle;
	if (trueAngle <= 0) trueAngle += 2 * PI;
	let nextEnd = vectorToAngle(a);
	const direction = ccw ? 1 : -1;
	while (true) {
		const finalSegment = trueAngle <= PI / 2;
		const step = finalSegment ? trueAngle : PI / 2;
		let c = finalC;
		if (!finalSegment) {
			nextEnd += direction * (PI / 2);
			const vector = angleToVector(nextEnd);
			c = { x: vector.x * scanRadius, y: vector.y * scanRadius };
		}
		const s = Math.cos(step / 2);
		const tau = (4 * s) / (3 * (s + 1));
		const divisor = (a.x * c.y - a.y * c.x) / (scanRadius * scanRadius);
		const b = { x: (c.y - a.y) / divisor, y: (a.x - c.x) / divisor };
		const p1 = {
			x: round((1 - tau) * a.x + tau * b.x) + center.x,
			y: round((1 - tau) * a.y + tau * b.y) + center.y,
		};
		const p2 = {
			x: round((1 - tau) * c.x + tau * b.x) + center.x,
			y: round((1 - tau) * c.y + tau * b.y) + center.y,
		};
		const p3 = pointAdd(dpointToPoint(c), center);
		context.bezierCurveTo(
			p1.x + ox,
			-(p1.y + oy),
			p2.x + ox,
			-(p2.y + oy),
			p3.x + ox,
			-(p3.y + oy),
		);
		if (finalSegment) break;
		a = c;
		trueAngle -= PI / 2;
	}
}

function addBezierPath(
	context: CanvasRenderingContext2D,
	bezier: readonly { x: number; y: number }[],
	ox: number,
	oy: number,
): boolean {
	const first = bezier[0];
	if (!first) return false;
	context.moveTo(first.x + ox, -(first.y + oy));
	for (let i = 1; i + 2 < bezier.length; i += 3) {
		const p1 = bezier[i];
		const p2 = bezier[i + 1];
		const p3 = bezier[i + 2];
		if (!p1 || !p2 || !p3) continue;
		context.bezierCurveTo(
			p1.x + ox,
			-(p1.y + oy),
			p2.x + ox,
			-(p2.y + oy),
			p3.x + ox,
			-(p3.y + oy),
		);
	}
	return true;
}

export function drawSpriteLayer(
	context: CanvasRenderingContext2D,
	assets: AvatarAtlasCache,
	layer: SpriteLayer,
): void {
	if (!layer.pose.sprite)
		throw new Error(`pose ${layer.pose.poseID} has no sprite`);
	const image = assets.get(layer.pose);
	const x = Math.min(layer.left, layer.right);
	const y = -Math.max(layer.top, layer.bottom);
	const width = Math.abs(layer.right - layer.left);
	const height = Math.abs(layer.top - layer.bottom);
	context.save();
	if (layer.left > layer.right) {
		context.translate(2 * x + width, 0);
		context.scale(-1, 1);
	}
	context.drawImage(
		image,
		layer.pose.sprite.x,
		layer.pose.sprite.y,
		layer.pose.width,
		layer.pose.height,
		x,
		y,
		width,
		height,
	);
	context.restore();
}

export interface CanvasPanelRendererOptions {
	unitWidth: number;
	unitHeight: number;
	background?: string;
	foreground?: string;
	normalFont?: string;
	whisperFont?: string;
}

export class CanvasPanelRenderer {
	private normalFontCache?: string;
	private whisperFontCache?: string;

	constructor(
		readonly context: CanvasRenderingContext2D,
		readonly assets: AvatarAtlasCache,
		readonly avatars: readonly Avatar[],
		readonly options: CanvasPanelRendererOptions,
	) {}

	private get normalFont(): string {
		this.normalFontCache ??=
			this.options.normalFont ??
			gdiCellFont(this.context, "400", BALLOON_FONT_SIZE);
		return this.normalFontCache;
	}

	private get whisperFont(): string {
		this.whisperFontCache ??=
			this.options.whisperFont ??
			gdiCellFont(this.context, "italic 400", BALLOON_FONT_SIZE);
		return this.whisperFontCache;
	}

	private drawBody(body: AvatarBody): void {
		const avatar = this.avatars.find(
			(candidate) => candidate.avatarID === body.avatarID,
		);
		if (!avatar) throw new Error(`missing avatar ${body.avatarID}`);
		for (const layer of bodySpriteLayers(avatar, body))
			drawSpriteLayer(this.context, this.assets, layer);
	}

	private balloonPath(balloon: PanelBalloon, runtime: BalloonRuntime): void {
		if (!runtime.fInfo) return;
		const ox = runtime.bbox.left;
		const oy = runtime.bbox.top;
		this.context.beginPath();
		if (runtime.isBox) {
			const lines = boxBalloonTraj(runtime.fInfo.fbox);
			const first = lines[0]?.lo;
			if (!first) return;
			this.context.moveTo(first.x + ox, -(first.y + oy));
			for (const line of lines)
				this.context.lineTo(line.hi.x + ox, -(line.hi.y + oy));
			this.context.closePath();
			return;
		}
		if (balloon.mode === SM_THINK && runtime.spline) {
			const cloud = new BetaSpline(
				runtime.spline.cps,
				runtime.spline.cps.length,
				true,
			);
			addBezierPath(this.context, cloud.bezpts ?? [], ox, oy);
			this.context.closePath();
			return;
		}
		const cloud = runtime.cloudBBox();
		const traj = normalBalloonTraj(runtime.fInfo, runtime.style.font, {
			speakerArrowX: balloon.speaker.arrowX,
			speakerTop: balloon.speaker.bbox.top,
			balloonLeft: runtime.bbox.left,
			balloonTop: runtime.bbox.top,
			routeLeft: runtime.routeRgn.left,
			routeRight: runtime.routeRgn.right,
			cloudBottom: cloud.bottom,
		});
		const bezier = traj.spline.bezpts ?? [];
		if (!addBezierPath(this.context, bezier, ox, oy)) return;
		for (const arc of traj.arcs) addArc(this.context, arc, ox, oy);
		this.context.closePath();
	}

	private drawThinkBubbles(
		balloon: PanelBalloon,
		runtime: BalloonRuntime,
	): void {
		if (balloon.mode !== SM_THINK || !runtime.fInfo) return;
		const entry = {
			x: Math.trunc((runtime.routeRgn.left + runtime.routeRgn.right) / 2),
			y: runtime.fInfo.fbox.bottom + runtime.bbox.top,
		};
		const tail = {
			x: balloon.speaker.arrowX,
			y: balloon.speaker.bbox.top + 200,
		};
		const deltaY = entry.y - tail.y;
		if (deltaY < 0) return;
		const count = Math.trunc((deltaY + 100) / 250);
		if (count <= 0) return;
		const spacing =
			count > 1 ? Math.trunc((deltaY - 150 * count) / (count - 1)) : 0;
		const direction = dpointNorm({ x: entry.x - tail.x, y: entry.y - tail.y });
		let center = pointAdd(tail, dpointToPoint(dpointScalmult(75, direction)));
		const increment = dpointToPoint(dpointScalmult(150 + spacing, direction));
		const widthDelta =
			count > 1 ? Math.trunc((400 - 150) / (2 * (count - 1))) : 0;
		let widthAdjustment = 0;
		for (let i = 0; i < count; i++) {
			this.context.beginPath();
			this.context.ellipse(
				center.x,
				-center.y,
				75 + widthAdjustment,
				75,
				0,
				0,
				2 * Math.PI,
			);
			this.context.fill();
			this.context.stroke();
			center = pointAdd(center, increment);
			widthAdjustment += widthDelta;
		}
	}

	private drawBalloon(balloon: PanelBalloon): void {
		if (!(balloon.runtime instanceof BalloonRuntime)) return;
		const runtime = balloon.runtime;
		const fInfo = runtime.fInfo;
		if (!fInfo) return;
		this.context.save();
		this.context.fillStyle = this.options.background ?? "#fff";
		this.context.strokeStyle = this.options.foreground ?? "#000";
		this.context.lineJoin = "round";
		this.context.lineCap = "round";
		this.balloonPath(balloon, runtime);
		if (balloon.mode === SM_WHISPER) {
			this.context.lineWidth = 100;
			this.context.strokeStyle = this.options.background ?? "#fff";
			this.context.fill();
			this.context.stroke();
			this.context.strokeStyle = this.options.foreground ?? "#000";
			this.context.lineWidth = 28;
			this.context.setLineDash([100, 100]);
			this.context.stroke();
			this.context.setLineDash([]);
		} else {
			this.context.lineWidth = 28;
			this.context.fill();
			this.context.stroke();
		}
		this.drawThinkBubbles(balloon, runtime);

		this.context.fillStyle = this.options.foreground ?? "#000";
		this.context.font =
			balloon.mode === SM_WHISPER ? this.whisperFont : this.normalFont;
		this.context.textBaseline = "top";
		for (let i = 0; i < fInfo.nLines; i++) {
			const line = fInfo.lines[i];
			if (!line) continue;
			this.context.fillText(
				balloon.text.slice(line.start, line.start + line.length),
				runtime.bbox.left + (fInfo.leftX[i] ?? 0),
				-(runtime.bbox.top - i * runtime.style.font.lineHeight),
			);
		}
		this.context.restore();
	}

	render(panel: UnitPanel): void {
		const context = this.context;
		context.save();
		context.fillStyle = this.options.background ?? "#fff";
		context.fillRect(0, 0, this.options.unitWidth, this.options.unitHeight);
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		for (const body of panel.bodies) this.drawBody(body);
		for (let i = panel.balloons.length - 1; i >= 0; i--) {
			const balloon = panel.balloons[i];
			if (balloon) this.drawBalloon(balloon);
		}
		if (panel.hasBorder) {
			context.strokeStyle = this.options.foreground ?? "#000";
			// panel.cpp:1252 strokes a 2*60-wide pen on the panel edge path; the outer half clips away
			context.lineWidth = 120;
			context.strokeRect(0, 0, this.options.unitWidth, this.options.unitHeight);
		}
		context.restore();
	}
}
