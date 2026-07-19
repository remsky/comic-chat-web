import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import { EmotionEngine } from "../src/engine/emotion.js";
import {
	cloneUnitPanel,
	type PanelDecision,
	PanelPage,
	SM_ACTION,
	type UnitPanel,
} from "../src/engine/panel.js";
import { MsvcRand } from "../src/engine/rand.js";
import {
	type BodyRecord,
	parseTrace,
	recordsOfType,
	type TraceRecord,
} from "../src/trace/format.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

function requestedBody(registry: AvatarRegistry, avatarID: number): void {
	const avatar = registry.get(avatarID);
	if (!avatar?.body) throw new Error(`missing avatar ${avatarID}`);
	avatar.body.requested = true;
}

describe("panel page lifecycle", () => {
	it("creates, clones, relinks speakers, and returns to fresh panels", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const decisions: PanelDecision[] = [];
		const page = new PanelPage({
			registry,
			rand: new MsvcRand(1515),
			unitWidth: 2300,
			unitHeight: 5400,
			hooks: {
				layoutBalloons: () => ({ fits: true }),
				onDecision: (decision) => decisions.push(decision),
			},
		});
		requestedBody(registry, 1);
		page.addLine(1, "one", 1);
		requestedBody(registry, 2);
		page.addLine(2, "two", 1);
		expect(page.panels).toHaveLength(2);
		const combined = page.panels[1];
		expect(combined?.balloons).toHaveLength(2);
		expect(combined?.balloons[0]?.speaker).toBe(combined?.bodies[0]);
		expect(combined?.balloons[1]?.speaker).toBe(combined?.bodies[1]);

		requestedBody(registry, 1);
		page.addLine(1, "three", 1);
		expect(page.panels).toHaveLength(3);
		expect(decisions.map((decision) => decision.cloned)).toEqual([
			false,
			true,
			false,
		]);
	});

	it("copies panel seeds without consuming a draw and deep-clones body links", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		requestedBody(registry, 1);
		let committed: UnitPanel | undefined;
		const rand = new MsvcRand(1515);
		const page = new PanelPage({
			registry,
			rand,
			unitWidth: 2300,
			unitHeight: 5400,
			hooks: {
				layoutBalloons: () => ({ fits: true }),
				onCommit: (panel) => {
					committed = panel;
				},
			},
		});
		page.addLine(1, "one", 1);
		expect(committed?.seed).toBe(4985);
		if (!committed) return;
		const cloned = cloneUnitPanel(committed);
		expect(cloned.seed).toBe(committed.seed);
		expect(cloned.bodies[0]).not.toBe(committed.bodies[0]);
		expect(cloned.balloons[0]?.speaker).toBe(cloned.bodies[0]);
		expect(rand.rand()).toBe(5859);
	});

	it("retries fresh and recursively commits continuation text after reset", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		requestedBody(registry, 1);
		const decisions: PanelDecision[] = [];
		let layouts = 0;
		const page = new PanelPage({
			registry,
			rand: new MsvcRand(1515),
			unitWidth: 2300,
			unitHeight: 5400,
			hooks: {
				layoutBalloons: () => {
					layouts++;
					if (layouts === 2) return { fits: false };
					if (layouts === 3) return { fits: true, leftover: "... rest" };
					return { fits: true };
				},
				onDecision: (decision) => decisions.push(decision),
			},
		});
		page.addLine(1, "first", 1);
		requestedBody(registry, 2);
		page.addLine(2, "long words", 1);
		expect(decisions.map((decision) => decision.cloned)).toEqual([
			false,
			true,
			false,
			false,
		]);
		expect(decisions.map((decision) => decision.words)).toEqual([
			"first",
			"long words",
			"long words",
			"... rest",
		]);
		expect(page.panels).toHaveLength(4);
		expect(page.panels.at(-1)?.bodies[0]?.requested).toBe(true);
	});

	it("draws the Ohio semantics randfloat and flags the backdrop", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		requestedBody(registry, 1);
		const rand = new MsvcRand(1515);
		const reference = new MsvcRand(1515);
		reference.rand();
		reference.randfloat();
		const expected = reference.rand();
		let committed: UnitPanel | undefined;
		const page = new PanelPage({
			registry,
			rand,
			unitWidth: 2300,
			unitHeight: 5400,
			hooks: {
				layoutBalloons: () => ({ fits: true }),
				onCommit: (panel) => {
					committed = panel;
				},
			},
		});
		page.addLine(1, "Ohio is round on the ends", 1);
		expect(committed?.backdropMode).toBe(1);
		expect(rand.rand()).toBe(expected);

		requestedBody(registry, 2);
		page.addLine(2, "ohio stays lowercase", 1);
		expect(committed?.backdropMode).toBe(0);
	});

	it("forces action and break messages onto the next fresh panel", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const decisions: PanelDecision[] = [];
		const page = new PanelPage({
			registry,
			rand: new MsvcRand(1515),
			unitWidth: 2300,
			unitHeight: 5400,
			panelsAtStart: 2,
			hooks: {
				layoutBalloons: () => ({ fits: true }),
				onDecision: (decision) => decisions.push(decision),
			},
		});
		page.addLine(1, "<Brk>", 1);
		requestedBody(registry, 1);
		page.addLine(1, "action", SM_ACTION);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.cloned).toBe(false);
	});
});

