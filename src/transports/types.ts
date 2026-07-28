// Transport seam: a session speaks ClientMessage/ServerMessage and never touches sockets.

import type { ClientMessage, ServerMessage } from "../protocol/room.js";

export type TransportStatus =
	| { kind: "connecting" }
	| { kind: "suspect" }
	| { kind: "recovered" }
	| { kind: "reconnecting" }
	| { kind: "closed"; detail: string };

export interface TransportHandlers {
	// re-join payload for every (re)connect; the session supplies its live identity
	buildJoin: () => ClientMessage;
	onMessage: (message: ServerMessage) => void;
	onStatus: (status: TransportStatus) => void;
}

export interface RoomTransport {
	connect(): void;
	send(message: ClientMessage): boolean;
	isOpen(): boolean;
	// halt reconnects but leave the socket to page teardown (room switch navigation)
	stop(): void;
	close(code?: number, reason?: string): void;
}
