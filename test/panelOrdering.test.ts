import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type AvatarBody,
	type AvatarData,
	AvatarRegistry,
	cloneBody,
} from "../src/engine/avatar.js";
import {
	BR_SPEAKER,
	bodyFromPoseIDs,
	filterSpeakerBodies,
	orderAvatars,
	type PanelBodyRecord,
	updateAvatarHysteresis,
} from "../src/engine/panel.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

function speakerRecord(
	registry: AvatarRegistry,
	avatarID: number,
): PanelBodyRecord {
	const avatar = registry.get(avatarID);
	if (!avatar?.body) throw new Error(`missing avatar ${avatarID}`);
	return { avatar, body: cloneBody(avatar.body), priority: BR_SPEAKER };
}

describe("panel speaker filtering and ordering", () => {
	it("keeps balloon speakers and avatars with a requested prototype body", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const bodies = [1, 2, 3].map((avatarID) =>
			speakerRecord(registry, avatarID),
		);
		const requested = registry.get(2);
		expect(requested?.body).not.toBeNull();
		if (!requested?.body) return;
		requested.body.requested = true;

		const filtered = filterSpeakerBodies(
			bodies.map((record) => record.body),
			registry.avatars,
			new Set([1]),
		);
		expect(filtered.map((record) => record.body.avatarID)).toEqual([1, 2]);
		expect(filtered.map((record) => record.priority)).toEqual([
			BR_SPEAKER,
			BR_SPEAKER,
		]);
	});

	it("places two world-facing speakers inward", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const ordered = orderAvatars(
			[1, 2].map((avatarID) => speakerRecord(registry, avatarID)),
			registry.avatars,
		);
		expect(
			ordered.map((record) => [record.body.avatarID, record.body.flip]),
		).toEqual([
			[1, false],
			[2, true],
		]);
	});

	it("adds unique talk-to avatars up to the five-body v1 cap", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const speaker = registry.get(1);
		expect(speaker).toBeDefined();
		if (!speaker) return;
		speaker.talkTo = [2, 2, 3, 4, 5, 6];
		const ordered = orderAvatars(
			[speakerRecord(registry, 1)],
			registry.avatars,
		);
		expect(ordered).toHaveLength(5);
		expect(new Set(ordered.map((record) => record.body.avatarID))).toEqual(
			new Set([1, 2, 3, 4, 5]),
		);
	});

	it("preserves missing-side neighbors when updating v1 hysteresis", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const first = speakerRecord(registry, 1);
		const second = speakerRecord(registry, 2);
		first.body.flip = false;
		second.body.flip = true;
		first.avatar.lastRight = 99;
		second.avatar.lastLeft = 98;
		updateAvatarHysteresis([first, second]);
		expect(first.avatar.lastDir).toBe(false);
		expect(first.avatar.lastLeft).toBe(2);
		expect(first.avatar.lastRight).toBe(99);
		expect(second.avatar.lastDir).toBe(true);
		expect(second.avatar.lastRight).toBe(1);
		expect(second.avatar.lastLeft).toBe(98);
	});
});

const traceNames = readdirSync(new URL("../traces/", import.meta.url))
	.filter((name) => name.endsWith(".jsonl"))
	.sort();

describe.each(traceNames)("%s panel ordering", (name) => {
	it("replays every decision, including discarded retries", () => {
		const records = parseTrace(
			readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
		);
		const registry = new AvatarRegistry(fixture.avatars);
		const bodiesByPanel = new Map(
			recordsOfType(records, "panel").map((panel) => [
				panel.panel,
				recordsOfType(records, "body")
					.filter((body) => body.panel === panel.panel)
					.sort((a, b) => a.i - b.i),
			]),
		);
		let committed: PanelBodyRecord[] = [];
		let attempt: PanelBodyRecord[] = [];

		for (const record of records) {
			if (record.type === "panelDecision") {
				const candidates = record.cloned
					? committed.map((entry) => ({
							...entry,
							body: cloneBody(entry.body),
						}))
					: [];
				const existing = candidates.findIndex(
					(entry) => entry.body.avatarID === record.speaker,
				);
				const current = speakerRecord(registry, record.speaker);
				if (existing >= 0) candidates[existing] = current;
				else candidates.push(current);
				attempt = orderAvatars(candidates, registry.avatars);
				updateAvatarHysteresis(attempt);
			} else if (record.type === "panel") {
				const expected = bodiesByPanel.get(record.panel) ?? [];
				expect(
					attempt.map((entry) => [
						entry.body.avatarID,
						Number(entry.body.flip),
					]),
					`${name} panel ${record.panel}`,
				).toEqual(expected.map((body) => [body.avatarId, body.flip]));

				committed = expected.map((body) => {
					const avatar = registry.get(body.avatarId);
					if (!avatar) throw new Error(`missing avatar ${body.avatarId}`);
					const panelBody: AvatarBody = bodyFromPoseIDs(
						avatar.data,
						body.poseFace,
						body.poseTorso,
					);
					panelBody.flip = body.flip !== 0;
					return { avatar, body: panelBody, priority: BR_SPEAKER };
				});
			}
		}
	});
});
