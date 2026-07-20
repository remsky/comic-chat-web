import { describe, expect, it } from "vitest";
import {
	CAST_SIZE,
	DEFAULT_ROOMS,
	MAX_TEXT_LENGTH,
	parseClientMessage,
	parseRoomListings,
	parseServerMessage,
	pickAvatar,
	resolveRoomAllowlist,
	roomNameFromPath,
} from "../src/protocol/room.js";

describe("room wire protocol", () => {
	it("accepts well-formed join and chat messages", () => {
		expect(
			parseClientMessage(
				JSON.stringify({ type: "join", name: " Anna ", avatar: 3 }),
			),
		).toEqual({ type: "join", name: "Anna", avatar: 3 });
		expect(
			parseClientMessage(JSON.stringify({ type: "chat", text: "hi", mode: 5 })),
		).toEqual({ type: "chat", text: "hi", mode: 5 });
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
			parseClientMessage(JSON.stringify({ type: "chat", text: "hi", mode: 4 })),
		).toBeNull();
		expect(
			parseClientMessage(JSON.stringify({ type: "chat", text: " ", mode: 1 })),
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
			JSON.stringify({ type: "chat", text: "x".repeat(5000), mode: 1 }),
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

	it("assigns the requested cast seat or the first free one", () => {
		expect(pickAvatar(2, [])).toBe(2);
		expect(pickAvatar(2, [2])).toBe(1);
		expect(pickAvatar(1, [1, 2, 3])).toBe(4);
		const everySeat = Array.from({ length: CAST_SIZE }, (_, i) => i + 1);
		expect(pickAvatar(1, everySeat)).toBeNull();
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

	it("round-trips server messages", () => {
		expect(
			parseServerMessage(JSON.stringify({ type: "chat", entry: { seq: 1 } })),
		).toMatchObject({ type: "chat" });
		expect(parseServerMessage("nope")).toBeNull();
	});
});