interface ExpectedAttempt {
	decision: Extract<TraceRecord, { type: "panelDecision" }>;
	failed: boolean;
	leftover?: string;
}

function expectedAttempts(
	records: TraceRecord[],
): Map<number, ExpectedAttempt[]> {
	const byMessage = new Map<number, ExpectedAttempt[]>();
	let messageSeq = -1;
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record?.type === "message") {
			messageSeq = record.seq;
			byMessage.set(messageSeq, []);
			continue;
		}
		if (record?.type !== "panelDecision") continue;
		let end = i + 1;
		while (
			end < records.length &&
			records[end]?.type !== "panelDecision" &&
			records[end]?.type !== "message"
		)
			end++;
		const failed = records
			.slice(i + 1, end)
			.some((candidate) => candidate.type === "panelRetry");
		const next = records[end];
		byMessage.get(messageSeq)?.push({
			decision: record,
			failed,
			leftover:
				!failed && next?.type === "panelDecision" ? next.words : undefined,
		});
	}
	return byMessage;
}

function expectPanelBodies(
	name: string,
	panel: UnitPanel,
	expected: readonly BodyRecord[],
	registry: AvatarRegistry,
): void {
	expect(panel.bodies, name).toHaveLength(expected.length);
	for (let i = 0; i < expected.length; i++) {
		const body = panel.bodies[i];
		const want = expected[i];
		if (!body || !want) continue;
		const avatar = registry.get(body.avatarID);
		if (!avatar) throw new Error(`missing avatar ${body.avatarID}`);
		const facePose =
			body.kind === "complex"
				? avatar.data.faces[body.faceIndex]?.poseID
				: avatar.data.bodies[body.bodyIndex]?.poseID;
		const torsoPose =
			body.kind === "complex"
				? avatar.data.torsos[body.torsoIndex]?.poseID
				: -1;
		expect(
			{
				avatarID: body.avatarID,
				flip: Number(body.flip),
				requested: Number(body.requested),
				arrowX: body.arrowX,
				bbox: [
					body.bbox.left,
					body.bbox.bottom,
					body.bbox.right,
					body.bbox.top,
				],
				facePose,
				torsoPose,
			},
			`${name} body ${i}`,
		).toEqual({
			avatarID: want.avatarId,
			flip: want.flip,
			requested: want.requested,
			arrowX: want.arrowX,
			bbox: want.bbox,
			facePose: want.poseFace,
			torsoPose: want.poseTorso,
		});
	}
}

const traceNames = readdirSync(new URL("../traces/", import.meta.url))
	.filter((name) => name.endsWith(".jsonl"))
	.sort();

