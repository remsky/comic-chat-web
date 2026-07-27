// Draws composed panels into the strip pane and exports the sheet as one PNG.

import type { AvatarAtlasCache } from "../browser/avatarAssets.js";
import type { BackdropCache } from "../browser/backdropAssets.js";
import { CanvasPanelRenderer } from "../browser/canvasRenderer.js";
import { CanvasSurface } from "../browser/canvasSurface.js";
import { revealWithin } from "../browser/dom.js";
import { syncPanelAccessibility } from "../browser/panelAccessibility.js";
import { drawStripMark, stripMarkGrowth } from "../browser/stripMark.js";
import {
	type Avatar,
	type AvatarData,
	AvatarRegistry,
} from "../engine/avatar.js";
import type { UnitPanel } from "../engine/panel.js";
import type { ComposeResult } from "./compose.js";
import { attachReorder } from "./reorder.js";
import { COLUMNS_DEFAULT } from "./script.js";

const CARD_PIXELS = 600;
const EXPORT_GAP = 31;

interface PreviewCard {
	figure: HTMLElement;
	canvas: HTMLCanvasElement;
	transcript: HTMLOListElement;
	surface?: CanvasSurface;
	unit?: number;
	panel?: UnitPanel;
}

export interface StripPreviewOptions {
	container: HTMLElement;
	// the pane that scrolls, so revealing a panel never moves the page itself
	scroller: HTMLElement;
	atlases: AvatarAtlasCache;
	backdrops: BackdropCache;
	avatars: readonly AvatarData[];
}

export class StripPreview {
	private readonly cards: PreviewCard[] = [];
	private readonly cast: readonly Avatar[];
	private readonly addTile: HTMLButtonElement;
	private selected = -1;
	// the preview grid reads the same count, so a row breaks where the sheet breaks
	columns = COLUMNS_DEFAULT;
	onSelect?: (index: number) => void;
	onAdd?: () => void;
	onReorder?: (from: number, to: number) => void;

	constructor(private readonly options: StripPreviewOptions) {
		this.cast = new AvatarRegistry(options.avatars).avatars;
		this.addTile = document.createElement("button");
		this.addTile.type = "button";
		this.addTile.className = "spanel-add";
		this.addTile.textContent = "+";
		this.addTile.title = "Add a panel";
		this.addTile.setAttribute("aria-label", "Add a panel");
		this.addTile.addEventListener("click", () => this.onAdd?.());
		options.container.append(this.addTile);
		attachReorder({
			container: options.container,
			itemFor: (target) => target.closest<HTMLElement>(".spanel"),
			onMove: (from, to) => this.onReorder?.(from, to),
		});
	}

