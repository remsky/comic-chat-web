// Per-person seats over a shared sprite cast: each seat wraps a sprite's art under a distinct engine id.

import {
	type AvatarData,
	type AvatarRegistry,
	createAvatar,
} from "../engine/avatar.js";

// seat ids start well past the sprite ids (1..CAST_SIZE) so the two id spaces never collide
export const SEAT_BASE = 1000;

// one seat per person per avatar, so replayed panels keep the art they were drawn with; unattributed history (userId "") already keys per-sprite
export function seatKey(userId: string, avatar: number): string {
	return userId !== "" ? `u:${userId}:${avatar}` : `s:${avatar}`;
}

// One engine avatar per person, so two people wearing the same character share a panel instead of splitting it.
export class SeatBook {
	private readonly idByKey = new Map<string, number>();
	private readonly seats = new Map<
		number,
		{ userId: string; sprite: number }
	>();
	private nextID = SEAT_BASE;

	constructor(
		private readonly registry: AvatarRegistry,
		private readonly sprites: readonly AvatarData[],
	) {}

	resolve(key: string, userId: string, sprite: number): number {
		const known = this.idByKey.get(key);
		let id = known;
		let seat = known === undefined ? undefined : this.seats.get(known);
		if (id === undefined || seat === undefined) {
			id = this.nextID++;
			seat = { userId, sprite: -1 };
			this.idByKey.set(key, id);
			this.seats.set(id, seat);
		}
		if (seat.sprite !== sprite) {
			seat.sprite = sprite;
			this.rebuild(id, sprite);
		}
		return id;
	}

	userIdOf(id: number): string | undefined {
		return this.seats.get(id)?.userId;
	}

	spriteOf(id: number): number | undefined {
		return this.seats.get(id)?.sprite;
	}

	// build the seat's avatar from its sprite art (once per seat; a seat's sprite is now fixed)
	private rebuild(id: number, sprite: number): void {
		const src = this.sprites.find((data) => data.avatarID === sprite);
		if (!src) return;
		const avatar = createAvatar({ ...src, avatarID: id });
		const at = this.registry.avatars.findIndex((a) => a.avatarID === id);
		if (at >= 0) this.registry.avatars[at] = avatar;
		else this.registry.avatars.push(avatar);
	}
}
