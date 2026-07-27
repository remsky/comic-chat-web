// Renders the strip to an animated MP4 or GIF entirely in the browser: WebCodecs plus mp4-muxer for video, gifenc for GIF.

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { AvatarAtlasCache } from "../browser/avatarAssets.js";
import type { BackdropCache } from "../browser/backdropAssets.js";
import { CanvasPanelRenderer } from "../browser/canvasRenderer.js";
import { drawMarkLine } from "../browser/stripMark.js";
import { type Avatar, AvatarRegistry } from "../engine/avatar.js";
import type { UnitPanel } from "../engine/panel.js";
import { type ComposeOptions, composeStrip } from "./compose.js";
import type { Strip } from "./script.js";
import {
	balloonAlpha,
	HOLD_SECONDS,
	timelineAt,
	timelineDuration,
	XFADE_SECONDS,
} from "./timeline.js";

const SIZE = 600;
const FPS = 30;
// 40 keeps the frame height even for h264 and the GIF scale integral
const MARK_BAND = 40;
const OUT_HEIGHT = SIZE + MARK_BAND;
const GIF_SIZE = 480;
const GIF_HEIGHT = (GIF_SIZE * OUT_HEIGHT) / SIZE;
const GIF_DELAY_MS = 80;
const TRANSPARENT = 255;

export interface AnimateDeps {
	atlases: AvatarAtlasCache;
	backdrops: BackdropCache;
	compose: ComposeOptions;
}

export type AnimateProgress = (fraction: number) => void;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// bodies are placed before balloons, so a text-free copy renders identical panels minus the balloons
function silentCopy(strip: Strip): Strip {
	const copy = structuredClone(strip);
	for (const panel of copy.panels)
		for (const actor of panel.actors) {
			delete actor.text;
			delete actor.mode;
		}
	return copy;
}

function renderPanel(
	panel: UnitPanel,
	unit: number,
	deps: AnimateDeps,
	cast: readonly Avatar[],
): HTMLCanvasElement | null {
	const canvas = document.createElement("canvas");
	canvas.width = SIZE;
	canvas.height = SIZE;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.fillStyle = "#fff";
	context.fillRect(0, 0, SIZE, SIZE);
	const renderer = new CanvasPanelRenderer(context, deps.atlases, cast, {
		unitWidth: unit,
		unitHeight: unit,
		resolveBackdrop: (name) => deps.backdrops.get(name),
	});
	const scale = SIZE / unit;
	context.setTransform(scale, 0, 0, scale, 0, 0);
	context.beginPath();
	context.rect(0, 0, unit, unit);
	context.clip();
	renderer.render(panel);
	return canvas;
}

interface Scrubber {
	duration: number;
	panels: number;
	drawAt(time: number): HTMLCanvasElement;
}

function buildScrubber(strip: Strip, deps: AnimateDeps): Scrubber | null {
	const cast = new AvatarRegistry(deps.compose.avatars).avatars;
	const full = composeStrip(strip, deps.compose);
	const silent = composeStrip(silentCopy(strip), deps.compose);
	if (full.panels.length === 0) return null;
	const frames: { base: HTMLCanvasElement; full: HTMLCanvasElement }[] = [];
	for (let i = 0; i < full.panels.length; i++) {
		const spoken = full.panels[i];
		const quiet = silent.panels[i];
		if (!spoken || !quiet) return null;
		const base = renderPanel(quiet.panel, silent.unit, deps, cast);
		const drawn = renderPanel(spoken.panel, full.unit, deps, cast);
		if (!base || !drawn) return null;
		frames.push({ base, full: drawn });
	}
	const work = document.createElement("canvas");
	work.width = SIZE;
	work.height = OUT_HEIGHT;
	const layer = document.createElement("canvas");
	layer.width = SIZE;
	layer.height = OUT_HEIGHT;
	const workContext = work.getContext("2d");
	const layerContext = layer.getContext("2d");
	if (!workContext || !layerContext) return null;
	// static credit band, framed as part of the comic: side rails continue the panel border down to a closing rule
	const border = Math.round(60 * (SIZE / full.unit));
	for (const context of [workContext, layerContext]) {
		context.fillStyle = "#fff";
		context.fillRect(0, 0, SIZE, OUT_HEIGHT);
		context.fillStyle = "#000";
		context.fillRect(0, SIZE, border, MARK_BAND);
		context.fillRect(SIZE - border, SIZE, border, MARK_BAND);
		context.fillRect(0, OUT_HEIGHT - border, SIZE, border);
		drawMarkLine(
			context,
			SIZE,
			border + 8,
			SIZE + Math.round((MARK_BAND - border) / 2),
		);
	}

	const paint = (
		context: CanvasRenderingContext2D,
		index: number,
		local: number,
	) => {
		const panel = frames[index];
		if (!panel) return;
		context.globalAlpha = 1;
		context.drawImage(panel.base, 0, 0);
		const alpha = balloonAlpha(local);
		if (alpha > 0) {
			context.globalAlpha = alpha;
			context.drawImage(panel.full, 0, 0);
			context.globalAlpha = 1;
		}
	};

	return {
		duration: timelineDuration(frames.length),
		panels: frames.length,
		drawAt(time) {
			const frame = timelineAt(time, frames.length);
			paint(workContext, frame.index, frame.local);
			if (frame.blend) {
				paint(layerContext, frame.blend.index, frame.blend.local);
				workContext.globalAlpha = frame.blend.alpha;
				workContext.drawImage(layer, 0, 0);
				workContext.globalAlpha = 1;
			}
			return work;
		},
	};
}

