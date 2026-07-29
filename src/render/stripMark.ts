// The credit line every exported sheet carries, drawn into the band under the last panel row.

import type { PanelRenderContext } from "./renderContext.js";

const MARK_COLOR = "#222";
const MARK_FAMILY = '"Segoe UI", system-ui, sans-serif';
// a one-column sheet is the reference; wider sheets scale by the square root, enough to stay legible without taking over
const MARK_BASE_WIDTH = 700;
const MARK_FONT_PX = 12;
const MARK_MIN_FONT_PX = 9;

// the host comes off the page, so a fork's exports name the fork
export function stripMarkParts(host: string): { left: string; right: string } {
	return {
		left: "Comic Chat 1996 port · original character design by Jim Woodring",
		right: host ? `created at ${host}` : "",
	};
}

function markFont(width: number): number {
	const scale = Math.max(1, Math.sqrt(width / MARK_BASE_WIDTH));
	return Math.round(MARK_FONT_PX * scale);
}

// both ends share one line, so step down until four ems of daylight separate them
function fitFont(
	context: PanelRenderContext,
	left: string,
	right: string,
	width: number,
	gap: number,
	start: number = gap,
): number {
	const room = width - start - gap;
	let px = markFont(width);
	while (px > MARK_MIN_FONT_PX) {
		context.font = `${px}px ${MARK_FAMILY}`;
		const used =
			context.measureText(left).width + context.measureText(right).width;
		if (used + px * 4 <= room) break;
		px -= 1;
	}
	return px;
}

// the band gives the type twice its own height; a small sheet already has that much gutter
function markBand(width: number, gap: number): number {
	return Math.max(gap, markFont(width) * 2);
}

// extra sheet height the band needs beyond the gutter under the last row
export function stripMarkGrowth(width: number, gap: number): number {
	return markBand(width, gap) - gap;
}

// one baseline, each end set flush against its margin; start lets the credit skip a borderless lead panel
export function drawMarkLine(
	context: PanelRenderContext,
	width: number,
	margin: number,
	y: number,
	host: string,
	start: number = margin,
): void {
	const { left, right } = stripMarkParts(host);
	context.save();
	context.font = `${fitFont(context, left, right, width, margin, start)}px ${MARK_FAMILY}`;
	context.fillStyle = MARK_COLOR;
	context.textBaseline = "middle";
	context.textAlign = "left";
	context.fillText(left, start, y);
	context.textAlign = "right";
	context.fillText(right, width - margin, y);
	context.restore();
}

export function drawStripMark(
	context: PanelRenderContext,
	width: number,
	height: number,
	gap: number,
	host: string,
	start: number = gap,
): void {
	// whole pixels, so "middle" never lands the glyphs on a subpixel boundary
	const y = height - Math.round(markBand(width, gap) / 2);
	drawMarkLine(context, width, gap, y, host, start);
}
