// Runtime balloon placement from panel.cpp and balloon.cpp.

import {
	createBalloonSpline,
	HWAVEHEIGHT,
	TOPBORDER,
	XBORDER,
	YBORDER,
} from "./balloonSpline.js";
import {
	areaEstimate,
	capitalize,
	type FontMetrics,
	type FormatInfo,
	FT_LEFT_JUSTIFY,
	findFurthestLineBreak,
	labelBreakIntoLines,
	shiftLines,
	type TextMeasure,
	widestWord,
} from "./balloonText.js";
import {
	includePtInBboxShort,
	makeEmptyShort,
	type Rect,
	toShort,
} from "./bbox.js";
import {
	type BalloonLayoutResult,
	type CloneableBalloonRuntime,
	type PanelBalloon,
	SM_ACTION,
	type UnitPanel,
} from "./panel.js";
import type { MsvcRand } from "./rand.js";
import { LARGEINTEGER } from "./vector2d.js";

const MINROUTEWIDTH = 300;
const MINHOOKHEIGHT = 100;
const ONELINETHRESHOLD = 500;
const BORDERFUDGE = 400;
const CONTINUATION_WIDTH = 150;
const XBOXDELTA = 90;
const YBOXDELTA = 50;

export interface BalloonStyle {
	measure: TextMeasure;
	widestMeasure?: TextMeasure;
	font: FontMetrics;
}

export type BalloonStyleResolver = (text: string, mode: number) => BalloonStyle;

function copyFormat(info: FormatInfo | null): FormatInfo | null {
	if (!info) return null;
	return {
		...info,
		lines: info.lines.map((line) => ({ ...line })),
		fbox: { ...info.fbox },
		leftX: [...info.leftX],
	};
}

export class BalloonRuntime implements CloneableBalloonRuntime {
	readonly style: BalloonStyle;
	readonly isBox: boolean;
	format: number;
	bbox: Rect = { left: -1, bottom: 0, right: -1, top: 0 };
	trueBox: Rect = { left: -1, bottom: -1, right: -1, top: -1 };
	routeRgn: Rect = { left: 0, bottom: 0, right: 0, top: 0 };
	fInfo: FormatInfo | null = null;
	spline: { closed: boolean; cps: { x: number; y: number }[] } | null = null;

	constructor(style: BalloonStyle, isBox: boolean) {
		this.style = style;
		this.isBox = isBox;
		this.format = isBox ? FT_LEFT_JUSTIFY : 0;
	}

	clone(): BalloonRuntime {
		const result = new BalloonRuntime(this.style, this.isBox);
		result.format = this.format;
		result.bbox = { ...this.bbox };
		result.trueBox = { ...this.trueBox };
		result.routeRgn = { ...this.routeRgn };
		result.fInfo = copyFormat(this.fInfo);
		result.spline = this.spline
			? {
					closed: this.spline.closed,
					cps: this.spline.cps.map((point) => ({ ...point })),
				}
			: null;
		return result;
	}

	private computeInternals(text: string, rand: MsvcRand): boolean {
		this.fInfo = labelBreakIntoLines({
			str: text,
			format: this.format,
			bbox: { left: 0, bottom: 0, right: this.bbox.right, top: 0 },
			fontI: this.style.font,
			measure: this.style.measure,
		});
		if (this.fInfo.nLines === 0) return false;
		shiftLines(this.fInfo, this.format, () => rand.randfloat());
		if (this.isBox) {
			this.spline = null;
			this.trueBox = {
				left: this.fInfo.fbox.left - XBOXDELTA,
				bottom: this.fInfo.fbox.bottom - YBOXDELTA,
				right: this.fInfo.fbox.right + XBOXDELTA,
				top: this.fInfo.fbox.top + YBOXDELTA,
			};
		} else {
			this.spline = createBalloonSpline(this.fInfo, this.style.font);
			makeEmptyShort(this.trueBox);
			for (const point of this.spline.cps)
				includePtInBboxShort(point, this.trueBox);
		}
		return true;
	}

	setBBox(
		text: string,
		left: number,
		bottom: number,
		right: number,
		top: number,
		rand: MsvcRand,
	): boolean {
		if (
			this.bbox.right - this.bbox.left !== right - left ||
			this.bbox.top - this.bbox.bottom !== top - bottom
		) {
			this.bbox.left = 0;
			this.bbox.right = toShort(right - left - 2 * XBORDER);
			this.bbox.top = 0;
			if (!this.computeInternals(text, rand)) return false;
			bottom = top + this.trueBox.bottom - this.trueBox.top;
		}
		this.bbox.left = toShort(left - this.trueBox.left);
		this.bbox.right = toShort(right - this.trueBox.left);
		this.bbox.top = toShort(top - this.trueBox.top);
		this.bbox.bottom = toShort(bottom - this.trueBox.top);
		return true;
	}

