import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SeatBook, seatKey } from "../src/browser/seatBook.js";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import { PanelPage, type UnitPanel } from "../src/engine/panel.js";
import { MsvcRand } from "../src/engine/rand.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

function sharedPage(): {
	page: PanelPage;
	registry: AvatarRegistry;
	seats: SeatBook;
} {
	const registry = new AvatarRegistry([]);
	const seats = new SeatBook(registry, fixture.avatars);
	const page = new PanelPage({
		registry,
		rand: new MsvcRand(1515),
		unitWidth: 2300,
		unitHeight: 5400,
		hooks: { layoutBalloons: () => ({ fits: true }) },
	});
	return { page, registry, seats };
}

function speak(page: PanelPage, registry: AvatarRegistry, slot: number): void {
	const avatar = registry.get(slot);
	if (!avatar?.body) throw new Error(`seat ${slot} has no body`);
	avatar.body.requested = true;
	page.addLine(slot, "hi", 1);
}

function panels(page: PanelPage): UnitPanel[] {
	return page.panels.filter((panel): panel is UnitPanel => panel !== null);
}

describe("seat book", () => {
	it("keys a person's seat by userId, falling back to sprite for unattributed history", () => {
		expect(seatKey("u-alice", 1)).toBe("u:u-alice");
		expect(seatKey("", 5)).toBe("s:5");
	});

	it("gives two people on the same sprite distinct seats sharing that character's art", () => {
		const { seats } = sharedPage();
		const alice = seats.resolve(seatKey("u-alice", 1), "u-alice", 1);
		const bob = seats.resolve(seatKey("u-bob", 1), "u-bob", 1);
		expect(alice).not.toBe(bob);
		expect(seats.spriteOf(alice)).toBe(1);
		expect(seats.spriteOf(bob)).toBe(1);
		expect(seats.userIdOf(bob)).toBe("u-bob");
	});

	it("seats two same-sprite speakers together in one panel", () => {
		const { page, registry, seats } = sharedPage();
		const alice = seats.resolve(seatKey("u-alice", 1), "u-alice", 1);
		const bob = seats.resolve(seatKey("u-bob", 1), "u-bob", 1);
		speak(page, registry, alice);
		speak(page, registry, bob);
		const last = panels(page).at(-1);
		expect(last?.bodies.map((body) => body.avatarID).sort()).toEqual(
			[alice, bob].sort(),
		);
	});

	it("keeps one person's own back-to-back lines in separate panels", () => {
		const { page, registry, seats } = sharedPage();
		const alice = seats.resolve(seatKey("u-alice", 1), "u-alice", 1);
		speak(page, registry, alice);
		speak(page, registry, alice);
		const rendered = panels(page);
		expect(rendered).toHaveLength(2);
		for (const panel of rendered) {
			expect(panel.bodies).toHaveLength(1);
			expect(panel.bodies[0]?.avatarID).toBe(alice);
		}
	});

	it("swaps a seat's art under the same id when the person changes avatar", () => {
		const { registry, seats } = sharedPage();
		const seat = seats.resolve(seatKey("u-alice", 1), "u-alice", 1);
		expect(registry.get(seat)?.data.name).toBe("anna");
		const same = seats.resolve(seatKey("u-alice", 2), "u-alice", 2);
		expect(same).toBe(seat);
		expect(seats.spriteOf(seat)).toBe(2);
		expect(registry.get(seat)?.data.name).toBe("bolo");
	});
});
