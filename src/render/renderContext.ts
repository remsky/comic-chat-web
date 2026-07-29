// The slice of Canvas 2D the panel painters touch, so an SVG recorder can stand in for a real context.

import type { PoseData } from "../engine/avatar.js";

// opaque to the renderer: a decoded bitmap in the browser, an href record in the SVG recorder
export type RenderImage = object;

export interface AtlasSource {
	get(pose: PoseData): RenderImage;
}

export interface PanelRenderMetrics {
	width: number;
	fontBoundingBoxAscent?: number;
	fontBoundingBoxDescent?: number;
	actualBoundingBoxDescent?: number;
}

export interface PanelRenderContext {
	fillStyle: string | object;
	strokeStyle: string | object;
	lineWidth: number;
	lineJoin: string;
	lineCap: string;
	font: string;
	textAlign: string;
	textBaseline: string;
	imageSmoothingEnabled: boolean;
	imageSmoothingQuality: string;
	save(): void;
	restore(): void;
	translate(x: number, y: number): void;
	scale(x: number, y: number): void;
	setTransform(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): void;
	beginPath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	bezierCurveTo(
		cp1x: number,
		cp1y: number,
		cp2x: number,
		cp2y: number,
		x: number,
		y: number,
	): void;
	ellipse(
		x: number,
		y: number,
		radiusX: number,
		radiusY: number,
		rotation: number,
		startAngle: number,
		endAngle: number,
	): void;
	rect(x: number, y: number, w: number, h: number): void;
	closePath(): void;
	clip(): void;
	fill(): void;
	stroke(): void;
	setLineDash(segments: number[]): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	strokeRect(x: number, y: number, w: number, h: number): void;
	fillText(text: string, x: number, y: number): void;
	measureText(text: string): PanelRenderMetrics;
	drawImage(
		image: RenderImage,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void;
	drawImage(
		image: RenderImage,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void;
}
