// Timing math for the animated export: each panel holds, balloons fade in, panels crossfade.

export const HOLD_SECONDS = 4.2;
export const XFADE_SECONDS = 0.6;
const FADE_START = 0.6;
const FADE_DURATION = 0.35;
const SPAN = HOLD_SECONDS - XFADE_SECONDS;

export interface TimelineFrame {
	index: number;
	local: number;
	blend?: { index: number; local: number; alpha: number };
}

export function timelineDuration(count: number): number {
	return HOLD_SECONDS + (count - 1) * SPAN;
}

// during a crossfade the outgoing panel keeps drawing and the incoming one blends over it
export function timelineAt(time: number, count: number): TimelineFrame {
	const index = Math.max(0, Math.min(Math.floor(time / SPAN), count - 1));
	// clamped: float error at an exact boundary can land a hair negative, flashing the incoming panel opaque
	const local = Math.max(0, time - index * SPAN);
	if (index > 0 && local < XFADE_SECONDS)
		return {
			index: index - 1,
			local: local + SPAN,
			blend: { index, local, alpha: local / XFADE_SECONDS },
		};
	return { index, local };
}

export function balloonAlpha(local: number): number {
	return Math.min(1, Math.max(0, (local - FADE_START) / FADE_DURATION));
}
