// One live room session: the WebSocket join, reconnect loop, composer, and roster.

import type { AvatarData } from "../engine/avatar.js";
import {
	CHAT_MODES,
	type ChatMode,
	HISTORY_CHUNK,
	MESSAGE_BLOCKED_REASON,
	NAME_BLOCKED_REASON,
	parseServerMessage,
	RATE_LIMIT_REASON,
	type RoomEntry,
	type RosterEntry,
} from "../protocol/room.js";
import type { AvatarAtlasCache } from "./avatarAssets.js";
import { BodyCamWidget } from "./bodycamWidget.js";
import { displayName, element, nearBottom } from "./dom.js";
import { buildRoomOption } from "./pickerTiles.js";
import { fetchRoomListings } from "./roomDirectory.js";
import { isJoinedEntry, JOINED_STATE } from "./roomHistory.js";
import type { RoomView } from "./roomView.js";
import {
	clearRoomSwitch,
	clearStoredProfile,
	saveStoredProfile,
	storeRoomSwitch,
} from "./storage.js";
import { transcriptHeader, transcriptLine } from "./textView.js";
import {
	describeWebSocketClose,
	historyHasGap,
	reconnectDelay,
	shouldReconnect,
} from "./websocketReconnect.js";

// client mirror of the server send bucket (worker/room.ts): kill Enter-mashing before it hits the wire
const SEND_BURST = 5;
const SEND_REFILL_MS = 1000;
// liveness: a send expects a reply frame; the composer greys out fast, the pipe is declared dead a beat later
const HEARTBEAT_MS = 10_000;
const SUSPECT_MS = 1_200;
const RESPONSE_TIMEOUT_MS = 4_000;

// filled in by the live session so the shell's pickers and back handling reach it
export interface SessionHooks {
	applyProfile: ((name: string, avatar: number) => void) | null;
	switchRoom: ((to: string) => void) | null;
	refreshRooms: (() => void) | null;
	onBack: (() => void) | null;
}

export interface SessionDeps {
	view: RoomView;
	avatars: AvatarData[];
	atlases: AvatarAtlasCache;
	hooks: SessionHooks;
	avatarDisplayName: (avatarID: number) => string;
	syncProfileAvatar: (avatarID: number) => void;
	syncBackground: (name: string) => void;
}

export interface JoinOptions {
	room: string;
	name: string;
	avatar: number;
	from?: string;
	remember: boolean;
}

function renderTranscript(
	list: HTMLOListElement,
	entries: readonly RoomEntry[],
	avatarName: (avatarID: number) => string,
): void {
	const items: HTMLLIElement[] = [];
	for (const entry of entries) {
		const line = transcriptLine(entry, avatarName);
		if (!line) continue;
		const item = document.createElement("li");
		item.className = `transcript-${line.kind}`;
		if (line.kind === "system") {
			item.textContent = `${line.name} ${line.body}`;
		} else {
			const header = document.createElement("strong");
			header.textContent = transcriptHeader(line);
			item.append(header, ` ${line.body}`);
		}
		items.push(item);
	}
	list.replaceChildren(...items);
}

function renderRoster(roster: RosterEntry[], avatars: AvatarData[]): void {
	const list = element<HTMLUListElement>("roster");
	const items = roster.map((entry) => {
		const cast = avatars.find((avatar) => avatar.avatarID === entry.avatar);
		const item = document.createElement("li");
		const name = document.createElement("strong");
		name.textContent = entry.name;
		const character = document.createElement("span");
		character.textContent = ` ${displayName(cast?.name ?? "?")}`;
		item.append(name, character);
		return item;
	});
	if (items.length === 0) {
		const empty = document.createElement("li");
		empty.textContent = "Nobody here yet.";
		items.push(empty);
	}
	list.replaceChildren(...items);
}

// a refused join hands the form back for a resubmit; aborting drops the dead session's listeners
let sessionAbort: AbortController | null = null;

