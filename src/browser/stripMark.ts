// Browser wrappers over the shared mark painter, defaulting the host to the page's own.

import {
	drawMarkLine as markLine,
	drawStripMark as stripMark,
} from "../render/stripMark.js";

export { stripMarkGrowth, stripMarkParts } from "../render/stripMark.js";

export function drawMarkLine(
	context: CanvasRenderingContext2D,
	width: number,
	margin: number,
	y: number,
	host: string = location.host,
	start: number = margin,
): void {
	markLine(context, width, margin, y, host, start);
}

export function drawStripMark(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	gap: number,
	host: string = location.host,
	start: number = gap,
): void {
	stripMark(context, width, height, gap, host, start);
}
