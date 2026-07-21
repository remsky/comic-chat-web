// A joined room is its own history entry, so hardware back leaves the room instead of the app.

export interface RoomHistoryState {
	joined?: boolean;
}

export const JOINED_STATE: RoomHistoryState = { joined: true };

// true once the room's own entry is on the stack: back pops it, a rejoin replaces it
export function isJoinedEntry(state: unknown): boolean {
	return (
		typeof state === "object" &&
		state !== null &&
		(state as RoomHistoryState).joined === true
	);
}