	cloudBBox(): Rect {
		return {
			left: this.trueBox.left + this.bbox.left,
			bottom: this.trueBox.bottom + this.bbox.top,
			right: this.trueBox.right + this.bbox.left,
			top: this.trueBox.top + this.bbox.top,
		};
	}

	dockAtTop(height: number): void {
		const oldHeight = this.bbox.top - this.bbox.bottom;
		this.bbox.top = toShort(height + TOPBORDER);
		this.bbox.bottom = toShort(this.bbox.top - oldHeight);
	}

	queryRoute(otherToX: number, speakerToX: number): [number, number] {
		if (this.isBox) return [-LARGEINTEGER, LARGEINTEGER];
		if (otherToX > speakerToX)
			return [
				Math.max(speakerToX, this.routeRgn.left + MINROUTEWIDTH),
				LARGEINTEGER,
			];
		return [
			-LARGEINTEGER,
			Math.min(speakerToX, this.routeRgn.right - MINROUTEWIDTH),
		];
	}

	setRoute(
		otherToX: number,
		speakerToX: number,
		left: number,
		right: number,
	): void {
		if (this.isBox) return;
		if (otherToX > speakerToX)
			this.routeRgn.right = toShort(Math.min(this.routeRgn.right, left));
		else this.routeRgn.left = toShort(Math.max(this.routeRgn.left, right));
	}

	splitHeight(
		text: string,
		height: number,
		rand: MsvcRand,
	): { text: string; rest: string } | undefined {
		if (!this.fInfo) return undefined;
		const maxLines = Math.trunc(
			(height - BORDERFUDGE) / this.style.font.lineHeight,
		);
		if (maxLines >= this.fInfo.nLines) return undefined;
		const lastLine = this.fInfo.lines[maxLines - 1];
		if (!lastLine) return undefined;
		const found = findFurthestLineBreak(
			this.style.widestMeasure ?? this.style.measure,
			this.fInfo.fbox.right - this.fInfo.fbox.left - CONTINUATION_WIDTH,
			text,
			lastLine.start,
		);
		const newText = `${text.slice(0, found.end)}...`;
		const rest = `...${text.slice(found.end)}`;
		this.bbox.left--;
		this.setBBox(
			newText,
			this.bbox.left + this.trueBox.left + 1,
			this.bbox.bottom + this.trueBox.top,
			this.bbox.right + this.trueBox.left,
			this.bbox.top + this.trueBox.top,
			rand,
		);
		return { text: newText, rest };
	}
}

export interface PanelBalloonLayoutOptions {
	unitWidth: number;
	unitHeight: number;
	resolveStyle: BalloonStyleResolver;
}

export function makeRuntimeBalloon(
	text: string,
	mode: number,
	speaker: PanelBalloon["speaker"],
	resolveStyle: BalloonStyleResolver,
): PanelBalloon {
	const formatted = capitalize(text);
	return {
		text: formatted,
		mode,
		speaker,
		runtime: new BalloonRuntime(
			resolveStyle(formatted, mode),
			mode === SM_ACTION,
		),
	};
}

function runtimeOf(balloon: PanelBalloon): BalloonRuntime {
	if (!(balloon.runtime instanceof BalloonRuntime))
		throw new Error("panel balloon has no runtime layout state");
	return balloon.runtime;
}

