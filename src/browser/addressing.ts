// Web stand-in for CAvatarX::SelectTalkTo (avatar.cpp:756): derive each speaker's addressees from message text so every client faces alike without an extra wire field.

import { isAlnum, toLowerAscii } from "../engine/ctype.js";

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
