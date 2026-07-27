#!/usr/bin/env node
// Renders a strip script to an animated mp4/gif: headless studio capture, then ffmpeg interpolation.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
	console.error("usage: node scripts/animate.mjs <strip.json> [--out dir]");
	process.exit(1);
}
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const OUT = resolve(flag("out", "scripts/out"));
const HOLD = Number(flag("hold", "3"));
const FPS = Number(flag("fps", "30"));
const XFADE = 0.4;
const PORT = 5199;

const strip = JSON.parse(readFileSync(file, "utf8"));
// balloons off, bodies identical: balloon layout runs after body placement
const silent = structuredClone(strip);
for (const panel of silent.panels)
	for (const actor of panel.actors) {
		delete actor.text;
		delete actor.mode;
	}

const link = (doc) =>
	`http://127.0.0.1:${PORT}/studio.html?s=${deflateRawSync(
		Buffer.from(JSON.stringify(doc)),
		{ level: 9 },
	).toString("base64url")}`;

mkdirSync(OUT, { recursive: true });

const server = spawn(
	"npx",
	["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
	{ cwd: process.cwd(), shell: true, stdio: "ignore" },
);
const stopServer = () => {
	if (process.platform === "win32" && server.pid)
		spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
			stdio: "ignore",
		});
	else server.kill();
};
process.on("exit", stopServer);

async function waitForServer() {
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/studio.html`);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("vite dev server did not come up");
}

async function capture(page, doc, prefix) {
	await page.goto(link(doc), { waitUntil: "domcontentloaded" });
	await page.waitForSelector('body[data-studio-ready="true"]', {
		timeout: 30_000,
	});
	// card CSS 300px at dpr 2 gives the native 600px backing store
	await page.evaluate(() => {
		const slider = document.getElementById("studio-cardsize");
		slider.value = "300";
		slider.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await page.waitForFunction(
		() => document.querySelector("#studio-panels figure canvas")?.width >= 590,
	);
	const urls = await page.$$eval("#studio-panels figure canvas", (els) =>
		els.map((c) => c.toDataURL("image/png")),
	);
	urls.forEach((url, i) => {
		const name = join(OUT, `${prefix}_${String(i).padStart(2, "0")}.png`);
		writeFileSync(name, Buffer.from(url.split(",")[1], "base64"));
	});
	return urls.length;
}

function ffmpeg(fargs, label) {
	const run = spawnSync("ffmpeg", ["-hide_banner", "-y", ...fargs], {
		encoding: "utf8",
	});
	if (run.status !== 0) {
		console.error(run.stderr);
		throw new Error(`ffmpeg failed: ${label}`);
	}
}

// one panel: silent base, balloons fade in at 0.6s, slow pan the whole hold
function segment(i) {
	const base = join(OUT, `base_${String(i).padStart(2, "0")}.png`);
	const full = join(OUT, `full_${String(i).padStart(2, "0")}.png`);
	const out = join(OUT, `seg_${String(i).padStart(2, "0")}.mp4`);
	ffmpeg(
		[
			"-framerate",
			String(FPS),
			"-loop",
			"1",
			"-t",
			String(HOLD),
			"-i",
			base,
			"-framerate",
			String(FPS),
			"-loop",
			"1",
			"-t",
			String(HOLD),
			"-i",
			full,
			"-filter_complex",
			`[1:v]format=rgba,fade=in:st=0.6:d=0.35:alpha=1[balloons];` +
				`[0:v][balloons]overlay,scale=600:600,format=yuv420p,fps=${FPS}`,
			out,
		],
		`segment ${i}`,
	);
	return out;
}

await waitForServer();
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 1700, height: 1200 },
	deviceScaleFactor: 2,
});
const count = await capture(page, strip, "full");
const silentCount = await capture(page, silent, "base");
await browser.close();
stopServer();
if (count !== silentCount || count === 0)
	throw new Error(`capture mismatch: ${count} full, ${silentCount} base`);
console.log(`captured ${count} panel(s) at 600x600`);

const segments = [];
for (let i = 0; i < count; i++) segments.push(segment(i));

const movie = join(OUT, "strip.mp4");
if (count === 1) {
	ffmpeg(["-i", segments[0], "-c", "copy", movie], "single segment");
} else {
	const inputs = segments.flatMap((s) => ["-i", s]);
	let chain = "";
	let tag = "[0:v]";
	for (let i = 1; i < count; i++) {
		const next = i === count - 1 ? "[v]" : `[x${i}]`;
		chain += `${tag}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${(i * (HOLD - XFADE)).toFixed(2)}${next};`;
		tag = next;
	}
	ffmpeg(
		[...inputs, "-filter_complex", chain.slice(0, -1), "-map", "[v]", movie],
		"xfade concat",
	);
}

const gif = join(OUT, "strip.gif");
ffmpeg(
	[
		"-i",
		movie,
		"-vf",
		"fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
		gif,
	],
	"gif",
);

console.log(movie);
console.log(gif);
