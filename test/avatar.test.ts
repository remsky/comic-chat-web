import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	AF_FROZEN,
	type AvatarData,
	AvatarRegistry,
	bodiesAreSame,
	cloneBody,
} from "../src/engine/avatar.js";
import { EmotionEngine } from "../src/engine/emotion.js";
import { parseTrace } from "../src/trace/format.js";

interface FixtureFile {
	avatars: AvatarData[];
}

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as FixtureFile;

describe("avatar body model", () => {
	it("initializes every avatar to an unrequested neutral body", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		for (const avatar of registry.avatars) {
			expect(avatar.body, avatar.data.name).not.toBeNull();
			expect(avatar.body?.requested).toBe(false);
			const indices = avatar.getIndices();
			expect(indices.requested).toBe(0);
		}
	});

	it("clones body geometry and compares only pose record identity", () => {
		const avatar = new AvatarRegistry(fixture.avatars).get(1);
		expect(avatar?.body).not.toBeNull();
		if (!avatar?.body) return;
		const cloned = cloneBody(avatar.body);
		cloned.flip = !cloned.flip;
		cloned.requested = !cloned.requested;
		cloned.bbox.left = 123;
		expect(bodiesAreSame(avatar.body, cloned)).toBe(true);
		expect(avatar.body.bbox.left).toBe(-1);
	});

	it("reports freeze state separately from body requested state", () => {
		const avatar = new AvatarRegistry(fixture.avatars).get(1);
		expect(avatar).toBeDefined();
		if (!avatar) return;
		avatar.freeze = AF_FROZEN;
		expect(avatar.getIndices().requested).toBe(1);
		expect(avatar.body?.requested).toBe(false);
	});

	it("computes dimensions for complex and simple bodies", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		for (const avatarID of [1, 3]) {
			const avatar = registry.get(avatarID);
			expect(avatar?.body).not.toBeNull();
			if (!avatar?.body) continue;
			const dims = avatar.getDimInfo(avatar.body);
			expect(dims.xdim).toBeGreaterThan(0);
			expect(dims.ydim).toBeGreaterThan(0);
			expect(dims.normHeight).toBe(100);
			expect(dims.headHeight).toBeGreaterThan(0);
		}
	});
});

const traceNames = readdirSync(new URL("../traces/", import.meta.url))
	.filter((name) => name.endsWith(".jsonl"))
	.sort();

describe.each(traceNames)("%s avatar selection", (name) => {
	it("reproduces every oracle emotion face and torso index", () => {
		const records = parseTrace(
			readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
		);
		const registry = new AvatarRegistry(fixture.avatars);
		const emotionEngine = new EmotionEngine();
		let message: { speaker: number; text: string } | null = null;

		for (const record of records) {
			if (record.type === "message") {
				message = { speaker: record.speaker, text: record.text };
				continue;
			}
			if (!message) continue;
			if (record.type === "emotion") {
				const avatar = registry.get(record.avatarId);
				expect(
					avatar,
					`${message.text}: avatar ${record.avatarId}`,
				).toBeDefined();
				if (!avatar) continue;

				const opts = emotionEngine.getEmotionsFromString(message.text);
				avatar.updateBody(avatar.getBodyFromOptions(opts));
				expect(
					avatar.getIndices(),
					`${name}: ${record.avatarId} ${JSON.stringify(message.text)}`,
				).toEqual({
					faceIndex: record.faceIndex,
					torsoIndex: record.torsoIndex,
					requested: record.requested,
				});
				expect(opts.opts.every((opt) => opt.priority === 0)).toBe(true);
			} else if (record.type === "panelDecision") {
				const avatar = registry.get(message.speaker);
				if (avatar?.body) avatar.recordBody(avatar.body);
			} else if (record.type === "panel") {
				registry.get(message.speaker)?.reset();
			}
		}
	});
});
