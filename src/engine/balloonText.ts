// Port of the text-formatting half of balloon.cpp: line breaking, format info, line shifting.

import { type Rect, toShort } from "./bbox.js";
import { isPrint, isSpace, toUpperAscii } from "./ctype.js";

export interface TextSize {
	cx: number;
	cy: number;
}

// stands in for GDI GetTextExtent; production uses canvas measureText, validation injects oracle metrics
export type TextMeasure = (text: string) => TextSize;

export interface FontMetrics {
	lineHeight: number;
	baseAdd: number;
	leading: number;
}

export interface Line {
	start: number;
	length: number;
	width: number;
}

export interface FormatInfo {
	nLines: number;
	lines: Line[];
	maxWidth: number;
	fbox: Rect;
	leftX: number[];
	shifted: boolean;
}

export const FT_LEFT_JUSTIFY = 1;
export const MAXLINES = 30;
export const MAXLEFTSHIFT = 0;
export const MAXCENTERSHIFT = 0;

// CharUpperBuff was locale-aware; ASCII covers the MVP
export function capitalize(str: string): string {
	return toUpperAscii(str);
}

export function getNextStart(str: string, pos: number): number {
	while (pos < str.length && isSpace(str.charCodeAt(pos))) pos++;
	return pos;
}

export function getNextEnd(str: string, pos: number): number {
	while (pos < str.length && isSpace(str.charCodeAt(pos))) pos++;
	while (pos < str.length && !isSpace(str.charCodeAt(pos))) pos++;
	return pos;
}

export function forceLineBreak(
	measure: TextMeasure,
	str: string,
	base: number,
	maxWidth: number,
): { length: number; width: number } {
	let width = 0;
	let length = 0;
	while (true) {
		length++;
		const extent = measure(str.slice(base, base + length));
		if (base + length < str.length && extent.cx <= maxWidth) {
			width = extent.cx;
		} else {
			length--;
			return { length, width };
		}
	}
}

export function findFurthestLineBreak(
	measure: TextMeasure,
	maxWidth: number,
	str: string,
	base: number,
): { end: number; width: number } {
	let width = 0;
	let lastEnd = base;
	let lineEnd = base;
	while (true) {
		lastEnd = lineEnd;
		lineEnd = getNextEnd(str, lineEnd);
		const thisLength = lineEnd - base;
		const extent = measure(str.slice(base, base + thisLength));
		if (extent.cx <= maxWidth) {
			width = extent.cx;
			if (lineEnd >= str.length) return { end: lineEnd, width };
		} else {
			if (lastEnd === base) {
				const forced = forceLineBreak(measure, str, base, maxWidth);
				width = forced.width;
				lastEnd = base + forced.length;
			}
			return { end: lastEnd, width };
		}
	}
}

// the keep-word-intact overflow handling is the modern tree's word-wrap fix, which the oracle build has
export function breakIntoLines(
	measure: TextMeasure,
	maxWidth: number,
	str: string,
): Line[] | null {
	const lines: Line[] = [];
	let base = 0;
	let lineEnd = 0;
	let thisLength = 0;
	let lastLength = 0;
	let lastWidth = 0;
	while (true) {
		lineEnd = getNextEnd(str, lineEnd);
		lastLength = thisLength;
		thisLength = lineEnd - base;
		const extent = measure(str.slice(base, base + thisLength));
		if (extent.cx <= maxWidth) {
			if (lineEnd >= str.length) {
				lines.push({ start: base, length: thisLength, width: extent.cx });
				return lines;
			}
			lastWidth = extent.cx;
			continue;
		}
		if (lastLength === 0) {
			lastLength = thisLength;
			lastWidth = extent.cx;
		}
		lines.push({ start: base, length: lastLength, width: lastWidth });
		base = getNextStart(str, base + lastLength);
		lineEnd = base;
		if (base >= str.length) return lines;
		if (lines.length > MAXLINES) return null;
		thisLength = 0;
	}
}

