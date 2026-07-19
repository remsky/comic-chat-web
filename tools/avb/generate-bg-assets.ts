// Converts the original .bgb backdrops into web PNGs plus a runtime manifest.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePose, monoRgba } from "./convert.ts";
import { parseBgb } from "./parser.ts";
import { encodePng } from "./png.ts";

interface BackdropEntry {
	name: string;
	url: string;
	width: number;
	height: number;
	copyright: string | null;
}

const inputDirs =
	process.argv.length > 2
		? process.argv.slice(2, -1)
		: [
				fileURLToPath(
					new URL("../../../comic-chat/v2.5-beta-1/comicart/", import.meta.url),
				),
				fileURLToPath(
					new URL("../../../comic-chat/v2.5-beta-1/artpack1/", import.meta.url),
				),
			];
const outputDir = resolve(
	process.argv.length > 2
		? (process.argv.at(-1) as string)
		: fileURLToPath(
				new URL("../../public/assets/backgrounds/", import.meta.url),
			),
);

const files = inputDirs
	.flatMap((dir) =>
		readdirSync(dir)
			.filter((file) => file.toLowerCase().endsWith(".bgb"))
			.map((file) => join(dir, file)),
	)
	.sort((a, b) => basename(a).localeCompare(basename(b)));

mkdirSync(outputDir, { recursive: true });
const backdrops: BackdropEntry[] = [];
for (const file of files) {
	const name = basename(file, ".bgb").toLowerCase();
	const bytes = new Uint8Array(readFileSync(file));
	const parsed = parseBgb(bytes);
	const decoded = decodePose(
		bytes,
		{
			poseID: 1,
			imageOffset: parsed.backdrop.offset,
			maskOffset: 0,
			auraOffset: 0,
			imageFormat: parsed.backdrop.format,
			maskFormat: 0,
			auraFormat: 0,
			imagePaletteType: parsed.backdrop.paletteType,
			maskPaletteType: 0,
			auraPaletteType: 0,
		},
		null,
		true,
	);
	if (!decoded.image) throw new Error(`${name}: ${decoded.imageError}`);
	const pngFile = `${name}.png`;
	// backdrops are opaque; monoRgba renders every palette pixel at full alpha
	writeFileSync(
		join(outputDir, pngFile),
		encodePng(
			decoded.image.width,
			decoded.image.height,
			monoRgba(decoded.image),
		),
	);
	backdrops.push({
		name,
		url: `/assets/backgrounds/${pngFile}`,
		width: decoded.image.width,
		height: decoded.image.height,
		copyright: parsed.copyright,
	});
}

writeFileSync(
	join(outputDir, "manifest.json"),
	`${JSON.stringify({ backdrops }, null, "\t")}\n`,
);
process.stdout.write(`${backdrops.length} backdrops -> ${outputDir}\n`);
