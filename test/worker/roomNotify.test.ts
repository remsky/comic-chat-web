import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { base64urlEncode } from "../../src/protocol/base64url.js";
import { chatMessage, join } from "./helpers.js";

// a real P-256 point, since the room validates it and encrypts against it
async function subscription(path: string) {
	const pair = (await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveBits"],
	)) as CryptoKeyPair;
	const raw = new Uint8Array(
		(await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
	);
	return {
		endpoint: `https://push.test${path}`,
		keys: {
			p256dh: base64urlEncode(raw),
			auth: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
		},
	};
}

interface SentPush {
	url: string;
	headers: Record<string, string>;
	bytes: number;
	redirect?: string;
}

// tests share the worker's isolate, so stubbing global fetch catches the room's push deliveries
function stubPushFetch(status = 201, body: string | null = null): SentPush[] {
	const sent: SentPush[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown, init?: RequestInit) => {
			sent.push({
				url: String(input),
				headers: (init?.headers ?? {}) as Record<string, string>,
				bytes: ((init?.body ?? new Uint8Array()) as Uint8Array).length,
				redirect: init?.redirect,
			});
			return new Response(body, { status });
		}),
	);
	return sent;
}

async function storedSubs(
	room: string,
): Promise<{ endpoint: string; pingedAt?: number }[]> {
	const stub = env.CHAT_ROOM.getByName(room);
	return runInDurableObject(
		stub,
		async (_instance, state) =>
			(await state.storage.get<{ endpoint: string; pingedAt?: number }[]>(
				"push-subs",
			)) ?? [],
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("room push notifications", () => {
	it("pings an absent subscriber once, rearmed by rejoining", async () => {
		const sent = stubPushFetch();
		const bea = await join("notify", "Bea", 2);
		expect(bea.welcome.push).toBe(env.VAPID_PUBLIC_KEY);
		const alice = await join("notify", "Alice", 1);
		const sub = await subscription("/sub/alice");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		// the ack feeds the client's liveness watchdog; without it idle rooms reconnect-loop
		expect(await alice.inbox.next("notify")).toEqual({
			type: "notify",
			endpoint: sub.endpoint,
			on: true,
		});
		bea.socket.send(chatMessage("you still around?", 2));
		await bea.inbox.next("entry");
		alice.socket.close();
		await bea.inbox.next("left");
		bea.socket.send(chatMessage("gone now", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		// exactly one push: the line sent while Alice was connected stayed silent
		const push = sent[0] as SentPush;
		expect(push.url).toBe(sub.endpoint);
		expect(push.headers["Content-Encoding"]).toBe("aes128gcm");
		expect(push.headers.Topic).toBe("notify");
		expect(push.headers.Authorization).toMatch(/^vapid t=/);
		// a redirecting endpoint must not turn the room into a request relay
		expect(push.redirect).toBe("manual");
		// aes128gcm framing floor: salt + record size + sender key + tag
		expect(push.bytes).toBeGreaterThan(102);
		await vi.waitFor(async () =>
			expect((await storedSubs("notify"))[0]?.pingedAt).toBeTruthy(),
		);
		bea.socket.send(chatMessage("still gone, no second ping", 2));
		await bea.inbox.next("entry");
		expect(sent).toHaveLength(1);
		// rejoining clears the flag, so the next absence pings again
		const back = await join("notify", "Alice", 1);
		await vi.waitFor(async () =>
			expect((await storedSubs("notify"))[0]?.pingedAt).toBe(0),
		);
		back.socket.close();
		await bea.inbox.next("left");
		bea.socket.send(chatMessage("gone again", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(sent).toHaveLength(2));
	});

	it("sends one ping for a burst interleaved into the fanout", async () => {
		const calls: string[] = [];
		// a slow delivery leaves the fanout in flight across the second chat; a test-side gate would be cross-context I/O
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				calls.push(String(input));
				await new Promise((resolve) => setTimeout(resolve, 500));
				return new Response(null, { status: 201 });
			}),
		);
		const bea = await join("notify-burst", "Bea", 2);
		const alice = await join("notify-burst", "Alice", 1);
		const sub = await subscription("/sub/burst");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		alice.socket.close();
		await bea.inbox.next("left");
		bea.socket.send(chatMessage("one", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		bea.socket.send(chatMessage("two", 2));
		await bea.inbox.next("entry");
		expect(calls).toHaveLength(1);
	});

	it("pings the same absent subscriber again after 24 hours", async () => {
		const sent = stubPushFetch();
		const bea = await join("notify-rearm", "Bea", 2);
		const alice = await join("notify-rearm", "Alice", 1);
		const sub = await subscription("/sub/rearm");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		alice.socket.close();
		await bea.inbox.next("left");
		bea.socket.send(chatMessage("day one", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		// tests share the DO's isolate, so the room's clock moves with the mock
		const later = Date.now() + 25 * 60 * 60 * 1000;
		vi.spyOn(Date, "now").mockReturnValue(later);
		bea.socket.send(chatMessage("day two", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(sent).toHaveLength(2));
	});

	it("prunes a subscription the push service reports gone", async () => {
		stubPushFetch(410);
		const bea = await join("notify-prune", "Bea", 2);
		const alice = await join("notify-prune", "Alice", 1);
		const sub = await subscription("/sub/stale");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		alice.socket.close();
		await bea.inbox.next("left");
		bea.socket.send(chatMessage("hello?", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(async () =>
			expect(await storedSubs("notify-prune")).toHaveLength(0),
		);
	});

	it("pings a subscriber who tabbed away, rearmed when the tab shows", async () => {
		const sent = stubPushFetch();
		const bea = await join("notify-away", "Bea", 2);
		const alice = await join("notify-away", "Alice", 1);
		const sub = await subscription("/sub/away");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		alice.socket.send(JSON.stringify({ type: "away", on: true }));
		expect(await alice.inbox.next("away")).toEqual({ type: "away", on: true });
		bea.socket.send(chatMessage("psst", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		alice.socket.send(JSON.stringify({ type: "away", on: false }));
		expect(await alice.inbox.next("away")).toEqual({ type: "away", on: false });
		await vi.waitFor(async () =>
			expect((await storedSubs("notify-away"))[0]?.pingedAt).toBe(0),
		);
		// a visible seat is present: no ping, and the rearm waits for the next absence
		bea.socket.send(chatMessage("welcome back", 2));
		await bea.inbox.next("entry");
		expect(sent).toHaveLength(1);
	});

	it("leaves a failed delivery quiet until the normal rearm", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const sent = stubPushFetch(503, '{"reason":"Shutdown"}');
		const bea = await join("notify-down", "Bea", 2);
		const alice = await join("notify-down", "Alice", 1);
		const sub = await subscription("/sub/down");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		alice.socket.close();
		await bea.inbox.next("left");
		bea.socket.send(chatMessage("one", 2));
		await bea.inbox.next("entry");
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		await vi.waitFor(() =>
			expect(warn).toHaveBeenCalledWith(
				'push 503 from push.test: {"reason":"Shutdown"}',
			),
		);
		// the 503 leaves the stamp in place; a rearm would zero it once the 503 lands
		await vi.waitFor(async () =>
			expect((await storedSubs("notify-down"))[0]?.pingedAt).toBeTruthy(),
		);
		bea.socket.send(chatMessage("two", 2));
		await bea.inbox.next("entry");
		expect(sent).toHaveLength(1);
	});

	it("refuses a key that is not a curve point, and unnotify drops the rest", async () => {
		const alice = await join("notify-quiet", "Alice", 1);
		expect(alice.welcome.pushUsers).toBe(0);
		const bogus = {
			endpoint: "https://push.test/sub/bogus",
			keys: {
				p256dh: `B${"A".repeat(86)}`,
				auth: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
			},
		};
		alice.socket.send(JSON.stringify({ type: "notify", ...bogus }));
		expect(await alice.inbox.next("notify")).toEqual({
			type: "notify",
			endpoint: bogus.endpoint,
			on: false,
		});
		expect(await storedSubs("notify-quiet")).toHaveLength(0);
		const sub = await subscription("/sub/quiet");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		// a changed subscriber set is broadcast for the members panel
		expect(await alice.inbox.next("pushUsers")).toEqual({
			type: "pushUsers",
			count: 1,
		});
		expect(await storedSubs("notify-quiet")).toHaveLength(1);
		alice.socket.send(
			JSON.stringify({ type: "unnotify", endpoint: sub.endpoint }),
		);
		expect(await alice.inbox.next("notify")).toEqual({
			type: "notify",
			endpoint: sub.endpoint,
			on: false,
		});
		expect(await alice.inbox.next("pushUsers")).toEqual({
			type: "pushUsers",
			count: 0,
		});
		expect(await storedSubs("notify-quiet")).toHaveLength(0);
	});

	it("caps one user's subscriptions, newest kept", async () => {
		// seeded straight through storage: the send rate limit makes five wire subscribes unsendable
		const seeds = [0, 1, 2, 3].map((index) => ({
			endpoint: `https://push.test/sub/device-${index}`,
			p256dh: `B${"A".repeat(86)}`,
			auth: "A".repeat(22),
			userId: "u-Alice",
		}));
		await runInDurableObject(
			env.CHAT_ROOM.getByName("notify-cap"),
			(_instance, state) => state.storage.put("push-subs", seeds),
		);
		const alice = await join("notify-cap", "Alice", 1);
		const sub = await subscription("/sub/device-4");
		alice.socket.send(JSON.stringify({ type: "notify", ...sub }));
		await alice.inbox.next("notify");
		const stored = await storedSubs("notify-cap");
		expect(stored.map((entry) => entry.endpoint)).toEqual([
			"https://push.test/sub/device-1",
			"https://push.test/sub/device-2",
			"https://push.test/sub/device-3",
			sub.endpoint,
		]);
	});
});
