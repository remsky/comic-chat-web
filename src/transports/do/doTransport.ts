// Durable Object transport: WebSocket lifecycle, reconnect loop, heartbeat, liveness watchdog.

import { parseServerMessage } from "../../protocol/room.js";
import type { RoomTransport, TransportHandlers } from "../types.js";
import {
	describeWebSocketClose,
	reconnectDelay,
	shouldReconnect,
} from "./websocketReconnect.js";

// liveness: a send expects a reply frame; the composer greys out fast, the pipe is declared dead a beat later
const HEARTBEAT_MS = 10_000;
const SUSPECT_MS = 1_200;
const RESPONSE_TIMEOUT_MS = 4_000;

export function createDoTransport(
	socketUrl: string,
	handlers: TransportHandlers,
	signal: AbortSignal,
): RoomTransport {
	let socket: WebSocket | null = null;
	let reconnectTimer: number | undefined;
	let reconnectAttempt = 0;
	let heartbeatTimer: number | undefined;
	let watchdogTimer: number | undefined;
	let suspectTimer: number | undefined;
	let linkSuspect = false;
	// caller-initiated shutdown or a non-retryable close: no reconnects, no status noise
	let stopped = false;

	// liveness watchdog: a send arms it, any inbound frame disarms it; if it fires the pipe is dead
	const clearWatchdog = (): void => {
		if (suspectTimer !== undefined) {
			window.clearTimeout(suspectTimer);
			suspectTimer = undefined;
		}
		if (watchdogTimer !== undefined) {
			window.clearTimeout(watchdogTimer);
			watchdogTimer = undefined;
		}
		if (!linkSuspect) return;
		linkSuspect = false;
		if (socket?.readyState !== WebSocket.OPEN) return;
		handlers.onStatus({ kind: "recovered" });
	};
	const armWatchdog = (): void => {
		if (watchdogTimer !== undefined) return;
		suspectTimer = window.setTimeout(() => {
			suspectTimer = undefined;
			linkSuspect = true;
			handlers.onStatus({ kind: "suspect" });
		}, SUSPECT_MS);
		watchdogTimer = window.setTimeout(() => {
			watchdogTimer = undefined;
			if (socket?.readyState === WebSocket.OPEN)
				socket.close(4000, "connection lost");
		}, RESPONSE_TIMEOUT_MS);
	};
	// send on the live socket, then start waiting for the server's reply frame
	const wsSend = (data: string): boolean => {
		if (socket?.readyState !== WebSocket.OPEN) return false;
		socket.send(data);
		armWatchdog();
		return true;
	};

	const handleMessage = (message: MessageEvent): void => {
		// any frame (including the raw "pong") proves the socket is still alive
		clearWatchdog();
		const parsed = parseServerMessage(message.data);
		if (!parsed) return;
		// a welcome is a settled session, so backoff restarts from the fast end
		if (parsed.type === "welcome") reconnectAttempt = 0;
		handlers.onMessage(parsed);
	};

	const connect = (): void => {
		if (reconnectTimer !== undefined) {
			window.clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}
		// a CLOSING socket still owns the shared timers; never race a replacement past it
		if (socket !== null && socket.readyState !== WebSocket.CLOSED) return;
		handlers.onStatus({ kind: "connecting" });
		const next = new WebSocket(socketUrl);
		socket = next;
		next.addEventListener("open", () => {
			wsSend(JSON.stringify(handlers.buildJoin()));
			// idle ping so a dead-but-still-"open" pipe surfaces as a reconnect, not a silent swallow
			if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
			heartbeatTimer = window.setInterval(() => {
				if (next.readyState === WebSocket.OPEN) wsSend("ping");
			}, HEARTBEAT_MS);
		});
		next.addEventListener("message", handleMessage);
		next.addEventListener("close", (event) => {
			if (socket !== next) return;
			if (heartbeatTimer !== undefined) {
				window.clearInterval(heartbeatTimer);
				heartbeatTimer = undefined;
			}
			clearWatchdog();
			socket = null;
			if (stopped) return;
			const detail = describeWebSocketClose(event.code, event.reason);
			const delay = reconnectDelay(reconnectAttempt);
			if (!shouldReconnect(event.code)) {
				stopped = true;
				handlers.onStatus({ kind: "closed", detail });
				return;
			}
			reconnectAttempt++;
			handlers.onStatus({ kind: "reconnecting" });
			reconnectTimer = window.setTimeout(connect, delay);
		});
	};

	// the browser knows the network flipped before any timeout can
	window.addEventListener(
		"offline",
		() => {
			if (socket?.readyState === WebSocket.OPEN) socket.close(4000, "offline");
		},
		{ signal },
	);
	window.addEventListener(
		"online",
		() => {
			if (socket === null && !stopped) {
				reconnectAttempt = 0;
				connect();
			}
		},
		{ signal },
	);

	const stop = (): void => {
		stopped = true;
		if (reconnectTimer !== undefined) {
			window.clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}
	};

	return {
		connect,
		send: (message) => wsSend(JSON.stringify(message)),
		isOpen: () => socket?.readyState === WebSocket.OPEN,
		stop,
		close: (code, reason) => {
			stop();
			socket?.close(code, reason);
		},
	};
}