export interface LabelFormatInput {
	str: string;
	format: number;
	bbox: Rect;
	fontI: FontMetrics;
	measure: TextMeasure;
}

export function labelBreakIntoLines(label: LabelFormatInput): FormatInfo {
	const { str, format, bbox, fontI, measure } = label;
	measure(str);
	const desiredWidth = bbox.right - bbox.left;
	const lines = breakIntoLines(measure, desiredWidth, str);
	const fInfo: FormatInfo = {
		nLines: lines ? lines.length : 0,
		lines: lines ?? [],
		maxWidth: 0,
		fbox: { left: 0, bottom: 0, right: 0, top: 0 },
		leftX: [],
		shifted: false,
	};

	for (const line of fInfo.lines)
		if (fInfo.maxWidth < line.width) fInfo.maxWidth = line.width;

	fInfo.fbox.top = bbox.top;
	if (format & FT_LEFT_JUSTIFY) {
		fInfo.fbox.left = bbox.left;
		fInfo.fbox.right = bbox.left + fInfo.maxWidth;
	} else {
		fInfo.fbox.left =
			Math.trunc((desiredWidth - fInfo.maxWidth) / 2) + bbox.left;
		fInfo.fbox.right = fInfo.fbox.left + fInfo.maxWidth;
	}

	fInfo.fbox.bottom = toShort(
		fInfo.fbox.top - fInfo.nLines * fontI.lineHeight - fontI.baseAdd,
	);
	return fInfo;
}

// randfloat is consumed once per line even though both max shifts are 0, to keep rand stream parity
export function shiftLines(
	fInfo: FormatInfo,
	format: number,
	randfloat: () => number,
): void {
	if (format & FT_LEFT_JUSTIFY) {
		for (let i = 0; i < fInfo.nLines; i++) {
			const line = fInfo.lines[i];
			if (!line) break;
			const shiftLimit = fInfo.maxWidth - line.width;
			fInfo.leftX[i] = Math.trunc(
				randfloat() * Math.min(MAXLEFTSHIFT, shiftLimit),
			);
		}
	} else {
		for (let i = 0; i < fInfo.nLines; i++) {
			const line = fInfo.lines[i];
			if (!line) break;
			const shiftLimit = Math.trunc((fInfo.maxWidth - line.width) / 2);
			const shift = Math.trunc(
				(randfloat() * 2.0 - 1.0) * Math.min(MAXCENTERSHIFT, shiftLimit),
			);
			fInfo.leftX[i] =
				Math.trunc((fInfo.fbox.right - fInfo.fbox.left - line.width) / 2) +
				shift;
		}
	}
	fInfo.shifted = true;
}

export function widestWord(measure: TextMeasure, str: string): number {
	let maxWidth = 0;
	let startPtr = 0;
	while (true) {
		while (startPtr < str.length && !isPrint(str.charCodeAt(startPtr)))
			startPtr++;
		if (startPtr >= str.length) break;
		let endPtr = startPtr;
		while (endPtr < str.length && isPrint(str.charCodeAt(endPtr))) endPtr++;
		// the C code measures one char past the word, including the NUL terminator at end of string
		const text =
			endPtr < str.length
				? str.slice(startPtr, endPtr + 1)
				: str.slice(startPtr) + String.fromCharCode(0);
		const extent = measure(text);
		maxWidth = Math.max(maxWidth, extent.cx);
		if (endPtr >= str.length) break;
		startPtr = endPtr + 1;
	}
	return maxWidth;
}

export function areaEstimate(
	measure: TextMeasure,
	str: string,
	fontI: FontMetrics,
): { area: number; len: number; lineHeight: number } {
	const extent = measure(str);
	return {
		area: Math.trunc(1.3 * extent.cx * (extent.cy + fontI.lineHeight)),
		len: extent.cx,
		lineHeight: fontI.lineHeight,
	};
}
