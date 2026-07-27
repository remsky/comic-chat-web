import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(
	process.cwd(),
	"plugins/comic-strip/skills/comic-strip/scripts/strip-link.mjs",
);
const dir = mkdtempSync(join(tmpdir(), "strip-link-"));
let counter = 0;

function run(strip: unknown, ...args: string[]) {
	const file = join(dir, `strip-${counter++}.json`);
	writeFileSync(
		file,
		typeof strip === "string" ? strip : JSON.stringify(strip),
	);
	const result = spawnSync(process.execPath, [SCRIPT, file, ...args], {
		encoding: "utf8",
	});
	return {
		status: result.status,
		out: result.stdout,
		err: result.stderr,
		url: result.stdout.trim().split("\n").at(-1) ?? "",
	};
}

// two panels keeps the craft rules out of it: checkShape only runs from three up
function strip(...panels: unknown[]) {
	return {
		version: 2,
		columns: 2,
		panels: panels.length
			? panels
			: [
					{ background: "den", actors: [{ avatar: "kevin", text: "Hi" }] },
					{ background: "den", actors: [{ avatar: "kevin", text: "Bye" }] },
				],
	};
}

const decode = (url: string): unknown =>
	JSON.parse(
		Buffer.from(
			new URL(url).searchParams.get("script") ?? "",
			"base64url",
		).toString("utf8"),
	);

describe("strip-link validation", () => {
	it("passes a clean strip and round-trips it through the studio link", () => {
		const doc = strip();
		const { status, out, url } = run(doc);
		expect(status).toBe(0);
		expect(out).toContain("ok: 2 panel(s), 1 character(s)");
		expect(
			url.startsWith("https://comics.remsky.art/studio.html?script="),
		).toBe(true);
		// the studio decodes this back into a document, so the encoding is the contract
		expect(decode(url)).toEqual(doc);
	});

	it("points the link at another deployment and drops its trailing slash", () => {
		const { url } = run(strip(), "--base", "https://fork.example/");
		expect(url.startsWith("https://fork.example/studio.html?script=")).toBe(
			true,
		);
	});

	it("refuses a character, emotion, gesture, or field the catalog does not name", () => {
		for (const [actor, wanted] of [
			[{ avatar: "nobody", text: "Hi" }, 'unknown character "nobody"'],
			[{ avatar: "kevin", emotion: "smug" }, 'unknown emotion "smug"'],
			[
				{ avatar: "kevin", gesture: "cartwheel" },
				'unknown gesture "cartwheel"',
			],
			[{ avatar: "kevin", mode: "yell" }, 'unknown mode "yell"'],
			[{ avatar: "kevin", facing: "up" }, 'unknown facing "up"'],
		] as const) {
			const { status, err } = run(
				strip({ background: "den", actors: [actor] }),
			);
			expect(err).toContain(wanted);
			expect(status).toBe(1);
		}
	});

	it("refuses an emotion index past the art the character owns", () => {
		// kevin draws three happy faces, so happy_4 has nothing behind it
		const { status, err } = run(
			strip({
				background: "den",
				actors: [{ avatar: "kevin", emotion: "happy_4" }],
			}),
		);
		expect(err).toContain('draws 3 "happy" face(s)');
		expect(status).toBe(1);
	});

	it("refuses a panel past the zoom, actor, and balloon limits", () => {
		const six = Array.from({ length: 6 }, () => ({
			avatar: "kevin",
			text: "Hi",
		}));
		expect(
			run(strip({ background: "den", zoom: 4, actors: [] })).err,
		).toContain("zoom must be 0.5 to 2");
		expect(run(strip({ background: "den", actors: six })).err).toContain(
			"a panel holds at most 5 characters",
		);
		expect(run(strip({ columns: 99, panels: [] })).status).toBe(1);
	});

	it("warns without failing where the art falls back", () => {
		const cases = [
			[{ avatar: "kevin", emotion: "bored" }, 'no "bored" art'],
			[{ avatar: "kevin", gesture: "shrug" }, 'no "shrug" art'],
			[{ avatar: "connor", emotion: "shout" }, 'its "angry" faces'],
			[{ avatar: "kevin", text: "x".repeat(95) }, "will crowd the art"],
			[{ avatar: "kevin", nickname: "kev" }, 'unknown field "nickname"'],
		] as const;
		for (const [actor, wanted] of cases) {
			const { status, err } = run(
				strip({ background: "den", actors: [actor] }),
			);
			expect(err).toContain(wanted);
			expect(status).toBe(0);
		}
	});

	it("names the craft rules a three-panel strip breaks", () => {
		const bare = (extra: Record<string, unknown> = {}) => ({
			camera: "close",
			actors: [{ avatar: "kevin", text: "Hi", emotion: "happy" }],
			...extra,
		});
		const { status, err } = run(strip(bare(), bare(), bare()));
		expect(err).toContain("no panel has a backdrop");
		expect(err).toContain("close shots");
		expect(err).toContain("no panel names a gesture");
		expect(err).toContain('kevin wears "happy" in panels[0] through panels[2]');
		expect(status).toBe(0);
	});

	it("reports a version the catalog has moved past", () => {
		const { err, status } = run({ ...strip(), version: 1 });
		expect(err).toContain("expected version 2");
		expect(status).toBe(0);
	});

	it("fails on unreadable input and on no input at all", () => {
		expect(run("{ not json").status).toBe(1);
		const bare = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
		expect(bare.status).toBe(2);
		expect(bare.stderr).toContain("usage:");
	});
});
