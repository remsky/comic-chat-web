import { env, runInDurableObject, SELF } from "cloudflare:test";
import { CAST_BOUNDS } from "../../src/protocol/castBounds.js";
import type {
	ComicAnnotation,
	ServerMessage,
} from "../../src/protocol/room.js";

export interface Inbox {
	next(type: ServerMessage["type"]): Promise<ServerMessage>;
}

// a valid neutral annotation for the seat's avatar, honoring the simple-avatar convention
export function annotationFor(avatar: number): ComicAnnotation {
	const bounds = CAST_BOUNDS[avatar - 1];
	return {
		faceIndex: 0,
		faceEmotionIndex: 9,
		faceIntensity: 0,
		torsoIndex: 0,
		torsoEmotionIndex: bounds?.type === "simple" ? 0 : 9,
		torsoIntensity: 0,
		requested: false,
		talkTos: [],
	};
}

export function chatMessage(text: string, avatar: number, mode = 1): string {
	return JSON.stringify({
		type: "chat",
		text,
		mode,
		annotation: annotationFor(avatar),
	});
}

// one room per test (allowlisted in vitest.config.ts): a shared DO's sockets outlive the test that opened them
export async function connect(
	room: string,
): Promise<{ socket: WebSocket; inbox: Inbox }> {
	const response = await SELF.fetch(
		`https://comic.test/api/rooms/${room}/websocket`,
		{ headers: { Upgrade: "websocket" } },
	);
	const socket = response.webSocket;
	if (!socket) throw new Error("room did not upgrade the connection");
	socket.accept();
	const queue: ServerMessage[] = [];
	const waiters: (() => void)[] = [];
	socket.addEventListener("message", (event) => {
		queue.push(JSON.parse(event.data as string) as ServerMessage);
		waiters.shift()?.();
	});
	// the stream interleaves joined/left broadcasts, so pull until the wanted frame surfaces
	const next = async (type: ServerMessage["type"]): Promise<ServerMessage> => {
		for (;;) {
			const index = queue.findIndex((message) => message.type === type);
			if (index >= 0) return queue.splice(index, 1)[0] as ServerMessage;
			await new Promise<void>((resolve) => waiters.push(resolve));
		}
	};
	return { socket, inbox: { next } };
}

export async function join(
	room: string,
	name: string,
	avatar: number,
	from?: string,
) {
	const { socket, inbox } = await connect(room);
	socket.send(
		JSON.stringify({ type: "join", name, avatar, ...(from ? { from } : {}) }),
	);
	const welcome = await inbox.next("welcome");
	if (welcome.type !== "welcome") throw new Error("expected a welcome");
	return { socket, inbox, welcome };
}

// backfills old lines straight through SQL: the rate limit makes a >50-entry log unsendable over the wire
export async function seedLines(room: string, count: number): Promise<void> {
	const stub = env.CHAT_ROOM.getByName(room);
	await runInDurableObject(stub, (_instance, state) => {
		for (let index = 0; index < count; index++)
			state.storage.sql.exec(
				"INSERT INTO events (event_type, avatar, name, text, mode, face_index, face_emotion_index, face_intensity_tenths, torso_index, torso_emotion_index, torso_intensity_tenths, requested, talk_tos_json, background_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				"chat",
				1,
				"seed",
				`line ${index}`,
				1,
				0,
				9,
				0,
				0,
				9,
				0,
				0,
				"[]",
				null,
				Date.now(),
			);
	});
}
