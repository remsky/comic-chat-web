#!/usr/bin/env node
// Generates cast.png and backgrounds.png contact sheets for the agent skill reference.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(
	root,
	"plugins/comic-strip/skills/comic-strip/reference/catalog.json",
);
const THUMBS_DIR = join(
	root,
	"plugins/comic-strip/skills/comic-strip/reference/thumbs",
);
const BG_SOURCE = join(root, "public/assets/backgrounds");

const BASE = process.argv.includes("--base")
	? process.argv[process.argv.indexOf("--base") + 1]
	: "https://comics.remsky.art";

const ATTRIBUTION =
	"Art by Jim Woodring. Copyright (c) Microsoft Corporation. MIT License.";

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
const sharp = (await import("sharp")).default;

function packStrip(strip) {
	const json = Buffer.from(JSON.stringify(strip));
	return deflateRawSync(json, { level: 9 }).toString("base64url");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, retries = 3) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		const response = await fetch(url);
		if (response.status === 429) {
			await delay((attempt + 1) * 2000);
			continue;
		}
		if (!response.ok)
			throw new Error(`${response.status} ${response.statusText}`);
		return Buffer.from(await response.arrayBuffer());
	}
	throw new Error("429 after retries");
}

function textSvg(
	text,
	width,
	height,
	{ size = 13, weight = "bold", fill = "#222", anchor = "middle" } = {},
) {
	const x = anchor === "start" ? 4 : width / 2;
	return Buffer.from(
		`<svg width="${width}" height="${height}"><text x="${x}" y="${height - 3}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${text}</text></svg>`,
	);
}

function gridLineSvg(width, height, vertical) {
	if (vertical) {
		return Buffer.from(
			`<svg width="1" height="${height}"><line x1="0" y1="0" x2="0" y2="${height}" stroke="#888" stroke-width="1"/></svg>`,
		);
	}
	return Buffer.from(
		`<svg width="${width}" height="1"><line x1="0" y1="0" x2="${width}" y2="0" stroke="#888" stroke-width="1"/></svg>`,
	);
}

mkdirSync(THUMBS_DIR, { recursive: true });

// render and crop each character

const CELL_H = 150;
const LABEL_H = 50;
const FOOTER_H = 18;
const COLS = 7;
const CELL_W = 100;
const ROW_H = 200;

const cropped = [];

for (const avatar of catalog.avatars) {
	const strip = {
		version: 2,
		columns: 1,
		panels: [
			{
				camera: "wide",
				border: false,
				actors: [{ avatar: avatar.name }],
			},
		],
	};
	const url = `${BASE}/studio/strip.svg?s=${packStrip(strip)}`;

	try {
		const svgBuffer = await fetchWithRetry(url);
		const panel = await sharp(svgBuffer, { density: 72 })
			.extract({ left: 31, top: 31, width: 600, height: 600 })
			.toBuffer();

		const trimmed = await sharp(panel)
			.trim({ background: "#ffffff", threshold: 10 })
			.toBuffer();

		const meta = await sharp(trimmed).metadata();
		const scale = CELL_H / meta.height;
		const scaledW = Math.round(meta.width * scale);
		const resized = await sharp(trimmed)
			.resize({ height: CELL_H, width: scaledW, fit: "fill" })
			.toBuffer();

		cropped.push({ name: avatar.name, buffer: resized, width: scaledW });
		process.stdout.write(`  ${avatar.name}`);
	} catch (error) {
		console.error(`\n  FAIL ${avatar.name}: ${error.message}`);
	}

	await delay(200);
}
console.log();

// cast contact sheet

const rows = Math.ceil(cropped.length / COLS);
const sheetW = COLS * CELL_W;
const sheetH = rows * ROW_H + FOOTER_H;

const composites = [];

// grid lines at each cell boundary
for (let col = 0; col <= COLS; col++) {
	const x = col * CELL_W;
	if (x > 0 && x < sheetW) {
		composites.push({
			input: gridLineSvg(1, rows * ROW_H, true),
			left: x,
			top: 0,
		});
	}
}
for (let row = 0; row <= rows; row++) {
	const y = row * ROW_H;
	if (y > 0 && y < sheetH - FOOTER_H) {
		composites.push({
			input: gridLineSvg(sheetW, 1, false),
			left: 0,
			top: y,
		});
	}
}

// pixel coordinate labels along top and left edges
for (let col = 0; col <= COLS; col++) {
	const px = col * CELL_W;
	composites.push({
		input: textSvg(String(px), 40, 12, {
			size: 10,
			weight: "normal",
			fill: "#555",
			anchor: "start",
		}),
		left: Math.min(px, sheetW - 40),
		top: 0,
	});
}
for (let row = 0; row <= rows; row++) {
	const py = row * ROW_H;
	if (py < sheetH - FOOTER_H) {
		composites.push({
			input: textSvg(String(py), 30, 12, {
				size: 10,
				weight: "normal",
				fill: "#555",
				anchor: "start",
			}),
			left: 0,
			top: py,
		});
	}
}

