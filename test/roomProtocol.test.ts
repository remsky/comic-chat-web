import { describe, expect, it } from "vitest";
import {
	CAST_SIZE,
	type ComicAnnotation,
	DEFAULT_ROOMS,
	MAX_TEXT_LENGTH,
	parseClientMessage,
	parseRoomEntry,
	parseRoomListings,
	parseServerMessage,
	resolveRoomAllowlist,
	roomNameFromPath,
} from "../src/protocol/room.js";

const annotation: ComicAnnotation = {
	faceIndex: 0,
	faceEmotionIndex: 9,
	faceIntensity: 0,
	torsoIndex: 0,
	torsoEmotionIndex: 9,
	torsoIntensity: 0,
	requested: false,
	talkTos: [],
};

describe("room wire protocol", () => {
	it("accepts well-formed join and chat messages", () => {
		expect(
			parseClientMessage(
				JSON.stringify({ type: "join", name: " Anna ", avatar: 3 }),
			),
		).toEqual({ type: "join", name: "Anna", avatar: 3 });
		expect(
			parseClientMessage(
				JSON.stringify({ type: "chat", text: "hi", mode: 5, annotation }),
			),
		).toEqual({ type: "chat", text: "hi", mode: 5, annotation });
		expect(
			parseClientMessage(JSON.stringify({ type: "history", before: 51 })),
		).toEqual({ type: "history", before: 51 });
	});

	it("rejects malformed, empty, and out-of-range messages", () => {
		expect(parseClientMessage("not json")).toBeNull();
		expect(parseClientMessage(new ArrayBuffer(4))).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "join", name: "  ", avatar: 1 }),
			),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "join", name: "x", avatar: CAST_SIZE + 1 }),
			),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "chat", text: "hi", mode: 4, annotation }),
			),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "chat", text: " ", mode: 1, annotation }),
			),
		).toBeNull();
		expect(
			parseClientMessage(JSON.stringify({ type: "history", before: 0 })),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "history", before: Number.POSITIVE_INFINITY }),
			),
		).toBeNull();
	});

	it("caps chat text at the protocol limit", () => {
		const parsed = parseClientMessage(
			JSON.stringify({
				type: "chat",
				text: "x".repeat(5000),
				mode: 1,
				annotation,
			}),
		);
		expect(parsed?.type).toBe("chat");
		if (parsed?.type === "chat")
			expect(parsed.text.length).toBe(MAX_TEXT_LENGTH);
	});

	it("routes only valid room websocket paths", () => {
		expect(roomNameFromPath("/api/rooms/lobby/websocket")).toBe("lobby");
		expect(roomNameFromPath("/api/rooms/my-room_2/websocket")).toBe(
			"my-room_2",
		);
		expect(roomNameFromPath("/api/rooms//websocket")).toBeNull();
		expect(roomNameFromPath("/api/rooms/a b/websocket")).toBeNull();
		expect(roomNameFromPath("/api/rooms/lobby")).toBeNull();
	});

	it("parses profile, depart, and join-from messages", () => {
		expect(
			parseClientMessage(
				JSON.stringify({ type: "profile", name: " Bea ", avatar: 4 }),
			),
		).toEqual({ type: "profile", name: "Bea", avatar: 4 });
		expect(
			parseClientMessage(
				JSON.stringify({ type: "profile", name: " ", avatar: 4 }),
			),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "profile", name: "x", avatar: 0 }),
			),
		).toBeNull();
		expect(
			parseClientMessage(JSON.stringify({ type: "depart", to: "lobby" })),
		).toEqual({ type: "depart", to: "lobby" });
		expect(
			parseClientMessage(JSON.stringify({ type: "depart", to: "bad room" })),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "join", name: "x", avatar: 1, from: "lobby" }),
			),
		).toEqual({ type: "join", name: "x", avatar: 1, from: "lobby" });
		// a malformed origin room is dropped, not fatal
		expect(
			parseClientMessage(
				JSON.stringify({
					type: "join",
					name: "x",
					avatar: 1,
					from: "bad room",
				}),
			),
		).toEqual({ type: "join", name: "x", avatar: 1 });
	});

	it("accepts background changes and rejects bad names", () => {
		expect(
			parseClientMessage(JSON.stringify({ type: "background", name: "field" })),
		).toEqual({ type: "background", name: "field" });
		expect(
			parseClientMessage(JSON.stringify({ type: "background", name: "" })),
		).toEqual({ type: "background", name: "" });
		expect(
			parseClientMessage(
				JSON.stringify({ type: "background", name: "../etc" }),
			),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ type: "background", name: "x".repeat(33) }),
			),
		).toBeNull();
	});

	it("parses room directory listings and rejects other shapes", () => {
		expect(
			parseRoomListings({
				rooms: [
					{ name: "lobby", members: 3, active: 17 },
					{ name: "attic", members: 1, active: 12 },
				],
			}),
		).toEqual([
			{ name: "lobby", members: 3, active: 17 },
			{ name: "attic", members: 1, active: 12 },
		]);
		expect(parseRoomListings({ rooms: [] })).toEqual([]);
		expect(parseRoomListings(null)).toBeNull();
		expect(parseRoomListings("<!doctype html>")).toBeNull();
		expect(parseRoomListings({ rooms: [{ name: "lobby" }] })).toBeNull();
		expect(
			parseRoomListings({ rooms: [{ name: 7, members: 1, active: 1 }] }),
		).toBeNull();
	});

	it("resolves the room allowlist, validating and de-duplicating names", () => {
		expect(resolveRoomAllowlist(["lobby", "attic", "lobby"])).toEqual([
			"lobby",
			"attic",
		]);
		expect(resolveRoomAllowlist(" lobby, attic  comics ")).toEqual([
			"lobby",
			"attic",
			"comics",
		]);
		expect(
			resolveRoomAllowlist([" spaced name ", "ok", 7, "bad/slash"]),
		).toEqual(["ok"]);
	});

	it("falls back to the default room set when the allowlist is empty or unusable", () => {
		expect(resolveRoomAllowlist(undefined)).toEqual([...DEFAULT_ROOMS]);
		expect(resolveRoomAllowlist([])).toEqual([...DEFAULT_ROOMS]);
		expect(resolveRoomAllowlist("!!! ///")).toEqual([...DEFAULT_ROOMS]);
		expect(resolveRoomAllowlist(42)).toEqual([...DEFAULT_ROOMS]);
	});

	it("parses typed room entries and rejects malformed ones", () => {
		const chatEntry = {
			type: "chat",
			seq: 1,
			avatar: 2,
			name: "Anna",
			text: "hi",
			mode: 1,
			annotation,
		};
		expect(parseRoomEntry(chatEntry)).toEqual(chatEntry);
		expect(
			parseRoomEntry({
				type: "background",
				seq: 2,
				name: "volcano",
				by: "Anna",
			}),
		).toEqual({ type: "background", seq: 2, name: "volcano", by: "Anna" });
		expect(
			parseRoomEntry({
				type: "announce",
				kind: "nick",
				seq: 3,
				avatar: 2,
				name: "Anna",
				detail: "Bea",
			}),
		).toMatchObject({ type: "announce", kind: "nick" });
		expect(parseRoomEntry({ ...chatEntry, annotation: undefined })).toBeNull();
		expect(parseRoomEntry({ ...chatEntry, seq: 0 })).toBeNull();
		expect(parseRoomEntry({ ...chatEntry, mode: 6 })).toBeNull();
		expect(
			parseRoomEntry({ type: "background", seq: 2, name: "../x", by: "Anna" }),
		).toBeNull();
		expect(
			parseRoomEntry({
				type: "announce",
				kind: "shout",
				seq: 3,
				avatar: 2,
				name: "Anna",
				detail: "x",
			}),
		).toBeNull();
	});

	it("validates nested entries in server messages", () => {
		const entry = {
			type: "chat",
			seq: 1,
			avatar: 2,
			name: "Anna",
			text: "hi",
			mode: 1,
			annotation,
		};
		expect(
			parseServerMessage(JSON.stringify({ type: "entry", entry })),
		).toEqual({ type: "entry", entry });
		expect(
			parseServerMessage(JSON.stringify({ type: "entry", entry: { seq: 1 } })),
		).toBeNull();
		const welcome = {
			type: "welcome",
			id: "seat-1",
			avatar: 2,
			background: "field",
			historyBackground: "field",
			roster: [{ id: "seat-1", name: "Anna", avatar: 2 }],
			history: [entry],
		};
		expect(parseServerMessage(JSON.stringify(welcome))).toEqual(welcome);
		expect(
			parseServerMessage(JSON.stringify({ ...welcome, history: [{ seq: 1 }] })),
		).toBeNull();
		expect(parseServerMessage("nope")).toBeNull();
	});
});
