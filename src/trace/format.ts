// Types and parser for the oracle's JSONL trace format (see docs/porting-process/02-trace-harness.md).

export type SRect = [left: number, bottom: number, right: number, top: number];

export interface HeaderRecord {
	type: "header";
	srand: number;
	unitWidth: number;
	unitHeight: number;
	panelsPerRow: number;
	panelsAtStart: number;
}

export interface CastRecord {
	type: "cast";
	i: number;
	name: string;
	avatarId: number;
}

export interface MessageRecord {
	type: "message";
	seq: number;
	speaker: number;
	mode: number;
	text: string;
}

export interface EmotionRecord {
	type: "emotion";
	avatarId: number;
	opts: [emotion: number, intensity: number, priority: number][];
	faceIndex: number;
	torsoIndex: number;
	requested: number;
}

export interface PanelDecisionRecord {
	type: "panelDecision";
	cloned: number;
	speaker: number;
	words: string;
}

export interface PanelRetryRecord {
	type: "panelRetry";
}

export interface TextExtentRecord {
	type: "textExtent";
	str: string;
	cx: number;
	cy: number;
	fontHeight: number;
	fontFace: string;
}

export interface PanelRecord {
	type: "panel";
	panel: number;
	seed: number;
	hasBorder: number;
	backdropId: number;
	backdropMode: number;
	nBodies: number;
	nElements: number;
}

export interface BodyRecord {
	type: "body";
	panel: number;
	i: number;
	avatarId: number;
	flip: number;
	requested: number;
	arrowX: number;
	bbox: SRect;
	bodyClass: number;
	poseFace: number;
	poseTorso: number;
}

export interface BalloonRecord {
	type: "balloon";
	panel: number;
	i: number;
	speaker: number;
	peType: number;
	bbox: SRect;
	trueBox: SRect;
	routeRgn: [left: number, right: number];
	text: string;
}

export interface BalloonFormatRecord {
	type: "balloonFormat";
	panel: number;
	i: number;
	nLines: number;
	maxWidth: number;
	fbox: SRect;
	shifted: number;
	lines: [length: number, width: number, leftX: number][];
}

export interface BalloonSplineRecord {
	type: "balloonSpline";
	panel: number;
	i: number;
	closed: number;
	nCps: number;
	cps: [x: number, y: number][];
}

export interface ElementRecord {
	type: "element";
	panel: number;
	i: number;
	peType: number;
	bbox: SRect;
}

export interface EndRecord {
	type: "end";
	messages: number;
}

export type TraceRecord =
	| HeaderRecord
	| CastRecord
	| MessageRecord
	| EmotionRecord
	| PanelDecisionRecord
	| PanelRetryRecord
	| TextExtentRecord
	| PanelRecord
	| BodyRecord
	| BalloonRecord
	| BalloonFormatRecord
	| BalloonSplineRecord
	| ElementRecord
	| EndRecord;

export function parseTrace(jsonl: string): TraceRecord[] {
	return jsonl
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as TraceRecord);
}

export function recordsOfType<T extends TraceRecord["type"]>(
	records: TraceRecord[],
	type: T,
): Extract<TraceRecord, { type: T }>[] {
	return records.filter(
		(r): r is Extract<TraceRecord, { type: T }> => r.type === type,
	);
}
