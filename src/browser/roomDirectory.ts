// The IRC LIST stand-in: fetches room listings and keeps the join-form grid fresh.

import { parseRoomListings, type RoomListing } from "../protocol/room.js";
import { element } from "./dom.js";
import { buildRoomOption } from "./pickerTiles.js";

// the room the user wants selected, honored once the directory options load
let desiredRoom = new URLSearchParams(location.search).get("room") ?? "";

export function setDesiredRoom(room: string): void {
	desiredRoom = room;
}

export async function fetchRoomListings(): Promise<RoomListing[] | null> {
	try {
		const response = await fetch("/api/rooms");
		return response.ok ? parseRoomListings(await response.json()) : null;
	} catch {
		return null;
	}
}

export async function refreshRoomList(): Promise<void> {
	const options = element("join-room-options");
	const listings = await fetchRoomListings();
	// keep current options on a failed refresh
	if (!listings || listings.length === 0) return;
	const keep =
		options.querySelector<HTMLInputElement>("input:checked")?.value ||
		desiredRoom;
	options.replaceChildren(
		...listings.map((listing) => buildRoomOption("room", listing)),
	);
	const radios = [...options.querySelectorAll<HTMLInputElement>("input")];
	const target = radios.find((input) => input.value === keep) ?? radios[0];
	if (target) target.checked = true;
	desiredRoom = "";
}

// slow poll keeps the visible stamps fresh; a joined session refreshes its own list instead
export function wireRoomList(joinedRefresh: () => (() => void) | null): void {
	window.setInterval(() => {
		if (document.hidden) return;
		if (document.body.classList.contains("joined")) joinedRefresh()?.();
		else void refreshRoomList();
	}, 30_000);
	void refreshRoomList();
}
