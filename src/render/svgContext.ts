// Records the panel painters' canvas calls as SVG elements; transforms here are always scale plus translate, never rotation.

import { COMIC_NEUE_REGULAR } from "./comicNeueMetrics.js";
import type {
	PanelRenderContext,
	PanelRenderMetrics,
} from "./renderContext.js";
import { parseFontPx, TableMeasureContext } from "./textTable.js";

export interface SvgImage {
	href: string;
	width: number;
	height: number;
}

interface Matrix {
	sx: number;
	sy: number;
	tx: number;
	ty: number;
}

interface DrawState {
	fillStyle: string;
	strokeStyle: string;
	lineWidth: number;
	lineJoin: string;
	lineCap: string;
	font: string;
	textAlign: string;
	textBaseline: string;
	dash: number[];
}

interface Frame {
	matrix: Matrix;
	state: DrawState;
	openGroups: number;
}

function fmt(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

function escapeXml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

// balloon text was measured as Comic Neue, so the embedded face leads and local Comic Sans stays a fallback
function fontFamily(font: string): string {
	return font.includes("Comic")
		? "'Comic Neue', 'Comic Sans MS', cursive"
		: "'Segoe UI', system-ui, sans-serif";
}

export class SvgRenderContext implements PanelRenderContext {
	imageSmoothingEnabled = true;
	imageSmoothingQuality = "high";
	private matrix: Matrix = { sx: 1, sy: 1, tx: 0, ty: 0 };
	private state: DrawState = {
		fillStyle: "#000",
		strokeStyle: "#000",
		lineWidth: 1,
		lineJoin: "miter",
		lineCap: "butt",
		font: "10px sans-serif",
		textAlign: "left",
		textBaseline: "alphabetic",
		dash: [],
	};
	private readonly stack: Frame[] = [];
	private path: string[] = [];
	private pathRects: { x: number; y: number; w: number; h: number }[] = [];
	private pathIsRects = true;
	private openGroups = 0;
	private clipCount = 0;
	private readonly defs: string[] = [];
	private readonly body: string[] = [];
	private readonly measurer = new TableMeasureContext();

	get fillStyle(): string {
		return this.state.fillStyle;
	}
	set fillStyle(value: string | object) {
		this.state.fillStyle = String(value);
	}
	get strokeStyle(): string {
		return this.state.strokeStyle;
	}
	set strokeStyle(value: string | object) {
		this.state.strokeStyle = String(value);
	}
	get lineWidth(): number {
		return this.state.lineWidth;
	}
	set lineWidth(value: number) {
		this.state.lineWidth = value;
	}
	get lineJoin(): string {
		return this.state.lineJoin;
	}
	set lineJoin(value: string) {
		this.state.lineJoin = value;
	}
	get lineCap(): string {
		return this.state.lineCap;
	}
	set lineCap(value: string) {
		this.state.lineCap = value;
	}
	get font(): string {
		return this.state.font;
	}
	set font(value: string) {
		this.state.font = value;
	}
	get textAlign(): string {
		return this.state.textAlign;
	}
	set textAlign(value: string) {
		this.state.textAlign = value;
	}
	get textBaseline(): string {
		return this.state.textBaseline;
	}
	set textBaseline(value: string) {
		this.state.textBaseline = value;
	}

	save(): void {
		this.stack.push({
			matrix: { ...this.matrix },
			state: { ...this.state, dash: [...this.state.dash] },
			openGroups: this.openGroups,
		});
	}

	restore(): void {
		const frame = this.stack.pop();
		if (!frame) return;
		while (this.openGroups > frame.openGroups) {
			this.body.push("</g>");
			this.openGroups--;
		}
		this.matrix = frame.matrix;
		this.state = frame.state;
	}

	translate(x: number, y: number): void {
		this.matrix.tx += this.matrix.sx * x;
		this.matrix.ty += this.matrix.sy * y;
	}

	scale(x: number, y: number): void {
		this.matrix.sx *= x;
		this.matrix.sy *= y;
	}

	setTransform(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): void {
		if (b !== 0 || c !== 0)
			throw new Error("SvgRenderContext does not support rotation or skew");
		this.matrix = { sx: a, sy: d, tx: e, ty: f };
	}

	private mapX(x: number): number {
		return this.matrix.sx * x + this.matrix.tx;
	}

	private mapY(y: number): number {
		return this.matrix.sy * y + this.matrix.ty;
	}

	beginPath(): void {
		this.path = [];
		this.pathRects = [];
		this.pathIsRects = true;
	}

	moveTo(x: number, y: number): void {
		this.path.push(`M${fmt(this.mapX(x))} ${fmt(this.mapY(y))}`);
		this.pathIsRects = false;
	}

	lineTo(x: number, y: number): void {
		this.path.push(`L${fmt(this.mapX(x))} ${fmt(this.mapY(y))}`);
		this.pathIsRects = false;
	}

	bezierCurveTo(
		cp1x: number,
		cp1y: number,
		cp2x: number,
		cp2y: number,
		x: number,
		y: number,
	): void {
		this.path.push(
			`C${fmt(this.mapX(cp1x))} ${fmt(this.mapY(cp1y))} ${fmt(this.mapX(cp2x))} ${fmt(this.mapY(cp2y))} ${fmt(this.mapX(x))} ${fmt(this.mapY(y))}`,
		);
		this.pathIsRects = false;
	}

	ellipse(
		x: number,
		y: number,
		radiusX: number,
		radiusY: number,
		_rotation: number,
		_startAngle: number,
		_endAngle: number,
	): void {
		const cx = this.mapX(x);
		const cy = this.mapY(y);
		const rx = Math.abs(this.matrix.sx * radiusX);
		const ry = Math.abs(this.matrix.sy * radiusY);
		this.path.push(
			`M${fmt(cx + rx)} ${fmt(cy)}`,
			`A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}`,
			`A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}`,
			"Z",
		);
		this.pathIsRects = false;
	}

	rect(x: number, y: number, w: number, h: number): void {
		const left = this.mapX(x);
		const top = this.mapY(y);
		const width = this.matrix.sx * w;
		const height = this.matrix.sy * h;
		this.path.push(
			`M${fmt(left)} ${fmt(top)}`,
			`L${fmt(left + width)} ${fmt(top)}`,
			`L${fmt(left + width)} ${fmt(top + height)}`,
			`L${fmt(left)} ${fmt(top + height)}`,
			"Z",
		);
		this.pathRects.push({ x: left, y: top, w: width, h: height });
	}

	closePath(): void {
		this.path.push("Z");
	}

	clip(): void {
		if (!this.pathIsRects || this.pathRects.length === 0)
			throw new Error("SvgRenderContext clips rectangular paths only");
		const id = `clip${this.clipCount++}`;
		const rects = this.pathRects
			.map(
				(r) =>
					`<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}"/>`,
			)
			.join("");
		this.defs.push(`<clipPath id="${id}">${rects}</clipPath>`);
		this.body.push(`<g clip-path="url(#${id})">`);
		this.openGroups++;
	}

	private strokeAttrs(): string {
		const scale = Math.abs(this.matrix.sy);
		const parts = [
			`stroke="${this.state.strokeStyle}"`,
			`stroke-width="${fmt(this.state.lineWidth * scale)}"`,
		];
		if (this.state.lineJoin !== "miter")
			parts.push(`stroke-linejoin="${this.state.lineJoin}"`);
		if (this.state.lineCap !== "butt")
			parts.push(`stroke-linecap="${this.state.lineCap}"`);
		if (this.state.dash.length > 0)
			parts.push(
				`stroke-dasharray="${this.state.dash.map((d) => fmt(d * scale)).join(" ")}"`,
			);
		return parts.join(" ");
	}

	fill(): void {
		if (this.path.length === 0) return;
		this.body.push(
			`<path d="${this.path.join("")}" fill="${this.state.fillStyle}"/>`,
		);
	}

	stroke(): void {
		if (this.path.length === 0) return;
		this.body.push(
			`<path d="${this.path.join("")}" fill="none" ${this.strokeAttrs()}/>`,
		);
	}

	setLineDash(segments: number[]): void {
		this.state.dash = [...segments];
	}

	fillRect(x: number, y: number, w: number, h: number): void {
		this.body.push(
			`<rect x="${fmt(this.mapX(x))}" y="${fmt(this.mapY(y))}" width="${fmt(this.matrix.sx * w)}" height="${fmt(this.matrix.sy * h)}" fill="${this.state.fillStyle}"/>`,
		);
	}

	strokeRect(x: number, y: number, w: number, h: number): void {
		this.body.push(
			`<rect x="${fmt(this.mapX(x))}" y="${fmt(this.mapY(y))}" width="${fmt(this.matrix.sx * w)}" height="${fmt(this.matrix.sy * h)}" fill="none" ${this.strokeAttrs()}/>`,
		);
	}

	fillText(text: string, x: number, y: number): void {
		if (text === "") return;
		const size = parseFontPx(this.state.font) * Math.abs(this.matrix.sy);
		const { ascent, descent, unitsPerEm } = COMIC_NEUE_REGULAR;
		let baseline = this.mapY(y);
		if (this.state.textBaseline === "top")
			baseline += (ascent / unitsPerEm) * size;
		else if (this.state.textBaseline === "middle")
			baseline += ((ascent - descent) / 2 / unitsPerEm) * size;
		const anchor =
			this.state.textAlign === "center"
				? "middle"
				: this.state.textAlign === "right"
					? "end"
					: "start";
		const style = this.state.font.includes("italic")
			? ' font-style="italic"'
			: "";
		this.body.push(
			`<text x="${fmt(this.mapX(x))}" y="${fmt(baseline)}" font-family="${fontFamily(this.state.font)}" font-size="${fmt(size)}"${style} fill="${this.state.fillStyle}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`} xml:space="preserve">${escapeXml(text)}</text>`,
		);
	}

	measureText(text: string): PanelRenderMetrics {
		this.measurer.font = this.state.font;
		return this.measurer.measureText(text);
	}

	drawImage(image: SvgImage, ...rest: number[]): void {
		const { sx, sy, tx, ty } = this.matrix;
		const transform =
			sx === 1 && sy === 1 && tx === 0 && ty === 0
				? ""
				: ` transform="matrix(${fmt(sx)} 0 0 ${fmt(sy)} ${fmt(tx)} ${fmt(ty)})"`;
		if (rest.length === 4) {
			const [dx, dy, dw, dh] = rest as [number, number, number, number];
			this.body.push(
				`<g${transform}><image href="${image.href}" x="${fmt(dx)}" y="${fmt(dy)}" width="${fmt(dw)}" height="${fmt(dh)}" preserveAspectRatio="none"/></g>`,
			);
			return;
		}
		const [srcX, srcY, srcW, srcH, dx, dy, dw, dh] = rest as [
			number,
			number,
			number,
			number,
			number,
			number,
			number,
			number,
		];
		const scaleX = dw / srcW;
		const scaleY = dh / srcH;
		const id = `clip${this.clipCount++}`;
		this.defs.push(
			`<clipPath id="${id}"><rect x="${fmt(dx)}" y="${fmt(dy)}" width="${fmt(dw)}" height="${fmt(dh)}"/></clipPath>`,
		);
		this.body.push(
			`<g${transform} clip-path="url(#${id})"><image href="${image.href}" x="${fmt(dx - srcX * scaleX)}" y="${fmt(dy - srcY * scaleY)}" width="${fmt(image.width * scaleX)}" height="${fmt(image.height * scaleY)}" preserveAspectRatio="none"/></g>`,
		);
	}

	svg(width: number, height: number, extraDefs = ""): string {
		while (this.openGroups > 0) {
			this.body.push("</g>");
			this.openGroups--;
		}
		const defs = this.defs.join("") + extraDefs;
		return [
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}">`,
			defs ? `<defs>${defs}</defs>` : "",
			this.body.join(""),
			"</svg>",
		].join("");
	}
}
