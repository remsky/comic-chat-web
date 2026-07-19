// Browser text metrics adapter. Engine geometry remains in v1 logical units.

import type {
	FontMetrics,
	TextMeasure,
	TextSize,
} from "../engine/balloonText.js";
import { SM_WHISPER } from "../engine/panel.js";
import type {
	BalloonStyle,
	BalloonStyleResolver,
} from "../engine/panelBalloon.js";

export const BALLOON_FONT_SIZE = 400;
export const BALLOON_FONT_FAMILIES =
	'"Comic Sans MS", "Comic Sans", "Comic Neue", cursive';
export const NORMAL_FONT_CSS = `400 400px ${BALLOON_FONT_FAMILIES}`;
export const WHISPER_FONT_CSS = `italic 400 400px ${BALLOON_FONT_FAMILIES}`;
export const SYSTEM_FONT_CSS = "400 212px system-ui, sans-serif";

// GDI lfHeight requests a character cell (ascent + descent) while CSS px sets the em, so scale the em until the bounding box matches the cell
export function gdiCellFont(
	context: CanvasMeasureContext,
	style: string,
	cellHeight: number,
	families: string = BALLOON_FONT_FAMILIES,
): string {
	const probe = `${style} ${cellHeight}px ${families}`.trim();
	context.font = probe;
	const metrics = context.measureText("Mg");
	const box =
		(metrics.fontBoundingBoxAscent ?? 0) +
		(metrics.fontBoundingBoxDescent ?? 0);
	if (!Number.isFinite(box) || box <= 0) return probe;
	const size = Math.round((cellHeight * cellHeight) / box);
	return `${style} ${size}px ${families}`.trim();
}

export const NORMAL_FONT_METRICS: FontMetrics = {
	lineHeight: 327,
	baseAdd: 60,
	leading: -70,
};

export const WHISPER_FONT_METRICS: FontMetrics = {
	lineHeight: 314,
	baseAdd: 60,
	leading: -70,
};

export interface CanvasMeasureContext {
	font: string;
	measureText(text: string): {
		width: number;
		fontBoundingBoxAscent?: number;
		fontBoundingBoxDescent?: number;
	};
}

export interface CanvasTextMeasurerOptions {
	maxEntries?: number;
	normalFont?: string;
	whisperFont?: string;
	systemFont?: string;
}

function canvasSafeText(text: string): string {
	// GDI's explicit trailing NUL has no advance; canvas otherwise renders a
	// replacement glyph in some engines.
	return text.replaceAll("\0", "");
}

export class CanvasTextMeasurer {
	readonly context: CanvasMeasureContext;
	readonly maxEntries: number;
	readonly systemFont: string;
	private readonly options: CanvasTextMeasurerOptions;
	private normalFontCache?: string;
	private whisperFontCache?: string;
	private readonly widths = new Map<string, number>();

	constructor(
		context: CanvasMeasureContext,
		options: CanvasTextMeasurerOptions = {},
	) {
		this.context = context;
		this.options = options;
		this.maxEntries = Math.max(1, options.maxEntries ?? 4096);
		this.systemFont = options.systemFont ?? SYSTEM_FONT_CSS;
	}

	get normalFont(): string {
		this.normalFontCache ??=
			this.options.normalFont ??
			gdiCellFont(this.context, "400", BALLOON_FONT_SIZE);
		return this.normalFontCache;
	}

	get whisperFont(): string {
		this.whisperFontCache ??=
			this.options.whisperFont ??
			gdiCellFont(this.context, "italic 400", BALLOON_FONT_SIZE);
		return this.whisperFontCache;
	}

	get size(): number {
		return this.widths.size;
	}

	clear(): void {
		this.widths.clear();
	}

	measure(font: string, height: number): TextMeasure {
		return (text: string): TextSize => {
			const safeText = canvasSafeText(text);
			const key = `${font}\0${safeText}`;
			const cached = this.widths.get(key);
			if (cached !== undefined) {
				this.widths.delete(key);
				this.widths.set(key, cached);
				return { cx: cached, cy: height };
			}

			this.context.font = font;
			const width = Math.round(this.context.measureText(safeText).width);
			this.widths.set(key, width);
			if (this.widths.size > this.maxEntries) {
				const oldest = this.widths.keys().next().value;
				if (oldest !== undefined) this.widths.delete(oldest);
			}
			return { cx: width, cy: height };
		};
	}

	styleResolver(): BalloonStyleResolver {
		const systemMeasure = this.measure(this.systemFont, 212);
		const normal: BalloonStyle = {
			measure: this.measure(this.normalFont, 397),
			widestMeasure: systemMeasure,
			font: NORMAL_FONT_METRICS,
		};
		const whisper: BalloonStyle = {
			measure: this.measure(this.whisperFont, 384),
			widestMeasure: systemMeasure,
			font: WHISPER_FONT_METRICS,
		};
		return (_text, mode) => (mode === SM_WHISPER ? whisper : normal);
	}
}

export function createCanvasMeasureContext(): CanvasRenderingContext2D {
	if (typeof OffscreenCanvas !== "undefined") {
		const context = new OffscreenCanvas(1, 1).getContext("2d");
		if (context) return context as unknown as CanvasRenderingContext2D;
	}
	if (typeof document !== "undefined") {
		const context = document.createElement("canvas").getContext("2d");
		if (context) return context;
	}
	throw new Error("Canvas 2D text measurement is unavailable");
}

export async function loadCanvasFonts(
	fontSet: FontFaceSet | undefined = typeof document === "undefined"
		? undefined
		: document.fonts,
): Promise<void> {
	if (!fontSet) return;
	await Promise.all([
		fontSet.load(NORMAL_FONT_CSS, "COMIC CHAT"),
		fontSet.load(WHISPER_FONT_CSS, "COMIC CHAT"),
	]);
}
