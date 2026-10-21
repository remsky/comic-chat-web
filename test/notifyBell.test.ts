// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireNotifyBell } from "../src/browser/notify.js";
import { loadNotifyRooms, saveNotifyRooms } from "../src/browser/storage.js";

function mountBell(): { bell: HTMLButtonElement; text: HTMLElement } {
	document.body.innerHTML = `
		<button id="notify-bell" aria-pressed="false" hidden></button>
		<dialog id="notify-dialog"><p id="notify-dialog-text"></p></dialog>`;
	const dialog = document.querySelector("dialog") as HTMLDialogElement;
	// jsdom has no modal support; the test only cares that the dialog was asked to open
	dialog.showModal = vi.fn();
	return {
		bell: document.getElementById("notify-bell") as HTMLButtonElement,
		text: document.getElementById("notify-dialog-text") as HTMLElement,
	};
}

describe("notify bell", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(navigator, "serviceWorker");
	});

	it("stays hidden unless the welcome carries a push key", () => {
		const { bell } = mountBell();
		const control = wireNotifyBell();
		control.onWelcome({ room: "lobby", send: () => true });
		expect(bell.hidden).toBe(true);
		control.onWelcome({ room: "lobby", key: "BKey", send: () => true });
		expect(bell.hidden).toBe(false);
		expect(bell.getAttribute("aria-pressed")).toBe("false");
	});

	it("explains the install path where push is unsupported", () => {
		const { bell, text } = mountBell();
		const send = vi.fn(() => true);
		wireNotifyBell().onWelcome({ room: "lobby", key: "BKey", send });
		// jsdom exposes no PushManager, the same shape as a browser without push
		bell.click();
		expect(text.textContent).toMatch(/can't deliver notifications/i);
		expect(text.textContent).not.toMatch(/incognito/i);
		expect(send).not.toHaveBeenCalled();
	});

	it("keeps the pref on an unsubscribe until the server ack lands", async () => {
		const { bell } = mountBell();
		vi.stubGlobal("PushManager", class {});
		// permission-only stub: the welcome resync fails fast and is swallowed, leaving send() to the click
		vi.stubGlobal("Notification", { permission: "granted" });
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				getRegistration: async () => ({
					pushManager: {
						getSubscription: async () => ({
							endpoint: "https://push.test/sub",
						}),
					},
				}),
			},
		});
		saveNotifyRooms(["lobby"]);
		const send = vi.fn(() => true);
		const control = wireNotifyBell();
		control.onWelcome({ room: "lobby", key: "BKey", send });
		expect(bell.getAttribute("aria-pressed")).toBe("true");
		// the welcome resync rejects in microtasks on the bare stub; one macrotask clears busy
		await new Promise((resolve) => setTimeout(resolve, 0));
		bell.click();
		await vi.waitFor(() =>
			expect(send).toHaveBeenCalledWith({
				type: "unnotify",
				endpoint: "https://push.test/sub",
			}),
		);
		// a rate-limited unnotify is dropped server-side, so the click alone must not clear anything
		expect(loadNotifyRooms()).toContain("lobby");
		expect(bell.getAttribute("aria-pressed")).toBe("true");
		control.onAck(false);
		expect(loadNotifyRooms()).not.toContain("lobby");
		expect(bell.getAttribute("aria-pressed")).toBe("false");
	});
});
