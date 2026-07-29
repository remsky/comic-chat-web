// Browser text measurement: a real canvas context behind the shared metrics adapter in src/render.

export {
	BALLOON_FONT_FAMILIES,
	BALLOON_FONT_SIZE,
	type CanvasMeasureContext,
	CanvasTextMeasurer,
	type CanvasTextMeasurerOptions,
	gdiCellFont,
	NORMAL_FONT_CSS,
	NORMAL_FONT_METRICS,
	SYSTEM_FONT_CSS,
	WHISPER_FONT_CSS,
	WHISPER_FONT_METRICS,
} from "../render/textMetrics.js";

import { NORMAL_FONT_CSS, WHISPER_FONT_CSS } from "../render/textMetrics.js";

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
