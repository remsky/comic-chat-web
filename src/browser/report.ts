// A content report the reporter files themselves: the transcript already on their screen, nothing newly collected.

import type { RoomEntry } from "../protocol/room.js";
import {
	type TranscriptLine,
	transcriptHeader,
	transcriptLine,
} from "./textView.js";

export const REPORT_HANDOFF_KEY = "comic-chat:report";

// what the deploy stamps onto the page, so a pasted report identifies the service to someone who has never seen it
export interface ReportContext {
	site?: string;
	contact?: string;
	jurisdiction?: string;
}

const RECORD_LINES = [
	"Host: Cloudflare. Connection records that could identify a sender are held by Cloudflare and obtained through its legal process. The operator keeps no request logs of its own.",
];

// think and whisper arrive from transcriptHeader with their own colon already
function speaker(line: TranscriptLine): string {
	if (line.kind === "system" || line.kind === "action") return `* ${line.name}`;
	return line.kind === "say" ? `${line.name}:` : transcriptHeader(line);
}

export function reportTranscript(
	room: string,
	entries: readonly RoomEntry[],
	avatarName: (avatarID: number) => string,
	capturedAt: string,
	context: ReportContext = {},
): string {
	const lines: string[] = [];
	for (const entry of entries) {
		const line = transcriptLine(entry, avatarName);
		if (!line) continue;
		const id = "userId" in entry && entry.userId ? ` (${entry.userId})` : "";
		// UTC so a reader in another country does not have to guess the offset
		const at = entry.at ? ` ${new Date(entry.at).toISOString()}` : "";
		lines.push(`[${entry.seq}${at}]${id} ${speaker(line)} ${line.body}`);
	}
	// an unconfigured deploy has no site or operator to name, so those lines are left out entirely
	const head = ["Comic Chat Web content report"];
	if (context.site) head.push(`Site: ${context.site}`);
	head.push(
		`Room: ${room}`,
		`Captured: ${capturedAt}`,
		`Events: ${lines.length}`,
	);
	head.push(...RECORD_LINES);
	if (context.contact) head.push(`Operator contact: ${context.contact}`);
	if (context.jurisdiction)
		head.push(`Operator jurisdiction: ${context.jurisdiction}`);
	return [
		...head,
		"",
		...lines,
		"",
		"Captured in the reporter's browser. Rooms hold only a short rolling window, so anything older has already been deleted.",
		"[n] is the room's event sequence, followed by the UTC time the room stored the event; older events may carry no time. Each (id) is a random identifier held in the sender's browser: it names no person and no account, but the same id means the same browser.",
	].join("\n");
}

// the snapshot crosses to the report page in the same tab, never over the wire
export function stashReport(store: Storage, draft: string): void {
	try {
		store.setItem(REPORT_HANDOFF_KEY, draft);
	} catch {}
}

// read once and cleared, so a stray tab is not left holding a transcript
export function takeReport(store: Storage): string {
	try {
		const draft = store.getItem(REPORT_HANDOFF_KEY) ?? "";
		store.removeItem(REPORT_HANDOFF_KEY);
		return draft;
	} catch {
		return "";
	}
}
