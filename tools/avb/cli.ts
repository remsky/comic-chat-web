// Node CLI: convert one .avb into PNG sprites plus a metadata JSON file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { convert } from "./convert.ts";

function main(argv: string[]): void {
	const args = argv.slice(2);
	if (args.length < 2) {
		process.stderr.write("usage: avb-cli <input.avb> <outputDir>\n");
		process.exit(2);
		return;
	}
	const [input, outDir] = args as [string, string];
	const baseName = basename(input).replace(/\.avb$/i, "");
	const buf = new Uint8Array(readFileSync(input));

	const result = convert(buf, baseName);
	mkdirSync(outDir, { recursive: true });

	for (const png of result.pngs) {
		writeFileSync(join(outDir, png.file), png.bytes);
	}
	const jsonFile = `${baseName}.json`;
	writeFileSync(
		join(outDir, jsonFile),
		JSON.stringify(result.metadata, null, 2),
	);

	const p = result.parsed;
	process.stdout.write(
		`${baseName}: ${p.typeName} v${p.version}, poses=${p.poses.length}, ` +
			`faces=${p.faces.length}, torsos=${p.torsos.length}, bodies=${p.bodies.length}, ` +
			`pngs=${result.pngs.length}, consumed=${p.bytesConsumed}/${buf.length}\n`,
	);
}

main(process.argv);
