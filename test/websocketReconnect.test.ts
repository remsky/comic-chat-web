import { describe, expect, it } from "vitest";
import {
	describeWebSocketClose,
	reconnectDelay,
	shouldReconnect,
} from "../src/browser/websocketReconnect.js";

describe("WebSocket reconnect policy", () => {
	it("uses bounded exponential backoff", () => {
		expect(
			Array.from({ length: 7 }, (_, attempt) => reconnectDelay(attempt)),
		).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
	});

	it("retries transient failures but not clean or policy closes", () => {
		for (const code of [1001, 1006, 1011, 1012, 1013, 1014])
			expect(shouldReconnect(code)).toBe(true);
		for (const code of [1000, 1002, 1003, 1007, 1008, 1009])
			expect(shouldReconnect(code)).toBe(false);
	});

	it("shows a server reason when available and otherwise labels the code", () => {
		expect(describeWebSocketClose(1008, "message rate limit exceeded")).toBe(
			"message rate limit exceeded",
		);
		expect(describeWebSocketClose(1006, "")).toBe("connection lost");
		expect(describeWebSocketClose(4321, "")).toBe("connection closed (4321)");
	});
});
