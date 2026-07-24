// Web stand-in for CAvatarX::SelectTalkTo (avatar.cpp:756): derive each speaker's addressees from message text so every client faces alike without an extra wire field.

import { isAlnum, toLowerAscii } from "../engine/ctype.js";
import { MAX_NAME_LENGTH } from "../protocol/room.js";

// nicks may hold spaces, so the name runs to the separator
const ADDRESS_PREFIX = new RegExp(
	`^\\s*([^:,]{1,${MAX_NAME_LENGTH}}?)\\s*[:,]\\s*`,
);

function mentionsName(lowerText: string, lowerName: string): boolean {
	if (lowerName.length < 2) return false;
	let loc = lowerText.indexOf(lowerName);
	while (loc >= 0) {
		const before = loc === 0 ? 0 : lowerText.charCodeAt(loc - 1);
		const afterIndex = loc + lowerName.length;
		const after =
			afterIndex >= lowerText.length ? 0 : lowerText.charCodeAt(afterIndex);
		if (!isAlnum(before) && !isAlnum(after)) return true;
		loc = lowerText.indexOf(lowerName, loc + 1);
	}
	return false;
}

// IRC-style highlight test: does the text name this nick at a word boundary (the same rule facing uses)
export function mentionsNick(text: string, name: string): boolean {
	return mentionsName(toLowerAscii(text), toLowerAscii(name));
}

// CheckStart only ever tests the very start of the line (textpose.cpp:306), so "jo: bye" greets nobody; dropping a known nick's prefix hands the rules the message itself
export function stripAddressPrefix(
	text: string,
	speakers: ReadonlyMap<string, number>,
): string {
	const match = ADDRESS_PREFIX.exec(text);
	if (!match?.[1] || !speakers.has(toLowerAscii(match[1]))) return text;
	return text.slice(match[0].length);
}

// avatarIDs the speaker addresses by name, minus themselves, in speaker-map order
export function parseAddressees(
	text: string,
	speakers: ReadonlyMap<string, number>,
	self: number,
): number[] {
	const lowerText = toLowerAscii(text);
	const ids: number[] = [];
	for (const [name, avatarID] of speakers) {
		if (avatarID === self || ids.includes(avatarID)) continue;
		if (mentionsName(lowerText, name)) ids.push(avatarID);
	}
	return ids;
}
