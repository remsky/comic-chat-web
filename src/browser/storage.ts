// Browser-keyed persistence: identity, the room-switch breadcrumb, and UI preferences.

import { MAX_USER_ID_LENGTH } from "../protocol/room.js";

export const MODERN_TWEAKS_KEY = "comic-chat.modern-tweaks";
// the stable anonymous identity; unlike the profile it survives Disconnect, standing in for an account id
export const USER_ID_KEY = "comic-chat.user-id";
export const TEXT_VIEW_KEY = "comic-chat.text-view";
// draw a nick chip over every body, not just co-occupying ones; a busy-room readability aid
export const NAMETAGS_KEY = "comic-chat.nametags";
// opt-in identity, kept only while "Remember me" is on; Disconnect wipes it
export const PROFILE_KEY = "comic-chat.profile";
// one-shot breadcrumb across the room-switch reload; carries the origin for the arrival announcement
export const SWITCH_KEY = "comic-chat.switch";
// a UI preference, not identity; leaving a room keeps it
export const SIDEBAR_WIDTH_KEY = "comic-chat.sidebar-width";

// named capabilities; each derives from modern-tweaks today, ready to split onto its own key later
export interface Features {
	modernSizing: boolean;
	sharedAvatars: boolean;
	mentionAutocomplete: boolean;
	addressedGestures: boolean;
	gestureCommands: boolean;
}

export function loadFeatures(): Features {
	const modern = localStorage.getItem(MODERN_TWEAKS_KEY) !== "off";
	return {
		modernSizing: modern,
		sharedAvatars: modern,
		mentionAutocomplete: modern,
		addressedGestures: modern,
		gestureCommands: modern,
	};
}

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

export function loadUserId(): string {
	const stored = localStorage.getItem(USER_ID_KEY);
	if (
		stored !== null &&
		stored.length > 0 &&
		stored.length <= MAX_USER_ID_LENGTH
	)
		return stored;
	const minted = crypto.randomUUID();
	localStorage.setItem(USER_ID_KEY, minted);
	return minted;
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