export async function exportMp4(
	strip: Strip,
	deps: AnimateDeps,
	onProgress?: AnimateProgress,
): Promise<Blob | null> {
	if (typeof VideoEncoder === "undefined") return null;
	const scrubber = buildScrubber(strip, deps);
	if (!scrubber) return null;
	const muxer = new Muxer({
		target: new ArrayBufferTarget(),
		video: { codec: "avc", width: SIZE, height: OUT_HEIGHT },
		fastStart: "in-memory",
	});
	let failure: Error | null = null;
	const encoder = new VideoEncoder({
		output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
		error: (error) => {
			failure = error;
		},
	});
	encoder.configure({
		codec: "avc1.42001f",
		width: SIZE,
		height: OUT_HEIGHT,
		bitrate: 8_000_000,
	});
	// a keyframe at each crossfade start stops motion search from wobbling the hatched backgrounds
	const keyframes = new Set<number>();
	for (let k = 1; k < scrubber.panels; k++)
		keyframes.add(Math.round(k * (HOLD_SECONDS - XFADE_SECONDS) * FPS));
	const total = Math.round(scrubber.duration * FPS);
	for (let i = 0; i < total && !failure; i++) {
		const frame = new VideoFrame(scrubber.drawAt(i / FPS), {
			timestamp: (i * 1_000_000) / FPS,
			duration: 1_000_000 / FPS,
		});
		encoder.encode(frame, {
			keyFrame: i % (FPS * 2) === 0 || keyframes.has(i),
		});
		frame.close();
		onProgress?.(i / total);
		if (encoder.encodeQueueSize > FPS) await settle();
	}
	await encoder.flush();
	encoder.close();
	if (failure) throw failure;
	muxer.finalize();
	return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

function framesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// unchanged pixels take the transparent slot, so held regions cost almost nothing to re-encode
function diffFrame(next: Uint8Array, previous: Uint8Array): Uint8Array {
	const out = new Uint8Array(next.length);
	for (let i = 0; i < next.length; i++)
		out[i] = next[i] === previous[i] ? TRANSPARENT : (next[i] ?? 0);
	return out;
}

export async function exportGif(
	strip: Strip,
	deps: AnimateDeps,
	onProgress?: AnimateProgress,
): Promise<Blob | null> {
	const scrubber = buildScrubber(strip, deps);
	if (!scrubber) return null;
	const small = document.createElement("canvas");
	small.width = GIF_SIZE;
	small.height = GIF_HEIGHT;
	const context = small.getContext("2d", { willReadFrequently: true });
	if (!context) return null;
	context.imageSmoothingQuality = "high";
	const grab = (time: number) => {
		context.drawImage(scrubber.drawAt(time), 0, 0, GIF_SIZE, GIF_HEIGHT);
		return context.getImageData(0, 0, GIF_SIZE, GIF_HEIGHT).data;
	};
	// one palette quantized across every settled panel, with the last slot reserved for diff transparency
	const samples: Uint8ClampedArray[] = [];
	for (let i = 0; i < scrubber.panels; i++)
		samples.push(grab(i * (HOLD_SECONDS - XFADE_SECONDS) + 1));
	const frameBytes = samples[0]?.length ?? 0;
	const sheet = new Uint8ClampedArray(samples.length * frameBytes);
	for (let i = 0; i < samples.length; i++)
		sheet.set(samples[i] ?? [], i * frameBytes);
	const colors = quantize(sheet, TRANSPARENT);
	const palette = [...colors, [0, 0, 0]];
	const gif = GIFEncoder();
	const total = Math.ceil((scrubber.duration * 1000) / GIF_DELAY_MS);
	let previous: Uint8Array | null = null;
	let pending: { indexed: Uint8Array; delay: number } | null = null;
	let started = false;
	const flush = () => {
		if (!pending) return;
		gif.writeFrame(pending.indexed, GIF_SIZE, GIF_HEIGHT, {
			delay: pending.delay,
			dispose: 1,
			...(started
				? { transparent: true, transparentIndex: TRANSPARENT }
				: { palette, repeat: 0 }),
		});
		started = true;
		pending = null;
	};
	for (let i = 0; i < total; i++) {
		const indexed = applyPalette(grab((i * GIF_DELAY_MS) / 1000), colors);
		if (pending && previous && framesEqual(indexed, previous)) {
			pending.delay += GIF_DELAY_MS;
		} else {
			flush();
			pending = {
				indexed: previous ? diffFrame(indexed, previous) : indexed,
				delay: GIF_DELAY_MS,
			};
			previous = indexed;
		}
		onProgress?.(i / total);
		if (i % 5 === 4) await settle();
	}
	flush();
	gif.finish();
	return new Blob([gif.bytes()], { type: "image/gif" });
}
