// Plain-text view line formatting (CTextView::TextLine, textview.cpp:271-357).

import {
	ARRIVE_MODE,
	AVATAR_MODE,
	BACKGROUND_MODE,
	type ChatEntry,
	DEPART_MODE,
	NICK_MODE,
} from "../protocol/room.js";

export interface TranscriptLine {
	kind: "say" | "think" | "whisper" | "action" | "system";
	name: string;
	body: string;
}

// think/whisper carry the ID_THINK_PREFIX/ID_WHISPER_PREFIX header; say is the bare name
export function transcriptHeader(line: TranscriptLine): string {
	if (line.kind === "think") return `${line.name} thinks:`;
	if (line.kind === "whisper") return `${line.name} whispers:`;
	return line.name;
}

// <Chr> pose-change lines are skipped in text mode (textview.cpp:274-275)
export function transcriptLine(
	entry: ChatEntry,
	avatarName?: (avatarID: number) => string,
): TranscriptLine | null {
	if (entry.text === "<Chr>") return null;
	const { name, text } = entry;
	if (entry.mode === BACKGROUND_MODE)
		return {
			kind: "system",
			name,
			body: `set the background to ${text || "none"}`,
		};
	if (entry.mode === NICK_MODE)
		return { kind: "system", name, body: `is now ${text}` };
	if (entry.mode === AVATAR_MODE)
		return {
			kind: "system",
			name,
			body: `changed avatar to ${avatarName?.(Number(text)) ?? text}`,
		};
	if (entry.mode === DEPART_MODE)
		return { kind: "system", name, body: `left and went to ${text}` };
	if (entry.mode === ARRIVE_MODE)
		return { kind: "system", name, body: `is back from ${text}` };
	if (entry.mode === 3) return { kind: "think", name, body: text };
	if (entry.mode === 2) return { kind: "whisper", name, body: text };
	if (entry.mode === 5) return { kind: "action", name, body: text };
	return { kind: "say", name, body: text };
}
