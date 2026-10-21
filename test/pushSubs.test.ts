import { describe, expect, it } from "vitest";
import {
	addSub,
	dueSubs,
	markPinged,
	PUSH_SUB_LIMIT,
	type PushSub,
	rearmUser,
	removeSub,
	settle,
	userCount,
} from "../worker/pushSubs.js";

const DAY = 24 * 60 * 60 * 1000;

const sub = (endpoint: string, userId = "a", pingedAt = 0): PushSub => ({
	endpoint: `https://p.test/${endpoint}`,
	p256dh: "k",
	auth: "s",
	userId,
	pingedAt,
});

describe("push subscription list", () => {
	it("replaces an endpoint, keeps a user's newest three, and caps the room", () => {
		const first = [sub("1"), sub("2"), sub("3"), sub("4")];
		const next = addSub(first, sub("5"));
		expect(next.map((entry) => entry.endpoint)).toEqual(
			["2", "3", "4", "5"].map((id) => `https://p.test/${id}`),
		);
		// another user's slots are untouched by the eviction
		expect(addSub([sub("9", "b"), ...first], sub("5")).at(0)?.userId).toBe("b");
		// resubscribing the same endpoint moves it to the end, no duplicate
		expect(addSub(first, sub("1")).map((entry) => entry.endpoint)).toEqual(
			["2", "3", "4", "1"].map((id) => `https://p.test/${id}`),
		);
		const crowd = Array.from({ length: PUSH_SUB_LIMIT }, (_, i) =>
			sub(`c${i}`, `u${i}`),
		);
		const capped = addSub(crowd, sub("new", "z"));
		expect(capped).toHaveLength(PUSH_SUB_LIMIT);
		expect(capped.at(-1)?.endpoint).toBe("https://p.test/new");
		expect(capped.at(0)?.endpoint).toBe("https://p.test/c1");
	});

	it("counts distinct users and keeps the same list when nothing changes", () => {
		const subs = [sub("1"), sub("2"), sub("3", "b")];
		expect(userCount(subs)).toBe(2);
		expect(removeSub(subs, "https://p.test/none")).toBe(subs);
		expect(removeSub(subs, "https://p.test/1")).toHaveLength(2);
		expect(rearmUser(subs, "a")).toBe(subs);
	});

	it("pings an absent subscriber once, then again after a day or a rejoin", () => {
		const now = 10 * DAY;
		const subs = [sub("1", "a"), sub("2", "b")];
		expect(dueSubs(subs, new Set(["b"]), now)).toEqual([subs[0]]);
		const marked = markPinged(subs, [sub("1")], now);
		expect(dueSubs(marked, new Set(), now + 1)).toEqual([marked[1]]);
		expect(dueSubs(marked, new Set(), now + DAY + 1)).toHaveLength(2);
		expect(rearmUser(marked, "a")[0]?.pingedAt).toBe(0);
	});

	it("prunes gone subscriptions and rearms failed ones", () => {
		const subs = [sub("ok", "a", 5), sub("gone", "b", 5), sub("down", "c", 5)];
		const settled = settle(
			subs,
			new Map([
				["https://p.test/ok", 201],
				["https://p.test/gone", 410],
				["https://p.test/down", 0],
			]),
		);
		expect(settled.map((entry) => [entry.endpoint, entry.pingedAt])).toEqual([
			["https://p.test/ok", 5],
			["https://p.test/down", 0],
		]);
		expect(settle(subs, new Map([["https://p.test/ok", 201]]))).toBe(subs);
	});
});
