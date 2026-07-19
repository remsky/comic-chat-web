// Port of the emotion-wheel model from bodycam.cpp (v1.0-pre-modern at 96 DPI).

import {
	angleToVector,
	dpointScalmult,
	dpointToPoint,
	PI,
	type Point,
	pointAdd,
	pointMagn,
	pointSub,
	vectorToAngle,
} from "./vector2d.js";

export const NEMOTIONS = 8;

// bodycam.cpp:184-185
export const MAXBULL = 159;
export const MINBULL = 93;

// CBodyCam::m_cursorRadius / m_iconWidth / m_iconHeight statics (bodycam.cpp:601-603)
export const CURSOR_RADIUS = 5;
export const ICON_WIDTH = 20;
export const ICON_HEIGHT = 26;

// ID_EM_HAPPY..ID_EM_NEUTRAL (chat.rc:888-896), contiguous ids so index 8 is Neutral
export const EMOTION_NAMES = [
	"Happy",
	"Coy",
	"Bored",
	"Scared",
	"Sad",
	"Angry",
	"Shout",
	"Laugh",
	"Neutral",
] as const;

// lg_icons[] (bodycam.cpp:57-67), indexed by wheel position
export const WHEEL_ICON_FILES = [
	"fc_hap_l",
	"fc_coy_l",
	"fc_bor_l",
	"fc_sca_l",
	"fc_sad_l",
	"fc_ang_l",
	"fc_sho_l",
	"fc_laf_l",
] as const;

// ID_EMOTION_IS (chat.rc:978)
export function emotionIsStatus(name: string): string {
	return `Emotion is ${name}`;
}

// CEmotion: a float pair
export interface Emotion {
	emotion: number;
	intensity: number;
}

// screen-space rect, y down; icon rects keep top > bottom ("flipped to support hit-testing")
export interface ScreenRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface BullSide {
	bullSide: number;
	bullDisabled: boolean;
}

// CBodyCam::CacheBullSide (bodycam.cpp:188-194)
export function cacheBullSide(width: number): BullSide {
	let bullSide = Math.min(width, MAXBULL);
	if (bullSide < MINBULL) {
		bullSide = MINBULL;
		return { bullSide, bullDisabled: true };
	}
	return { bullSide, bullDisabled: false };
}

export interface WheelLayout {
	bullsEye: Point;
	// radius the circle outline is drawn with (bodycam.cpp:202)
	circleRadius: number;
	// post-decrement radius for cursor constraint, emotion mapping, icon offsets (bodycam.cpp:212)
	bullRadius: number;
}

// The bullseye geometry DrawBullsEye derives from the client rect (bodycam.cpp:196-213).
export function wheelLayout(rect: ScreenRect, bullSide: number): WheelLayout {
	const halfSide = Math.trunc(bullSide / 2);
	const bullsEye = {
		x: Math.trunc((rect.left + rect.right) / 2),
		y: rect.bottom - halfSide,
	};
	const circleRadius = halfSide - CURSOR_RADIUS - ICON_HEIGHT;
	return { bullsEye, circleRadius, bullRadius: circleRadius - CURSOR_RADIUS };
}

// CBodyCam::GetIconRect (bodycam.cpp:215-227)
export function getIconRect(index: number, layout: WheelLayout): ScreenRect {
	const offsetFromEye =
		layout.bullRadius + 2 * CURSOR_RADIUS + Math.trunc(ICON_HEIGHT / 2);
	const angle = (2 * PI * index) / NEMOTIONS;
	const iconCenter = pointAdd(
		dpointToPoint(dpointScalmult(offsetFromEye, angleToVector(angle))),
		layout.bullsEye,
	);
	return {
		top: iconCenter.y + Math.trunc(ICON_HEIGHT / 2),
		bottom: iconCenter.y - Math.trunc(ICON_HEIGHT / 2),
		left: iconCenter.x - Math.trunc(ICON_WIDTH / 2),
		right: iconCenter.x + Math.trunc(ICON_WIDTH / 2),
	};
}

