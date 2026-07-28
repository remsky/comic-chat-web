// Where the runtime roster's art comes from, shared by the generator and the guard test.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// v1.0 art first for the classic cast, then the old-magic v2.1b additions and art pack 1
export const SOURCE_DIRS = [
	"../../../comic-chat/v1.0-pre-modern/comicart/avatars/",
	"../../../comic-chat/v2.1b/cchat/comicart/",
	"../../../comic-chat/v2.1b/cchat/artpack1/",
].map((dir) => fileURLToPath(new URL(dir, import.meta.url)));

function dirsFor(override?: string): string[] {
	return override ? [resolve(override)] : SOURCE_DIRS;
}

export function readCastAvb(name: string, override?: string): Uint8Array {
	const dirs = dirsFor(override);
	for (const dir of dirs) {
		const path = join(dir, `${name}.avb`);
		if (existsSync(path)) return new Uint8Array(readFileSync(path));
	}
	throw new Error(`${name}.avb not found under ${dirs.join(", ")}`);
}

// the sibling trace-harness checkout is absent on CI, so suites needing source art skip
export function castArtAvailable(override?: string): boolean {
	return dirsFor(override).some((dir) => existsSync(join(dir, "dan.avb")));
}