export function joinRoom(deps: SessionDeps, options: JoinOptions): void {
	const { view, hooks } = deps;
	const { room, name, avatar, from, remember } = options;
	sessionAbort?.abort();
	sessionAbort = new AbortController();
	const { signal } = sessionAbort;
	const status = element("status");
	element<HTMLFormElement>("join-form")
		.querySelector("button")
		?.setAttribute("disabled", "");
	// a joined room is its own history entry, so hardware back leaves the room
	const url = `?room=${encodeURIComponent(room)}`;
	if (isJoinedEntry(history.state)) history.replaceState(JOINED_STATE, "", url);
	else history.pushState(JOINED_STATE, "", url);
	const protocol = location.protocol === "https:" ? "wss" : "ws";
	const socketUrl = `${protocol}://${location.host}/api/rooms/${room}/websocket`;
	let socket: WebSocket | null = null;
	let reconnectTimer: number | undefined;
	let reconnectAttempt = 0;
	let reconnectAllowed = true;
	let heartbeatTimer: number | undefined;
	let watchdogTimer: number | undefined;
	let suspectTimer: number | undefined;
	let seatAvatar: number | null = null;
	// the live identity; profile changes move it, reconnects re-join with it
	let currentName = name;
	// announced once: the first welcome consumes it so reconnects don't re-arrive
	let announceFrom = from;
	let hasWelcomed = false;
	let joinFailed = false;
	let noticeTimer: number | undefined;
	let filterTimer: number | undefined;
	let lastComposerSend: string | null = null;
	let roster: RosterEntry[] = [];
	const scroller = element("strip");
	const composer = element<HTMLFormElement>("composer");
	const composerInput = element<HTMLInputElement>("composer-text");
	const profileNameInput = element<HTMLInputElement>("profile-name");
	const setComposerEnabled = (enabled: boolean): void => {
		for (const control of composer.querySelectorAll<
			HTMLInputElement | HTMLSelectElement | HTMLButtonElement
		>("input, select, button"))
			control.disabled = !enabled;
	};
	setComposerEnabled(false);

	// the composer doubles as the connection indicator: greyed with a hint while sends are unconfirmed
	const composerPlaceholder = composerInput.placeholder;
	let linkSuspect = false;
	let hintTimer: number | undefined;
	const setComposerHint = (hint: string | null, animate = false): void => {
		if (hintTimer !== undefined) {
			window.clearInterval(hintTimer);
			hintTimer = undefined;
		}
		composerInput.placeholder = hint ?? composerPlaceholder;
		if (hint === null || !animate) return;
		let dots = 0;
		hintTimer = window.setInterval(() => {
			dots = (dots + 1) % 4;
			composerInput.placeholder = hint + ".".repeat(dots);
		}, 400);
	};
	const lockComposer = (hint: string, animate = false): void => {
		setComposerEnabled(false);
		setComposerHint(hint, animate);
	};
	const unlockComposer = (): void => {
		setComposerHint(null);
		if (filterTimer === undefined) setComposerEnabled(true);
	};
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
		unlockComposer();
		// disabling dropped focus; hand it back so typing resumes
		const active = document.activeElement;
		if (active === null || active === document.body) composerInput.focus();
	};
	const armWatchdog = (): void => {
		if (watchdogTimer !== undefined) return;
		suspectTimer = window.setTimeout(() => {
			suspectTimer = undefined;
			linkSuspect = true;
			lockComposer("Connecting", true);
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

	let oldestSeq: number | null = null;
	let historyPending = false;
	let historyDone = false;

	const requestOlderHistory = (): void => {
		if (
			historyPending ||
			historyDone ||
			oldestSeq === null ||
			socket?.readyState !== WebSocket.OPEN
		)
			return;
		historyPending = true;
		wsSend(JSON.stringify({ type: "history", before: oldestSeq }));
	};
	scroller.addEventListener(
		"scroll",
		() => {
			if (scroller.scrollTop < 80) requestOlderHistory();
		},
		{ signal },
	);

	// cui.Say: run the presend hook, then transmit text plus the resolved annotation
	const sendChat = (text: string, mode: ChatMode): boolean => {
		if (socket?.readyState !== WebSocket.OPEN) return false;
		const annotation = view.prepareOutgoing(text, roster);
		if (!annotation) return false;
		return wsSend(
			JSON.stringify({
				type: "chat",
				text,
				mode,
				annotation,
				sent: Date.now(),
			}),
		);
	};

	const backgroundSelect = element<HTMLSelectElement>("background-select");
	backgroundSelect.addEventListener(
		"change",
		() => {
			wsSend(
				JSON.stringify({ type: "background", name: backgroundSelect.value }),
			);
		},
		{ signal },
	);

	const profileError = element("profile-error");
	hooks.applyProfile = (rawName, rawAvatar) => {
		if (socket?.readyState !== WebSocket.OPEN || seatAvatar === null) return;
		const nextName = rawName.trim() || currentName;
		const nextAvatar = Number.isNaN(rawAvatar) ? seatAvatar : rawAvatar;
		if (nextName === currentName && nextAvatar === seatAvatar) return;
		profileError.hidden = true;
		wsSend(
			JSON.stringify({ type: "profile", name: nextName, avatar: nextAvatar }),
		);
	};
	const renderProfileRooms = async (): Promise<void> => {
		const listings = await fetchRoomListings();
		if (!listings || listings.length === 0) return;
		element("profile-room-options").replaceChildren(
			...listings.map((listing) => {
				const option = buildRoomOption("profile-room", listing);
				const input = option.querySelector("input");
				if (input) input.checked = listing.name === room;
				return option;
			}),
		);
	};
	hooks.refreshRooms = () => void renderProfileRooms();
	hooks.switchRoom = (to) => {
		if (to === room) return;
		if (socket?.readyState === WebSocket.OPEN)
			wsSend(JSON.stringify({ type: "depart", to }));
		storeRoomSwitch({
			room: to,
			from: room,
			name: currentName,
			avatar: seatAvatar ?? avatar,
		});
		reconnectAllowed = false;
		if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
		// let the depart frame flush before navigation tears the socket down
		window.setTimeout(() => {
			location.href = `?room=${encodeURIComponent(to)}`;
		}, 150);
	};

	// reload is the clean teardown; only an explicit Disconnect forgets the remembered identity
	let forgetOnLeave = false;
	const leaveRoom = (): void => {
		if (forgetOnLeave) clearStoredProfile();
		clearRoomSwitch();
		reconnectAllowed = false;
		if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
		socket?.close();
		location.reload();
	};
	hooks.onBack = leaveRoom;
	// pop the room's own entry so every exit lands on the same pre-join state
	const exitRoom = (forget: boolean): void => {
		forgetOnLeave = forget;
		if (isJoinedEntry(history.state)) history.back();
		else leaveRoom();
	};
	element<HTMLButtonElement>("leave-room").addEventListener(
		"click",
		() => exitRoom(true),
		{ signal },
	);
	// the titlebar name doubles as a "home" link back to the connect screen
	element<HTMLButtonElement>("title-home").addEventListener(
		"click",
		() => exitRoom(false),
		{ signal },
	);

	element<HTMLButtonElement>("save-strip").addEventListener(
		"click",
		async () => {
			const blob = await view.exportPng();
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			const stamp = new Date().toISOString().slice(0, 16).replace(":", "-");
			anchor.download = `comic-chat-${room}-${stamp}.png`;
			anchor.click();
			URL.revokeObjectURL(url);
		},
		{ signal },
	);

	const transcript = element<HTMLOListElement>("transcript");
	const refreshTranscript = (): void => {
		const atBottom = nearBottom(scroller);
		renderTranscript(transcript, view.entriesView(), deps.avatarDisplayName);
		if (atBottom) scroller.scrollTop = scroller.scrollHeight;
	};

	let bodycam: BodyCamWidget | null = null;
	const mountBodycam = (): void => {
		element("bodycam").hidden = false;
		bodycam = new BodyCamWidget({
			canvas: element<HTMLCanvasElement>("bodycam-canvas"),
			atlases: deps.atlases,
			getAvatar: () => view.localAvatar(),
			setStatus: (text) => {
				element("bodycam-status").textContent = text ?? "";
			},
			sendExpression: () => sendChat("<Chr>", 1),
			forwardTyping: (key) => {
				composerInput.value += key;
				composerInput.focus();
			},
		});
		view.onComposed = () => {
			bodycam?.refresh();
			refreshTranscript();
		};
		view.onRebuilt = () => {
			bodycam?.restore();
			refreshTranscript();
		};
	};

	// a brief banner flash for dropped sends; the filter mute countdown owns the banner when active
	const flashNotice = (text: string): void => {
		if (filterTimer !== undefined) return;
		const notice = element("filter-notice");
		notice.textContent = text;
		notice.hidden = false;
		if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
		noticeTimer = window.setTimeout(() => {
			noticeTimer = undefined;
			notice.hidden = true;
		}, 2500);
	};
	// the server dropped the message: put the text back for a resend
	const notifyRateLimited = (): void => {
		if (lastComposerSend !== null && !composerInput.value)
			composerInput.value = lastComposerSend;
		lastComposerSend = null;
		flashNotice("Sending too fast; the last message was dropped.");
	};

	// the content filter rejected the message: lock the composer and count the mute down inline
	const notifyBlocked = (retryAfter: number | undefined): void => {
		if (lastComposerSend !== null && !composerInput.value)
			composerInput.value = lastComposerSend;
		lastComposerSend = null;
		const notice = element("filter-notice");
		if (noticeTimer !== undefined) {
			window.clearTimeout(noticeTimer);
			noticeTimer = undefined;
		}
		let remaining = Math.max(1, Math.ceil((retryAfter ?? 15_000) / 1000));
		const render = (): void => {
			notice.textContent = `Content filter: wait ${remaining}s before trying again.`;
		};
		const release = (): void => {
			if (filterTimer !== undefined) window.clearInterval(filterTimer);
			filterTimer = undefined;
			notice.hidden = true;
			if (socket?.readyState === WebSocket.OPEN) {
				setComposerEnabled(true);
				composerInput.focus();
			}
		};
		setComposerEnabled(false);
		notice.hidden = false;
		render();
		if (filterTimer !== undefined) window.clearInterval(filterTimer);
		filterTimer = window.setInterval(() => {
			remaining -= 1;
			if (remaining <= 0) release();
			else render();
		}, 1000);
	};

	// a refused join hands the form back instead of dead-ending in the status line
	const failJoin = (reason: string): void => {
		joinFailed = true;
		reconnectAllowed = false;
		socket?.close(1000, "join refused");
		const nameError = element("join-name-error");
		nameError.textContent =
			reason === NAME_BLOCKED_REASON
				? "That nickname is blocked. Try another."
				: `Couldn't join: ${reason}.`;
		nameError.hidden = false;
		element<HTMLFormElement>("join-form")
			.querySelector("button")
			?.removeAttribute("disabled");
	};

	const handleMessage = (message: MessageEvent): void => {
		// any frame (including the raw "pong") proves the socket is still alive
		clearWatchdog();
		const parsed = parseServerMessage(message.data);
		if (!parsed) return;
		if (parsed.type === "welcome") {
			const previousNewestSeq = view.entriesView().at(-1)?.seq ?? 0;
			const previousSeat = seatAvatar;
			document.body.classList.add("joined");
			element("title-room").textContent = `- ${room}`;
			status.textContent = "Connected.";
			status.dataset.ready = "true";
			if (filterTimer !== undefined) {
				window.clearInterval(filterTimer);
				filterTimer = undefined;
				element("filter-notice").hidden = true;
			}
			unlockComposer();
			reconnectAttempt = 0;
			roster = parsed.roster;
			renderRoster(roster, deps.avatars);
			seatAvatar = parsed.avatar;
			view.setLocalAvatarID(parsed.avatar);
			announceFrom = undefined;
			profileNameInput.value = currentName;
			deps.syncProfileAvatar(parsed.avatar);
			void renderProfileRooms();
			deps.syncBackground(parsed.background ?? "");
			const firstSeq = parsed.history[0]?.seq;
			if (!hasWelcomed || historyHasGap(previousNewestSeq, firstSeq)) {
				// first welcome, or the outage outran the chunk: recompose wholesale like a fresh join
				view.setHistoryBackground(
					parsed.historyBackground ?? parsed.background ?? "",
				);
				view.reset(parsed.history);
				oldestSeq = firstSeq ?? null;
				historyDone = parsed.history.length < HISTORY_CHUNK;
			} else {
				// missed entries resume the stream; any background entry among them brings the backdrop forward
				for (const entry of parsed.history)
					if (entry.seq > previousNewestSeq) view.compose(entry);
				if (oldestSeq === null) {
					oldestSeq = firstSeq ?? null;
					historyDone = parsed.history.length < HISTORY_CHUNK;
				}
			}
			historyPending = false;
			// a send that died with the old socket either arrived (it is in the replay) or goes back in the box
			if (hasWelcomed && lastComposerSend !== null) {
				const arrived = parsed.history.some(
					(entry) =>
						entry.type === "chat" &&
						entry.seq > previousNewestSeq &&
						entry.avatar === previousSeat &&
						entry.text === lastComposerSend,
				);
				if (!arrived && !composerInput.value)
					composerInput.value = lastComposerSend;
				lastComposerSend = null;
			}
			if (!bodycam) mountBodycam();
			hasWelcomed = true;
			refreshTranscript();
			composerInput.focus();
		} else if (parsed.type === "entry") {
			// our own echo confirms the last send arrived, so it no longer needs restoring
			if (
				parsed.entry.type === "chat" &&
				parsed.entry.avatar === seatAvatar &&
				parsed.entry.text === lastComposerSend
			)
				lastComposerSend = null;
			view.compose(parsed.entry);
			if (parsed.entry.type === "background")
				deps.syncBackground(parsed.entry.name);
		} else if (parsed.type === "history") {
			const previousHeight = scroller.scrollHeight;
			const previousTop = scroller.scrollTop;
			historyPending = false;
			if (parsed.entries.length === 0) {
				historyDone = true;
				return;
			}
			// the older chunk reaches further back, so the rebuild reseeds from its backdrop
			view.setHistoryBackground(parsed.background ?? "");
			view.prepend(parsed.entries);
			oldestSeq = parsed.entries[0]?.seq ?? oldestSeq;
			historyDone = parsed.entries.length < HISTORY_CHUNK;
			scroller.scrollTop =
				previousTop + (scroller.scrollHeight - previousHeight);
		} else if (parsed.type === "joined") {
			if (
				!roster.some(
					(entry) =>
						entry.avatar === parsed.who.avatar &&
						entry.name === parsed.who.name,
				)
			)
				roster.push(parsed.who);
			renderRoster(roster, deps.avatars);
		} else if (parsed.type === "left") {
			const index = roster.findIndex(
				(entry) =>
					entry.avatar === parsed.who.avatar && entry.name === parsed.who.name,
			);
			if (index >= 0) roster.splice(index, 1);
			renderRoster(roster, deps.avatars);
		} else if (parsed.type === "profile") {
			const index = roster.findIndex(
				(entry) =>
					entry.avatar === parsed.was.avatar && entry.name === parsed.was.name,
			);
			if (index >= 0) roster[index] = parsed.who;
			renderRoster(roster, deps.avatars);
			// seats are unique per avatar, so a matching seat means it was ours
			if (parsed.was.avatar === seatAvatar) {
				currentName = parsed.who.name;
				seatAvatar = parsed.who.avatar;
				view.setLocalAvatarID(seatAvatar);
				profileNameInput.value = currentName;
				deps.syncProfileAvatar(seatAvatar);
				if (remember)
					saveStoredProfile({ name: currentName, avatar: seatAvatar });
			}
		} else if (parsed.type === "error") {
			if (parsed.reason === RATE_LIMIT_REASON && hasWelcomed) {
				notifyRateLimited();
			} else if (parsed.reason === MESSAGE_BLOCKED_REASON && hasWelcomed) {
				notifyBlocked(parsed.retryAfter);
			} else if (parsed.reason === NAME_BLOCKED_REASON && hasWelcomed) {
				profileError.textContent = "That nickname is blocked. Try another.";
				profileError.hidden = false;
				profileNameInput.value = currentName;
			} else if (!hasWelcomed) {
				failJoin(parsed.reason);
			} else {
				status.textContent = parsed.reason;
				delete status.dataset.ready;
			}
		}
	};

	const connect = (): void => {
		if (reconnectTimer !== undefined) {
			window.clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}
		// a CLOSING socket still owns the shared timers; never race a replacement past it
		if (socket !== null && socket.readyState !== WebSocket.CLOSED) return;
		if (!hasWelcomed) {
			status.textContent = "Connecting…";
			delete status.dataset.ready;
		}
		const next = new WebSocket(socketUrl);
		socket = next;
		next.addEventListener("open", () => {
			wsSend(
				JSON.stringify({
					type: "join",
					name: currentName,
					avatar: seatAvatar ?? avatar,
					...(announceFrom !== undefined ? { from: announceFrom } : {}),
					sent: Date.now(),
				}),
			);
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
			historyPending = false;
			if (joinFailed) return;
			const detail = describeWebSocketClose(event.code, event.reason);
			const delay = reconnectDelay(reconnectAttempt);
			if (!shouldReconnect(event.code)) {
				reconnectAllowed = false;
				lockComposer(`Disconnected: ${detail}. Reload to rejoin.`);
				if (!hasWelcomed)
					status.textContent = `Disconnected: ${detail}. Reload to rejoin.`;
				return;
			}
			reconnectAttempt++;
			lockComposer("Reconnecting", true);
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
			if (socket === null && reconnectAllowed) {
				reconnectAttempt = 0;
				connect();
			}
		},
		{ signal },
	);
	connect();

	// client-side mirror of the server bucket: a mash drains tokens locally and toasts instead of flooding the wire
	let sendTokens = SEND_BURST;
	let sendAt = 0;
	const takeSendToken = (): boolean => {
		const now = Date.now();
		sendTokens = Math.min(
			SEND_BURST,
			sendTokens + (now - sendAt) / SEND_REFILL_MS,
		);
		sendAt = now;
		if (sendTokens < 1) return false;
		sendTokens -= 1;
		return true;
	};
	composer.addEventListener(
		"submit",
		(sendEvent) => {
			sendEvent.preventDefault();
			const mode = Number(element<HTMLSelectElement>("composer-mode").value);
			if (!(CHAT_MODES as readonly number[]).includes(mode)) return;
			if (!composerInput.value.trim()) return;
			// single flight: the previous send must echo back or fail before the next leaves
			if (lastComposerSend !== null) return;
			// composer is disabled while down, but guard anyway: never burn a token into a closed pipe
			if (socket?.readyState !== WebSocket.OPEN || !navigator.onLine) return;
			if (!takeSendToken()) {
				flashNotice("Slow down a moment.");
				return;
			}
			if (sendChat(composerInput.value, mode as ChatMode)) {
				lastComposerSend = composerInput.value;
				composerInput.value = "";
			}
		},
		{ signal },
	);
}