// OnToolHitTest (bodycam.cpp:247-254) via inside_bbox (bbox.cpp:39): flipped rects, inclusive edges
export function iconHitTest(point: Point, layout: WheelLayout): number {
	for (let i = 0; i < NEMOTIONS; i++) {
		const rect = getIconRect(i, layout);
		if (
			point.x >= rect.left &&
			point.x <= rect.right &&
			point.y >= rect.bottom &&
			point.y <= rect.top
		)
			return i;
	}
	return -1;
}

// CBodyCam::GetEmotionFromPoint (bodycam.cpp:330-340)
export function getEmotionFromPoint(
	point: Point,
	layout: WheelLayout,
): Emotion {
	const vec = pointSub(point, layout.bullsEye);
	let intensity = Math.fround(Math.fround(pointMagn(vec)) / layout.bullRadius);
	intensity = Math.fround(Math.min(intensity, 1.0));
	// create a detente in the center
	if (intensity < 0.2) intensity = 0;
	const emotion = intensity === 0 ? 0 : Math.fround(vectorToAngle(vec));
	return { emotion, intensity };
}

// CBodyCam::GetPointFromEmotion (bodycam.cpp:342-348)
export function getPointFromEmotion(
	emotion: Emotion,
	layout: WheelLayout,
): Point {
	const scalar = Math.fround(layout.bullRadius * emotion.intensity);
	const dvec = dpointScalmult(scalar, angleToVector(emotion.emotion));
	return pointAdd(layout.bullsEye, dpointToPoint(dvec));
}

// StringFromEmotion (bodycam.cpp:257-268), returned as an EMOTION_NAMES index
export function emotionNameIndex(em: Emotion): number {
	if (em.intensity === 0.0) return 8;
	if (em.emotion >= (7 * PI) / 8 || em.emotion < (-7 * PI) / 8) return 4;
	if (em.emotion <= (-5 * PI) / 8) return 5;
	if (em.emotion <= (-3 * PI) / 8) return 6;
	if (em.emotion <= -PI / 8) return 7;
	if (em.emotion > (5 * PI) / 8) return 3;
	if (em.emotion > (3 * PI) / 8) return 2;
	if (em.emotion > PI / 8) return 1;
	return 0;
}

export function stringFromEmotion(em: Emotion): string {
	return EMOTION_NAMES[emotionNameIndex(em)] ?? "Neutral";
}

// CBodyCam wheel state; UpdateEmotion registers a change only on a new cursor pixel (bodycam.cpp:350-370)
export class BodyCamModel {
	// start off neutral (bodycam.cpp:83)
	emotion: Emotion = { emotion: 0, intensity: 0 };
	cursorPos: Point = { x: 0, y: 0 };
	bullSide = MINBULL;
	bullDisabled = true;
	layout: WheelLayout = wheelLayout(
		{ left: 0, top: 0, right: 0, bottom: 0 },
		MINBULL,
	);

	// OnSize caches the bull side; OnPaint re-derives the bullseye and cursor (bodycam.cpp:816,159-164)
	setRect(rect: ScreenRect): void {
		const side = cacheBullSide(rect.right - rect.left);
		this.bullSide = side.bullSide;
		this.bullDisabled = side.bullDisabled;
		this.layout = wheelLayout(rect, this.bullSide);
		this.cursorPos = getPointFromEmotion(this.emotion, this.layout);
	}

	// CBodyCam::UpdateEmotion minus the drawing; returns whether the cursor moved.
	updateEmotion(emotion: Emotion): boolean {
		const newPos = getPointFromEmotion(emotion, this.layout);
		if (newPos.x === this.cursorPos.x && newPos.y === this.cursorPos.y)
			return false;
		this.cursorPos = newPos;
		this.emotion = emotion;
		return true;
	}
}