// character cells
for (let i = 0; i < cropped.length; i++) {
	const col = i % COLS;
	const row = Math.floor(i / COLS);
	const cellX = col * CELL_W;
	const cellY = row * ROW_H;
	const xCenter = cellX + Math.round((CELL_W - cropped[i].width) / 2);

	composites.push({
		input: textSvg(cropped[i].name, CELL_W, LABEL_H, { size: 14 }),
		left: cellX,
		top: cellY,
	});
	composites.push({
		input: cropped[i].buffer,
		left: xCenter,
		top: cellY + LABEL_H,
	});
}

// attribution footer
composites.push({
	input: textSvg(ATTRIBUTION, sheetW, FOOTER_H, {
		size: 9,
		weight: "normal",
		fill: "#888",
	}),
	left: 0,
	top: sheetH - FOOTER_H,
});

const castSheet = join(THUMBS_DIR, "cast.png");
await sharp({
	create: {
		width: sheetW,
		height: sheetH,
		channels: 4,
		background: { r: 255, g: 255, b: 255, alpha: 1 },
	},
})
	.composite(composites)
	.png()
	.toFile(castSheet);

console.log(
	`cast: ${cropped.length} characters, ${rows}x${COLS} grid -> ${castSheet}`,
);

// background contact sheet

const BG_THUMB = 150;
const BG_COLS = 4;
const bgItems = [];

for (const name of catalog.backgrounds) {
	const src = join(BG_SOURCE, `${name}.png`);
	try {
		const resized = await sharp(src)
			.resize({ width: BG_THUMB, height: BG_THUMB, fit: "cover" })
			.toBuffer();
		bgItems.push({ name, buffer: resized });
	} catch (error) {
		console.error(`  FAIL bg ${name}: ${error.message}`);
	}
}

const bgRows = Math.ceil(bgItems.length / BG_COLS);
const bgRowH = 200;
const bgSheetW = BG_COLS * BG_THUMB;
const bgSheetH = bgRows * bgRowH + FOOTER_H;

const bgComposites = [];

// grid lines
for (let col = 1; col < BG_COLS; col++) {
	bgComposites.push({
		input: gridLineSvg(1, bgRows * bgRowH, true),
		left: col * BG_THUMB,
		top: 0,
	});
}
for (let row = 1; row < bgRows; row++) {
	bgComposites.push({
		input: gridLineSvg(bgSheetW, 1, false),
		left: 0,
		top: row * bgRowH,
	});
}

// pixel labels
for (let col = 0; col <= BG_COLS; col++) {
	const px = col * BG_THUMB;
	bgComposites.push({
		input: textSvg(String(px), 30, 12, {
			size: 10,
			weight: "normal",
			fill: "#555",
			anchor: "start",
		}),
		left: Math.min(px, bgSheetW - 30),
		top: 0,
	});
}
for (let row = 0; row <= bgRows; row++) {
	const py = row * bgRowH;
	if (py < bgSheetH - FOOTER_H) {
		bgComposites.push({
			input: textSvg(String(py), 30, 12, {
				size: 10,
				weight: "normal",
				fill: "#555",
				anchor: "start",
			}),
			left: 0,
			top: py,
		});
	}
}

// background cells
for (let i = 0; i < bgItems.length; i++) {
	const col = i % BG_COLS;
	const row = Math.floor(i / BG_COLS);
	const x = col * BG_THUMB;
	const y = row * bgRowH;

	bgComposites.push({
		input: textSvg(bgItems[i].name, BG_THUMB, LABEL_H),
		left: x,
		top: y,
	});
	bgComposites.push({ input: bgItems[i].buffer, left: x, top: y + LABEL_H });
}

// attribution footer
bgComposites.push({
	input: textSvg(ATTRIBUTION, bgSheetW, FOOTER_H, {
		size: 9,
		weight: "normal",
		fill: "#888",
	}),
	left: 0,
	top: bgSheetH - FOOTER_H,
});

const bgSheet = join(THUMBS_DIR, "backgrounds.png");
await sharp({
	create: {
		width: bgSheetW,
		height: bgSheetH,
		channels: 4,
		background: { r: 255, g: 255, b: 255, alpha: 1 },
	},
})
	.composite(bgComposites)
	.png()
	.toFile(bgSheet);

console.log(
	`backgrounds: ${bgItems.length} scenes, ${bgRows}x${BG_COLS} grid -> ${bgSheet}`,
);