	private makeCard(index: number): PreviewCard {
		const figure = document.createElement("figure");
		figure.className = "spanel";
		figure.dataset.index = String(index);
		figure.tabIndex = 0;
		figure.addEventListener("click", () => this.onSelect?.(index));
		figure.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				this.onSelect?.(index);
			}
		});
		const number = document.createElement("span");
		number.className = "spanel-index";
		number.textContent = String(index + 1);
		const canvas = document.createElement("canvas");
		canvas.width = CARD_PIXELS;
		canvas.height = CARD_PIXELS;
		const transcript = document.createElement("ol");
		transcript.className = "sr-only";
		figure.append(number, canvas, transcript);
		this.options.container.append(figure);
		return { figure, canvas, transcript };
	}

	render(result: ComposeResult): void {
		for (let i = this.cards.length; i < result.panels.length; i++)
			this.cards.push(this.makeCard(i));
		for (let i = result.panels.length; i < this.cards.length; i++) {
			const extra = this.cards[i];
			extra?.surface?.dispose();
			extra?.figure.remove();
		}
		this.cards.length = result.panels.length;
		this.options.container.append(this.addTile);

		result.panels.forEach((composed, index) => {
			const card = this.cards[index];
			if (!card) return;
			syncPanelAccessibility(
				card.canvas,
				card.transcript,
				composed.panel,
				this.options.avatars,
			);
			card.panel = composed.panel;
			// the surface only has to be rebuilt when the panel unit changes; a redraw covers every edit
			if (card.surface && card.unit === result.unit) card.surface.invalidate();
			else this.attachSurface(card, result.unit);
			card.figure.classList.toggle(
				"spanel--flagged",
				composed.issues.some((issue) => issue.severity === "error"),
			);
		});
		this.select(this.selected);
	}

	private attachSurface(card: PreviewCard, unit: number): void {
		card.surface?.dispose();
		card.unit = unit;
		let renderer: CanvasPanelRenderer | undefined;
		card.surface = new CanvasSurface(card.canvas, unit, unit, (context) => {
			renderer ??= new CanvasPanelRenderer(
				context,
				this.options.atlases,
				this.cast,
				{
					unitWidth: unit,
					unitHeight: unit,
					resolveBackdrop: (name) => this.options.backdrops.get(name),
				},
			);
			if (card.panel) renderer.render(card.panel);
		});
	}

	select(index: number): void {
		this.selected = index;
		this.cards.forEach((card, i) => {
			card.figure.classList.toggle("spanel--selected", i === index);
		});
	}

	scrollTo(index: number): void {
		const card = this.cards[index];
		if (card) revealWithin(this.options.scroller, card.figure);
	}

	// redrawn at a fixed size rather than copied off the cards, so the sheet ignores the preview zoom
	async exportPng(options?: { square?: boolean }): Promise<Blob | null> {
		const panels = this.cards.filter((card) => card.panel && card.unit);
		const unit = panels[0]?.unit;
		if (unit === undefined) return null;
		const columns = Math.min(this.columns, panels.length);
		const rows = Math.ceil(panels.length / this.columns);
		const sheet = document.createElement("canvas");
		sheet.width = EXPORT_GAP + columns * (CARD_PIXELS + EXPORT_GAP);
		sheet.height =
			EXPORT_GAP +
			rows * (CARD_PIXELS + EXPORT_GAP) +
			stripMarkGrowth(sheet.width, EXPORT_GAP);
		const context = sheet.getContext("2d");
		if (!context) return null;
		context.fillStyle = "#fff";
		context.fillRect(0, 0, sheet.width, sheet.height);
		const renderer = new CanvasPanelRenderer(
			context,
			this.options.atlases,
			this.cast,
			{
				unitWidth: unit,
				unitHeight: unit,
				resolveBackdrop: (name) => this.options.backdrops.get(name),
			},
		);
		const scale = CARD_PIXELS / unit;
		panels.forEach((card, index) => {
			if (!card.panel) return;
			context.save();
			context.setTransform(
				scale,
				0,
				0,
				scale,
				EXPORT_GAP + (index % this.columns) * (CARD_PIXELS + EXPORT_GAP),
				EXPORT_GAP +
					Math.floor(index / this.columns) * (CARD_PIXELS + EXPORT_GAP),
			);
			// a card canvas clips its own overflow; sharing one sheet, each panel has to clip itself
			context.beginPath();
			context.rect(0, 0, unit, unit);
			context.clip();
			renderer.render(card.panel);
			context.restore();
		});
		// on one row the credit starts under the first bordered panel, not the white title card
		const titled = rows === 1 && panels.length > 1 && panels[0]?.panel?.title;
		drawStripMark(
			context,
			sheet.width,
			sheet.height,
			EXPORT_GAP,
			undefined,
			titled ? EXPORT_GAP + CARD_PIXELS + EXPORT_GAP : EXPORT_GAP,
		);
		const out = options?.square ? squarePad(sheet) : sheet;
		return new Promise((resolve) => out.toBlob(resolve, "image/png"));
	}
}

// white square canvas with the sheet centered, for feed-friendly mobile shares
function squarePad(sheet: HTMLCanvasElement): HTMLCanvasElement {
	const side = Math.max(sheet.width, sheet.height);
	const square = document.createElement("canvas");
	square.width = side;
	square.height = side;
	const context = square.getContext("2d");
	if (!context) return sheet;
	context.fillStyle = "#fff";
	context.fillRect(0, 0, side, side);
	context.drawImage(
		sheet,
		Math.floor((side - sheet.width) / 2),
		Math.floor((side - sheet.height) / 2),
	);
	return square;
}
