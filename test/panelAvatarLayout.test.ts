import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import {
	bodyFromPoseIDs,
	clonePlacedAvatars,
	layoutAvatarGeometry,
	type PlacedAvatar,
} from "../src/engine/panel.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

const traceNames = readdirSync(new URL("../traces/", import.meta.url))
	.filter((name) => name.endsWith(".jsonl"))
	.sort();

describe.each(traceNames)("%s panel avatar geometry", (name) => {
	it("reproduces every body bbox and arrow position in placed order", () => {
		const records = parseTrace(
			readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
		);
		const header = recordsOfType(records, "header")[0];
		expect(header).toBeDefined();
		if (!header) return;
		const registry = new AvatarRegistry(fixture.avatars);
		const panels = recordsOfType(records, "panel");
		const bodies = recordsOfType(records, "body");
		const establishingByPanel = new Map<number, boolean>();
		let pageCount = header.panelsAtStart;
		let establishing = true;
		let cloned = false;
		for (const record of records) {
			if (record.type === "panelDecision") {
				cloned = record.cloned !== 0;
				establishing = pageCount <= 1 || (cloned && pageCount <= 2);
			} else if (record.type === "panel") {
				establishingByPanel.set(record.panel, establishing);
				if (!cloned) pageCount++;
			}
		}

		for (const panel of panels) {
			const expected = bodies
				.filter((body) => body.panel === panel.panel)
				.sort((a, b) => a.i - b.i);
			const placed: PlacedAvatar[] = expected.map((record) => {
				const avatar = registry.get(record.avatarId);
				expect(avatar).toBeDefined();
				if (!avatar) throw new Error(`missing avatar ${record.avatarId}`);
				const body = bodyFromPoseIDs(
					avatar.data,
					record.poseFace,
					record.poseTorso,
				);
				body.flip = record.flip !== 0;
				body.requested = record.requested !== 0;
				return { avatar, body };
			});

			const attempt = clonePlacedAvatars(placed);
			layoutAvatarGeometry(attempt, {
				unitWidth: header.unitWidth,
				unitHeight: header.unitHeight,
				establishing: establishingByPanel.get(panel.panel) ?? true,
			});
			const matches = attempt.every((entry, i) => {
				const want = expected[i];
				return (
					want !== undefined &&
					JSON.stringify([
						entry.body.bbox.left,
						entry.body.bbox.bottom,
						entry.body.bbox.right,
						entry.body.bbox.top,
					]) === JSON.stringify(want.bbox) &&
					entry.body.arrowX === want.arrowX
				);
			});
			expect(matches, `${name} panel ${panel.panel}`).toBe(true);
		}
	});
});
