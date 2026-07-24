// Plain-text view line formatting (CTextView::TextLine, textview.cpp:271-357).

import type { RoomEntry } from "../protocol/room.js";

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
	entry: RoomEntry,
	avatarName?: (avatarID: number) => string,
): TranscriptLine | null {
	if (entry.type === "background")
		return {
			kind: "system",
			name: entry.by,
			body: `set the background to ${entry.name || "none"}`,
		};
	if (entry.type === "announce") {
		const { name, detail } = entry;
		if (entry.kind === "nick")
			return { kind: "system", name, body: `is now ${detail}` };
		if (entry.kind === "avatar")
			return {
				kind: "system",
				name,
				body: `changed avatar to ${avatarName?.(Number(detail)) ?? detail}`,
			};
		if (entry.kind === "depart")
			return { kind: "system", name, body: `left and went to ${detail}` };
		return { kind: "system", name, body: `is back from ${detail}` };
	}
	if (entry.text === "<Chr>") return null;
	const { name, text } = entry;
	if (entry.mode === 3) return { kind: "think", name, body: text };
	if (entry.mode === 2) return { kind: "whisper", name, body: text };
	if (entry.mode === 5) return { kind: "action", name, body: text };
	return { kind: "say", name, body: text };
}
