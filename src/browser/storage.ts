// Browser-keyed persistence: identity, the room-switch breadcrumb, and UI preferences.

export const MODERN_TWEAKS_KEY = "comic-chat.modern-tweaks";
export const TEXT_VIEW_KEY = "comic-chat.text-view";
// opt-in identity, kept only while "Remember me" is on; Disconnect wipes it
export const PROFILE_KEY = "comic-chat.profile";
// one-shot breadcrumb across the room-switch reload; carries the origin for the arrival announcement
export const SWITCH_KEY = "comic-chat.switch";
// a UI preference, not identity; leaving a room keeps it
export const SIDEBAR_WIDTH_KEY = "comic-chat.sidebar-width";

export interface StoredProfile {
	name: string;
	avatar: number;
}

export function parseProfile(raw: string | null): StoredProfile | null {
	if (!raw) return null;
	try {
		const data = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof data === "object" &&
			data !== null &&
			typeof data.name === "string" &&
			data.name.length > 0 &&
			typeof data.avatar === "number"
		)
			return { name: data.name, avatar: data.avatar };
	} catch {
		// invalid JSON reads as absent
	}
	return null;
}

export function loadStoredProfile(): StoredProfile | null {
	return parseProfile(localStorage.getItem(PROFILE_KEY));
}

export function saveStoredProfile(profile: StoredProfile): void {
	localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearStoredProfile(): void {
	localStorage.removeItem(PROFILE_KEY);
}

export interface RoomSwitch extends StoredProfile {
	room: string;
	from: string;
}

// consume the breadcrumb; it must never replay on a plain reload
export function takeRoomSwitch(): RoomSwitch | null {
	const raw = sessionStorage.getItem(SWITCH_KEY);
	sessionStorage.removeItem(SWITCH_KEY);
	if (!raw) return null;
	try {
		const data = JSON.parse(raw) as Record<string, unknown>;
		const profile = parseProfile(raw);
		if (
			profile &&
			typeof data.room === "string" &&
			typeof data.from === "string"
		)
			return { ...profile, room: data.room, from: data.from };
	} catch {
		// invalid JSON reads as absent
	}
	return null;
}

export function storeRoomSwitch(pending: RoomSwitch): void {
	sessionStorage.setItem(SWITCH_KEY, JSON.stringify(pending));
}

export function clearRoomSwitch(): void {
	sessionStorage.removeItem(SWITCH_KEY);
}
