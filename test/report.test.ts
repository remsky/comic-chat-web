import { describe, expect, it } from "vitest";
import {
	REPORT_HANDOFF_KEY,
	reportTranscript,
	stashReport,
	takeReport,
} from "../src/browser/report.js";
import type {
	ChatMode,
	ComicAnnotation,
	RoomEntry,
} from "../src/protocol/room.js";

const annotation: ComicAnnotation = {
	faceIndex: 0,
	faceEmotionIndex: 0,
	faceIntensity: 0,
	torsoIndex: 0,
	torsoEmotionIndex: 0,
	torsoIntensity: 0,
	requested: false,
	talkTos: [],
};

function chat(
	seq: number,
	name: string,
	text: string,
	mode: ChatMode = 1,
	userId = `u${seq}`,
): RoomEntry {
	return { type: "chat", seq, userId, avatar: 0, name, text, mode, annotation };
}

const avatarName = (id: number): string => `avatar-${id}`;

describe("report transcript", () => {
	it("heads the draft with the room and the capture time", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(1, "alice", "hello")],
			avatarName,
			"2026-07-25T18:30:00.000Z",
		);
		expect(draft).toContain("Room: lobby");
		expect(draft).toContain("Captured: 2026-07-25T18:30:00.000Z");
		expect(draft).toContain("Events: 1");
	});

	it("names the service, host, and operator for a reader who has never seen it", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(1, "alice", "hello")],
			avatarName,
			"now",
			{
				site: "https://fork.example",
				contact: "hello@example.test",
				jurisdiction: "Canada",
			},
		);
		expect(draft).toContain("Site: https://fork.example");
		expect(draft).toContain("Host: Cloudflare");
		expect(draft).toContain("Operator contact: hello@example.test");
		expect(draft).toContain("Operator jurisdiction: Canada");
	});

	it("leaves out the lines an unconfigured deploy cannot fill", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(1, "alice", "hello")],
			avatarName,
			"now",
		);
		expect(draft).not.toContain("Site:");
		expect(draft).not.toContain("Operator contact:");
		expect(draft).not.toContain("Operator jurisdiction:");
		// the host holds whatever records exist regardless of what the deploy configures
		expect(draft).toContain("Host: Cloudflare");
	});

	it("carries the sequence and the sender id alongside each line", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(7, "alice", "hello there")],
			avatarName,
			"now",
		);
		expect(draft).toContain("[7] (u7) alice: hello there");
	});

	it("stamps each line with the time the room stored it, in UTC", () => {
		const draft = reportTranscript(
			"lobby",
			[{ ...chat(7, "alice", "hello there"), at: 1_700_000_000_000 }],
			avatarName,
			"now",
		);
		expect(draft).toContain(
			"[7 2023-11-14T22:13:20.000Z] (u7) alice: hello there",
		);
	});

	it("marks think and whisper with their own headers", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(1, "alice", "hmm", 3), chat(2, "bob", "psst", 2)],
			avatarName,
			"now",
		);
		expect(draft).toContain("[1] (u1) alice thinks: hmm");
		expect(draft).toContain("[2] (u2) bob whispers: psst");
	});

	it("renders system events as starred lines with no sender id", () => {
		const draft = reportTranscript(
			"lobby",
			[{ type: "background", seq: 4, name: "volcano", by: "carol" }],
			avatarName,
			"now",
		);
		expect(draft).toContain("[4] * carol set the background to volcano");
	});

	it("skips pose-change lines the text view also drops", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(1, "alice", "<Chr>"), chat(2, "alice", "real line")],
			avatarName,
			"now",
		);
		expect(draft).not.toContain("<Chr>");
		expect(draft).toContain("Events: 1");
	});

	it("omits the id for history predating the sender_id column", () => {
		const draft = reportTranscript(
			"lobby",
			[chat(1, "alice", "hello", 1, "")],
			avatarName,
			"now",
		);
		expect(draft).toContain("[1] alice: hello");
	});
});

function fakeStore(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => void map.set(key, value),
		removeItem: (key) => void map.delete(key),
		clear: () => map.clear(),
		key: (index) => [...map.keys()][index] ?? null,
		get length() {
			return map.size;
		},
	};
}

describe("report handoff", () => {
	it("carries the draft across to the page that reads it", () => {
		const store = fakeStore();
		stashReport(store, "a transcript");
		expect(takeReport(store)).toBe("a transcript");
	});

	it("clears the entry as it reads, so a second load finds nothing", () => {
		const store = fakeStore();
		stashReport(store, "a transcript");
		takeReport(store);
		expect(store.getItem(REPORT_HANDOFF_KEY)).toBeNull();
		expect(takeReport(store)).toBe("");
	});

	it("reads empty when the room never stashed anything", () => {
		expect(takeReport(fakeStore())).toBe("");
	});

	it("survives storage a browser has blocked", () => {
		const blocked = {
			...fakeStore(),
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
		} as Storage;
		expect(() => stashReport(blocked, "x")).not.toThrow();
		expect(takeReport(blocked)).toBe("");
	});
});
