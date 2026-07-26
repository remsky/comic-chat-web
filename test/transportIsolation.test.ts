import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../src/transports", import.meta.url));

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
	);
}

describe("transport isolation", () => {
	// transports depend on the protocol contract and each other, never on UI or Worker code
	it("imports only protocol modules and transport siblings", () => {
		const files = walk(ROOT).filter((file) => file.endsWith(".ts"));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/from "([^"]+)"/g)) {
				const specifier = match[1] ?? "";
				const allowed =
					specifier.startsWith("./") ||
					specifier.includes("/protocol/") ||
					specifier === "../types.js";
				expect(allowed, `${file} imports ${specifier}`).toBe(true);
			}
		}
	});
});
