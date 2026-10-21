// Per-room Web Push: the titlebar bell toggles a device subscription relayed over the live transport.

import { base64urlDecode } from "../protocol/base64url.js";
import type { ClientMessage } from "../protocol/room.js";
import { element } from "./dom.js";
import { loadNotifyRooms, saveNotifyRooms } from "./storage.js";

export interface NotifySession {
	room: string;
	// VAPID public key from the welcome; absent means the deploy cannot push
	key?: string | undefined;
	send: (message: ClientMessage) => boolean;
}

export interface NotifyBell {
	onWelcome: (session: NotifySession) => void;
	// server ack; only an off ack acts: a refusal or a completed unsubscribe turns the bell off
	onAck: (on: boolean) => void;
}

const supportsPush = (): boolean =>
	"serviceWorker" in navigator &&
	"PushManager" in window &&
	"Notification" in window;

// iPadOS reports MacIntel; the touch-point check catches it
const isIOS = (): boolean =>
	/iPad|iPhone|iPod/.test(navigator.userAgent) ||
	(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const INSTALL_IOS =
	"Notifications need Comic Chat on your Home Screen: tap Share, “Add to Home Screen”, then tap the bell from that icon.";
const INSTALL_OTHER =
	"This browser can't deliver notifications. Try a current Chrome, Edge, Firefox, or Safari.";
const BLOCKED =
	"Notifications are blocked for this site. Allow them in your browser's site settings; private windows can't subscribe.";

function sameKey(sub: PushSubscription, bytes: Uint8Array): boolean {
	const current = sub.options.applicationServerKey;
	if (!current || current.byteLength !== bytes.length) return false;
	return new Uint8Array(current).every((byte, index) => byte === bytes[index]);
}

// true once the subscription went out over the transport
async function subscribe(session: NotifySession): Promise<boolean> {
	if (!session.key) return false;
	if ((await Notification.requestPermission()) !== "granted") return false;
	await navigator.serviceWorker.register("/sw.js");
	const registration = await navigator.serviceWorker.ready;
	const bytes = base64urlDecode(session.key);
	let sub = await registration.pushManager.getSubscription();
	// a rotated server key invalidates the old subscription wholesale
	if (sub && !sameKey(sub, bytes)) {
		await sub.unsubscribe();
		sub = null;
	}
	sub ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: bytes,
	});
	const keys = sub.toJSON().keys;
	if (!keys?.p256dh || !keys.auth) return false;
	return session.send({
		type: "notify",
		endpoint: sub.endpoint,
		keys: { p256dh: keys.p256dh, auth: keys.auth },
	});
}

// the browser keeps its subscription (other rooms may use it); only this room's relay ends
async function currentEndpoint(): Promise<string | undefined> {
	const registration = await navigator.serviceWorker.getRegistration();
	return (await registration?.pushManager.getSubscription())?.endpoint;
}

export function wireNotifyBell(): NotifyBell {
	const bell = element<HTMLButtonElement>("notify-bell");
	const dialog = element<HTMLDialogElement>("notify-dialog");
	const explain = (text: string): void => {
		element("notify-dialog-text").textContent = text;
		dialog.showModal();
	};
	const setOn = (on: boolean): void => {
		bell.setAttribute("aria-pressed", String(on));
	};
	const remember = (room: string, on: boolean): void => {
		const rooms = loadNotifyRooms().filter((name) => name !== room);
		saveNotifyRooms(on ? [...rooms, room] : rooms);
		setOn(on);
	};

	let session: NotifySession | null = null;
	let busy = false;
	// a failed push-service round trip leaves the bell as it was; the next welcome resyncs
	const guarded = (task: Promise<unknown>): void => {
		busy = true;
		void task
			.catch(() => {})
			.finally(() => {
				busy = false;
			});
	};
	bell.addEventListener("click", () => {
		if (!session || busy) return;
		const active = session;
		if (!supportsPush()) {
			explain(isIOS() ? INSTALL_IOS : INSTALL_OTHER);
			return;
		}
		if (Notification.permission === "denied") {
			explain(BLOCKED);
			return;
		}
		const wasOn = bell.getAttribute("aria-pressed") === "true";
		guarded(
			wasOn
				? currentEndpoint().then((endpoint) => {
						// a sent unnotify may be dropped, so only the server's ack clears the pref
						if (endpoint) active.send({ type: "unnotify", endpoint });
						else remember(active.room, false);
					})
				: subscribe(active).then((ok) => {
						if (ok) remember(active.room, true);
						else if (Notification.permission === "denied") explain(BLOCKED);
					}),
		);
	});

	return {
		onWelcome: (next) => {
			session = next;
			bell.hidden = !next.key;
			if (!next.key) return;
			const on =
				supportsPush() &&
				Notification.permission === "granted" &&
				loadNotifyRooms().includes(next.room);
			setOn(on);
			// re-register silently: heals a pruned server copy and a rotated endpoint alike
			if (on && !busy) guarded(subscribe(next));
		},
		onAck: (on) => {
			// only downward: the server refusing a subscription outranks the optimistic bell
			if (!on && session && bell.getAttribute("aria-pressed") === "true")
				remember(session.room, false);
		},
	};
}
