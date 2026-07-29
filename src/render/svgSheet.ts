// Lays the composed panels onto one SVG sheet, mirroring the studio's PNG export geometry.

import {
	type AvatarData,
	AvatarRegistry,
	type PoseData,
} from "../engine/avatar.js";
import type { ComposeResult } from "../studio/compose.js";
import { CanvasPanelRenderer } from "./panelRenderer.js";
import { drawStripMark, stripMarkGrowth } from "./stripMark.js";
import { type SvgImage, SvgRenderContext } from "./svgContext.js";

const CARD_PIXELS = 600;
const EXPORT_GAP = 31;

export interface SvgSheetAssets {
	atlas(url: string): SvgImage;
	backdrop(name: string): SvgImage | undefined;
}

export interface SvgSheetOptions {
	avatars: readonly AvatarData[];
	columns: number;
	host: string;
	assets: SvgSheetAssets;
	// a <style> block of @font-face rules baked into the sheet's defs
	fontDefs?: string;
}

export function renderSheetSvg(
	result: ComposeResult,
	options: SvgSheetOptions,
): string {
	const panels = result.panels.map((composed) => composed.panel);
	const unit = result.unit;
	const columns = Math.max(1, Math.min(options.columns, panels.length));
	const rows = Math.max(1, Math.ceil(panels.length / options.columns));
	const width = EXPORT_GAP + columns * (CARD_PIXELS + EXPORT_GAP);
	const height =
		EXPORT_GAP +
		rows * (CARD_PIXELS + EXPORT_GAP) +
		stripMarkGrowth(width, EXPORT_GAP);
	const context = new SvgRenderContext();
	context.fillStyle = "#fff";
	context.fillRect(0, 0, width, height);
	const cast = new AvatarRegistry(options.avatars).avatars;
	const atlases = {
		get(pose: PoseData): SvgImage {
			if (!pose.sprite)
				throw new Error(`pose ${pose.poseID} has no atlas mapping`);
			return options.assets.atlas(pose.sprite.atlasUrl);
		},
	};
	const renderer = new CanvasPanelRenderer(context, atlases, cast, {
		unitWidth: unit,
		unitHeight: unit,
		resolveBackdrop: (name) => options.assets.backdrop(name),
	});
	const scale = CARD_PIXELS / unit;
	panels.forEach((panel, index) => {
		context.save();
		context.setTransform(
			scale,
			0,
			0,
			scale,
			EXPORT_GAP + (index % options.columns) * (CARD_PIXELS + EXPORT_GAP),
			EXPORT_GAP +
				Math.floor(index / options.columns) * (CARD_PIXELS + EXPORT_GAP),
		);
		// a card canvas clips its own overflow; sharing one sheet, each panel has to clip itself
		context.beginPath();
		context.rect(0, 0, unit, unit);
		context.clip();
		renderer.render(panel);
		context.restore();
	});
	// on one row the credit starts under the first bordered panel, not the white title card
	const titled = rows === 1 && panels.length > 1 && panels[0]?.title;
	drawStripMark(
		context,
		width,
		height,
		EXPORT_GAP,
		options.host,
		titled ? EXPORT_GAP + CARD_PIXELS + EXPORT_GAP : EXPORT_GAP,
	);
	return context.svg(width, height, options.fontDefs ?? "");
}
