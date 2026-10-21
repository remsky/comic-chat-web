// A room's Web Push subscriptions: pure list transforms plus the cached storage handle.

import { base64urlDecode } from "../src/protocol/base64url.js";
import type { PushTarget } from "./push.js";

// bounded like the socket limit: a room notifies at most this many devices, oldest subscription dropped first
export const PUSH_SUB_LIMIT = 32;
// one person cannot crowd the room's slots with minted endpoints
const PUSH_SUBS_PER_USER = 4;
// pings stay quiet this long delivered or not; rejoining rearms it sooner
const PUSH_REARM_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "push-subs";

export interface PushSub extends PushTarget {
	userId: string;
	// when the last ping went out; 0 means armed
	pingedAt: number;
}

export function userCount(subs: PushSub[]): number {
	return new Set(subs.map((sub) => sub.userId)).size;
}

export function addSub(subs: PushSub[], sub: PushSub): PushSub[] {
	const others = subs.filter((other) => other.endpoint !== sub.endpoint);
	const newestOfUser = new Set(
		others
			.filter((other) => other.userId === sub.userId)
			.slice(-(PUSH_SUBS_PER_USER - 1)),
	);
	return [
		...others.filter(
			(other) => other.userId !== sub.userId || newestOfUser.has(other),
		),
		sub,
	].slice(-PUSH_SUB_LIMIT);
}

// an unsubscribe, or the endpoints a fanout found gone (404/410)
export function removeSubs(
	subs: PushSub[],
	endpoints: ReadonlySet<string>,
): PushSub[] {
	const kept = subs.filter((sub) => !endpoints.has(sub.endpoint));
	return kept.length === subs.length ? subs : kept;
}

// absent users whose ping is armed
export function dueSubs(
	subs: PushSub[],
	connected: Set<string>,
	now: number,
): PushSub[] {
	return subs.filter(
		(sub) => !connected.has(sub.userId) && now - sub.pingedAt > PUSH_REARM_MS,
	);
}

export function markPinged(
	subs: PushSub[],
	due: PushSub[],
	now: number,
): PushSub[] {
	const endpoints = new Set(due.map((sub) => sub.endpoint));
	return subs.map((sub) =>
		endpoints.has(sub.endpoint) ? { ...sub, pingedAt: now } : sub,
	);
}

// the user is back, so their next absence may ping again
export function rearmUser(subs: PushSub[], userId: string): PushSub[] {
	if (!subs.some((sub) => sub.userId === userId && sub.pingedAt)) return subs;
	return subs.map((sub) =>
		sub.userId === userId ? { ...sub, pingedAt: 0 } : sub,
	);
}

// reject a point the curve rejects now, not on every future chat line
export async function validKeys(keys: {
	p256dh: string;
	auth: string;
}): Promise<boolean> {
	if (base64urlDecode(keys.auth).length !== 16) return false;
	try {
		await crypto.subtle.importKey(
			"raw",
			base64urlDecode(keys.p256dh),
			{ name: "ECDH", namedCurve: "P-256" },
			false,
			[],
		);
		return true;
	} catch {
		return false;
	}
}

// the slice of DurableObjectStorage used here, so the pure helpers above load without workerd types
interface Storage {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
}

export class PushStore {
	// lazy mirror of storage; null until the first push-touching message after a wake
	private cache: PushSub[] | null = null;

	constructor(
		private readonly storage: Storage,
		private readonly onUsers: (count: number) => void,
	) {}

	async load(): Promise<PushSub[]> {
		this.cache ??= (await this.storage.get<PushSub[]>(STORAGE_KEY)) ?? [];
		return this.cache;
	}

	async save(subs: PushSub[]): Promise<void> {
		const before = userCount(this.cache ?? []);
		this.cache = subs;
		await this.storage.put(STORAGE_KEY, subs);
		const after = userCount(subs);
		if (after !== before) this.onUsers(after);
	}
}
