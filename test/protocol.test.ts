import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol/room.js";

describe("parseClientMessage pose", () => {
	it("accepts a chat without a pose", () => {
		expect(
			parseClientMessage(JSON.stringify({ type: "chat", text: "hi", mode: 1 })),
		).toEqual({ type: "chat", text: "hi", mode: 1 });
	});

	it("accepts UCHAR pose indices with a 0/1 requested flag", () => {
		expect(
			parseClientMessage(
				JSON.stringify({
					type: "chat",
					text: "hi",
					mode: 1,
					pose: { expr: 4, gest: 7, req: 1 },
				}),
			),
		).toEqual({
			type: "chat",
			text: "hi",
			mode: 1,
			pose: { expr: 4, gest: 7, req: 1 },
		});
	});

	it("rejects malformed poses", () => {
		const base = { type: "chat", text: "hi", mode: 1 };
		for (const pose of [
			{ expr: -1, gest: 0, req: 0 },
			{ expr: 256, gest: 0, req: 0 },
			{ expr: 1.5, gest: 0, req: 0 },
			{ expr: 0, gest: 0, req: 2 },
			{ expr: 0, gest: 0 },
			"pose",
		]) {
			expect(
				parseClientMessage(JSON.stringify({ ...base, pose })),
				JSON.stringify(pose),
			).toBeNull();
		}
	});

	it("still passes <Chr> reaction text", () => {
		expect(
			parseClientMessage(
				JSON.stringify({
					type: "chat",
					text: "<Chr>",
					mode: 1,
					pose: { expr: 0, gest: 3, req: 1 },
				}),
			),
		).toMatchObject({ text: "<Chr>" });
	});
});