describe.each(traceNames)("%s panel lifecycle", (name) => {
	it("replays every fresh/clone/retry/continuation decision", () => {
		const records = parseTrace(
			readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
		);
		const header = recordsOfType(records, "header")[0];
		if (!header) throw new Error("trace has no header");
		const attemptsByMessage = expectedAttempts(records);
		const registry = new AvatarRegistry(fixture.avatars);
		const emotions = new EmotionEngine();
		const expectedPanels = recordsOfType(records, "panel");
		const bodyRecords = recordsOfType(records, "body");
		let attempts: ExpectedAttempt[] = [];
		let attemptIndex = 0;
		let commitIndex = 0;
		const page = new PanelPage({
			registry,
			rand: new MsvcRand(header.srand),
			unitWidth: header.unitWidth,
			unitHeight: header.unitHeight,
			panelsAtStart: header.panelsAtStart,
			hooks: {
				onDecision: (decision) => {
					const expected = attempts[attemptIndex]?.decision;
					expect(decision, `${name} decision ${attemptIndex}`).toEqual({
						cloned: expected?.cloned !== 0,
						speaker: expected?.speaker,
						words: expected?.words,
					});
				},
				layoutBalloons: () => {
					const expected = attempts[attemptIndex];
					attemptIndex++;
					return {
						fits: !expected?.failed,
						leftover: expected?.leftover,
					};
				},
				onCommit: (panel) => {
					const expectedPanel = expectedPanels[commitIndex];
					if (!expectedPanel) throw new Error("unexpected panel commit");
					expectPanelBodies(
						`${name} panel ${expectedPanel.panel}`,
						panel,
						bodyRecords
							.filter((body) => body.panel === expectedPanel.panel)
							.sort((a, b) => a.i - b.i),
						registry,
					);
					commitIndex++;
				},
			},
		});

		for (const message of recordsOfType(records, "message")) {
			attempts = attemptsByMessage.get(message.seq) ?? [];
			attemptIndex = 0;
			const avatar = registry.get(message.speaker);
			if (!avatar) throw new Error(`missing avatar ${message.speaker}`);
			avatar.updateBody(
				avatar.getBodyFromOptions(emotions.getEmotionsFromString(message.text)),
			);
			page.addLine(message.speaker, message.text, message.mode);
			expect(attemptIndex, `${name} message ${message.seq}`).toBe(
				attempts.length,
			);
		}
		expect(commitIndex).toBe(expectedPanels.length);
	});
});

// AddReaction (panel.cpp:433-470): "<Chr>" pose panels with no balloon
describe("reaction panels", () => {
	function makePage(registry: AvatarRegistry, decisions?: PanelDecision[]) {
		return new PanelPage({
			registry,
			rand: new MsvcRand(1515),
			unitWidth: 2300,
			unitHeight: 5400,
			hooks: {
				layoutBalloons: () => ({ fits: true }),
				onDecision: (decision) => decisions?.push(decision),
			},
		});
	}

	it("replaces the poser's body in a cloned panel without adding a balloon", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const decisions: PanelDecision[] = [];
		const page = makePage(registry, decisions);
		requestedBody(registry, 1);
		page.addLine(1, "one", 1);
		requestedBody(registry, 2);
		page.addLine(2, "two", 1);
		expect(page.panels).toHaveLength(2);

		const avatar = registry.get(1);
		if (!avatar) throw new Error("missing avatar 1");
		const posed = avatar.getBodyFromEmotion(0, 1);
		avatar.updateBody(posed);
		page.addLine(1, "<Chr>", 1);

		expect(page.panels).toHaveLength(2);
		const panel = page.panels.at(-1);
		expect(panel?.balloons).toHaveLength(2);
		const body = panel?.bodies.find((candidate) => candidate.avatarID === 1);
		expect(body?.requested).toBe(true);
		expect(body?.kind === "complex" ? body.faceIndex : undefined).toBe(
			posed.kind === "complex" ? posed.faceIndex : undefined,
		);
		expect(decisions.at(-1)).toEqual({
			cloned: true,
			speaker: 1,
			words: "<Chr>",
		});
		// ResetAvatar ran: temp state decayed back to a neutral, unrequested body
		expect(avatar.body?.requested).toBe(false);
	});

	it("fetches a newcomer into the cloned panel", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const page = makePage(registry);
		requestedBody(registry, 1);
		page.addLine(1, "one", 1);
		requestedBody(registry, 2);
		page.addLine(2, "two", 1);

		const avatar = registry.get(3);
		if (!avatar) throw new Error("missing avatar 3");
		avatar.updateBody(avatar.getBodyFromEmotion(0, 1));
		page.addLine(3, "<Chr>", 1);

		const panel = page.panels.at(-1);
		expect(panel?.balloons).toHaveLength(2);
		expect(panel?.bodies.some((candidate) => candidate.avatarID === 3)).toBe(
			true,
		);
	});

	it("starts fresh when the page has no panel to clone", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const decisions: PanelDecision[] = [];
		const page = makePage(registry, decisions);
		const avatar = registry.get(1);
		if (!avatar) throw new Error("missing avatar 1");
		avatar.updateBody(avatar.getBodyFromEmotion(0, 1));
		page.addLine(1, "<Chr>", 1);
		expect(decisions).toEqual([{ cloned: false, speaker: 1, words: "<Chr>" }]);
		const panel = page.panels.at(-1);
		expect(panel?.balloons).toHaveLength(0);
		expect(panel?.bodies).toHaveLength(1);
	});
});
