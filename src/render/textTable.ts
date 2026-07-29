// Deterministic text metrics from the shipped Comic Neue tables; stands in for a canvas measure context.

import {
	COMIC_NEUE_ITALIC,
	COMIC_NEUE_REGULAR,
	type FaceMetrics,
} from "./comicNeueMetrics.js";
import type { CanvasMeasureContext } from "./textMetrics.js";

export interface TableTextMetrics {
	width: number;
	fontBoundingBoxAscent: number;
	fontBoundingBoxDescent: number;
	actualBoundingBoxDescent: number;
}

export function parseFontPx(font: string): number {
	const match = /(\d+(?:\.\d+)?)px/.exec(font);
	return match?.[1] ? Number(match[1]) : 16;
}

function face(font: string): FaceMetrics {
	return font.includes("italic") ? COMIC_NEUE_ITALIC : COMIC_NEUE_REGULAR;
}

export function advanceWidth(metrics: FaceMetrics, text: string): number {
	let units = 0;
	for (const char of text)
		units += metrics.advances[char] ?? metrics.fallbackAdvance;
	return units;
}

function inkDescent(metrics: FaceMetrics, text: string): number {
	let units = 0;
	for (const char of text)
		units = Math.max(units, metrics.inkDescents[char] ?? 0);
	return units;
}

// actual descent reads as if textBaseline were "top", so descender() recovers the ink below the baseline
export class TableMeasureContext implements CanvasMeasureContext {
	font = "";

	measureText(text: string): TableTextMetrics {
		const metrics = face(this.font);
		const scale = parseFontPx(this.font) / metrics.unitsPerEm;
		return {
			width: advanceWidth(metrics, text) * scale,
			fontBoundingBoxAscent: metrics.ascent * scale,
			fontBoundingBoxDescent: metrics.descent * scale,
			actualBoundingBoxDescent:
				(metrics.ascent + inkDescent(metrics, text)) * scale,
		};
	}
}