export function layoutPanelBalloons(
	panel: UnitPanel,
	rand: MsvcRand,
	options: PanelBalloonLayoutOptions,
): BalloonLayoutResult {
	const freeRect: Rect = {
		left: 60,
		bottom: -Math.trunc(options.unitHeight / 2),
		right: options.unitWidth - 60,
		top: -60,
	};

	for (let index = 0; index < panel.balloons.length; index++) {
		const balloon = panel.balloons[index];
		if (!balloon) continue;
		const runtime = runtimeOf(balloon);
		const estimate = areaEstimate(
			runtime.style.measure,
			balloon.text,
			runtime.style.font,
		);
		const maxWidth = freeRect.right - freeRect.left;
		let goalWidth: number;
		if (estimate.len <= ONELINETHRESHOLD) goalWidth = estimate.len;
		else {
			let lowest = freeRect.top;
			for (let i = 0; i < index; i++) {
				const prior = panel.balloons[i];
				if (prior) lowest = Math.min(lowest, runtimeOf(prior).bbox.bottom);
			}
			const potentialHeight = lowest - freeRect.bottom + MINHOOKHEIGHT;
			let minWidth = Math.trunc(estimate.area / potentialHeight);
			minWidth = Math.max(
				minWidth,
				widestWord(
					runtime.style.widestMeasure ?? runtime.style.measure,
					balloon.text,
				),
			);
			goalWidth =
				minWidth + Math.trunc(rand.randfloat() * (maxWidth - minWidth));
		}
		goalWidth = Math.min(goalWidth + 200, maxWidth);
		goalWidth = Math.min(goalWidth, estimate.len + 200);

		let left = freeRect.left;
		if (!runtime.isBox) {
			const leftLimit = balloon.speaker.arrowX - goalWidth;
			const startX =
				leftLimit +
				Math.trunc(rand.randfloat() * (balloon.speaker.arrowX - leftLimit));
			left = Math.max(startX, freeRect.left);
			if (left + goalWidth > freeRect.right) left = freeRect.right - goalWidth;
		}
		const rect: Rect = {
			left,
			bottom: 0,
			right: left + goalWidth,
			top: freeRect.top,
		};
		let mostLeft = freeRect.left;
		let mostRight = freeRect.right;
		for (let i = 0; i < index; i++) {
			const prior = panel.balloons[i];
			if (!prior) continue;
			const allowance = runtimeOf(prior).queryRoute(
				balloon.speaker.arrowX,
				prior.speaker.arrowX,
			);
			mostLeft = Math.max(mostLeft, allowance[0]);
			mostRight = Math.min(mostRight, allowance[1]);
		}
		if (mostLeft > rect.left || mostRight < rect.right) {
			if (mostRight - mostLeft >= rect.right - rect.left) {
				const delta =
					mostLeft > rect.left ? mostLeft - rect.left : mostRight - rect.right;
				rect.left += delta;
				rect.right += delta;
			} else {
				rect.left = mostLeft;
				rect.right = mostRight;
			}
		}
		for (let i = 0; i < index; i++) {
			const prior = panel.balloons[i];
			if (!prior) continue;
			const cloud = runtimeOf(prior).cloudBBox();
			if (cloud.right < rect.left) rect.top = Math.min(rect.top, cloud.top);
			else {
				const delta = TOPBORDER + YBORDER + HWAVEHEIGHT;
				rect.top = Math.min(rect.top, cloud.bottom + delta);
			}
		}
		// v1 never initializes LayoutBalloon's RECT.bottom. In the oracle build the
		// resulting height comparison always takes SetBBox's reformat path, including
		// cloned balloons; the balloonFormat trace records and rand stream pin this.
		rect.bottom = 0;
		if (
			!runtime.setBBox(
				balloon.text,
				rect.left,
				rect.bottom,
				rect.right,
				rect.top,
				rand,
			)
		)
			return { fits: false };
		if (runtime.bbox.top > -250) runtime.dockAtTop(freeRect.top);
		runtime.routeRgn = Object.fromEntries(
			Object.entries(runtime.cloudBBox()).map(([key, value]) => [
				key,
				toShort(value),
			]),
		) as unknown as Rect;
		if (runtime.routeRgn.bottom < freeRect.bottom + MINHOOKHEIGHT) {
			if (index > 0) return { fits: false };
			if (
				!runtime.setBBox(
					balloon.text,
					freeRect.left,
					freeRect.bottom,
					freeRect.right,
					freeRect.top,
					rand,
				)
			)
				return { fits: true };
			const split = runtime.splitHeight(
				balloon.text,
				freeRect.top - freeRect.bottom,
				rand,
			);
			if (runtime.bbox.top > -250) runtime.dockAtTop(freeRect.top);
			if (split) balloon.text = split.text;
			return { fits: true, leftover: split?.rest };
		}
		for (let i = 0; i < index; i++) {
			const prior = panel.balloons[i];
			if (!prior) continue;
			runtimeOf(prior).setRoute(
				balloon.speaker.arrowX,
				prior.speaker.arrowX,
				runtime.routeRgn.left,
				runtime.routeRgn.right,
			);
		}
	}
	return { fits: true };
}
