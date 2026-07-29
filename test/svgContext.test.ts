import { describe, expect, it } from "vitest";
import { SvgRenderContext } from "../src/render/svgContext.js";

function body(context: SvgRenderContext): string {
	return context
		.svg(100, 100)
		.replace(/^<svg[^>]*>(<defs>.*<\/defs>)?/, "")
		.replace(/<\/svg>$/, "");
}

describe("SvgRenderContext", () => {
	it("bakes translate and scale into path coordinates", () => {
		const context = new SvgRenderContext();
		context.translate(10, 20);
		context.scale(2, 2);
		context.beginPath();
		context.moveTo(5, 5);
		context.lineTo(10, 5);
		context.fill();
		expect(body(context)).toBe('<path d="M20 30L30 30" fill="#000"/>');
	});

	it("emits separate elements for fill then stroke of one path", () => {
		const context = new SvgRenderContext();
		context.beginPath();
		context.moveTo(0, 0);
		context.lineTo(10, 0);
		context.closePath();
		context.fillStyle = "#fff";
		context.strokeStyle = "#000";
		context.lineWidth = 2;
		context.fill();
		context.stroke();
		expect(body(context)).toBe(
			'<path d="M0 0L10 0Z" fill="#fff"/><path d="M0 0L10 0Z" fill="none" stroke="#000" stroke-width="2"/>',
		);
	});

	it("scales stroke width and dashes with the current transform", () => {
		const context = new SvgRenderContext();
		context.scale(0.5, 0.5);
		context.beginPath();
		context.moveTo(0, 0);
		context.lineTo(10, 0);
		context.lineWidth = 28;
		context.setLineDash([100, 100]);
		context.stroke();
		expect(body(context)).toContain('stroke-width="14"');
		expect(body(context)).toContain('stroke-dasharray="50 50"');
	});

	it("wraps drawing after clip in a group and closes it on restore", () => {
		const context = new SvgRenderContext();
		context.save();
		context.beginPath();
		context.rect(0, 0, 50, 50);
		context.clip();
		context.fillRect(1, 2, 3, 4);
		context.restore();
		context.fillRect(5, 6, 7, 8);
		const svg = context.svg(100, 100);
		expect(svg).toContain(
			'<defs><clipPath id="clip0"><rect x="0" y="0" width="50" height="50"/></clipPath></defs>',
		);
		expect(svg).toContain(
			'<g clip-path="url(#clip0)"><rect x="1" y="2" width="3" height="4" fill="#000"/></g><rect x="5" y="6" width="7" height="8" fill="#000"/>',
		);
	});

	it("restores styles saved before a change", () => {
		const context = new SvgRenderContext();
		context.fillStyle = "#abc";
		context.save();
		context.fillStyle = "#def";
		context.restore();
		context.fillRect(0, 0, 1, 1);
		expect(body(context)).toContain('fill="#abc"');
	});

	it("mirrors a sprite through a negative-scale group transform", () => {
		const context = new SvgRenderContext();
		context.save();
		context.translate(100, 0);
		context.scale(-1, 1);
		context.drawImage(
			{ href: "data:x", width: 64, height: 64 },
			8,
			8,
			16,
			16,
			10,
			20,
			32,
			32,
		);
		context.restore();
		const svg = context.svg(100, 100);
		expect(svg).toContain('transform="matrix(-1 0 0 1 100 0)"');
		expect(svg).toContain(
			'<clipPath id="clip0"><rect x="10" y="20" width="32" height="32"/></clipPath>',
		);
		// source offset 8,8 at 2x lands the atlas origin 16 before the destination corner
		expect(svg).toContain(
			'<image href="data:x" x="-6" y="4" width="128" height="128" preserveAspectRatio="none"/>',
		);
	});

	it("draws a full-panel backdrop as one unclipped image", () => {
		const context = new SvgRenderContext();
		context.drawImage({ href: "data:bg", width: 10, height: 10 }, 0, 0, 80, 80);
		expect(body(context)).toBe(
			'<g><image href="data:bg" x="0" y="0" width="80" height="80" preserveAspectRatio="none"/></g>',
		);
	});

	it("anchors and shifts text by align and baseline", () => {
		const context = new SvgRenderContext();
		context.font = "400 100px 'Comic Neue'";
		context.textBaseline = "top";
		context.textAlign = "center";
		context.fillText("A & B", 50, 10);
		const svg = body(context);
		expect(svg).toContain('text-anchor="middle"');
		expect(svg).toContain(">A &amp; B</text>");
		// ascent 900/1000 at 100px puts the baseline 90 under the top anchor
		expect(svg).toContain('y="100"');
	});

	it("refuses transforms it cannot represent", () => {
		const context = new SvgRenderContext();
		expect(() => context.setTransform(1, 0.5, 0, 1, 0, 0)).toThrow(/rotation/);
	});
});
