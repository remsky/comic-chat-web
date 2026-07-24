// Live room client entry: boots assets, wires the shell, and hands joins to the session.

import type { AvatarData } from "../engine/avatar.js";
import { AvatarAtlasCache } from "./avatarAssets.js";
import { BackdropCache } from "./backdropAssets.js";
import { loadCanvasFonts } from "./canvasText.js";
import { checkRadios, displayName, element } from "./dom.js";
import {
	trackVisibleViewport,
	wireMobilePanels,
	wireSidebarMore,
	wireSidebarResize,
} from "./layout.js";
import {
	BACKDROP_PACK,
	buildBackgroundTile,
	buildCharacterTile,
} from "./pickerTiles.js";
import { setDesiredRoom, wireRoomList } from "./roomDirectory.js";
import {
	joinRoom,
	type SessionDeps,
	type SessionHooks,
} from "./roomSession.js";
import { RoomView } from "./roomView.js";
import {
	clearStoredProfile,
	loadStoredProfile,
	MODERN_TWEAKS_KEY,
	saveStoredProfile,
	TEXT_VIEW_KEY,
	takeRoomSwitch,
} from "./storage.js";

interface TabBadgeController {
	markUnread: () => void;
	clearUnread: () => void;
}

function wireTabUnreadBadge(): TabBadgeController {
	const baseTitle = document.title;
	let unreadCount = 0;
	const badgeHrefByCount = new Map<number, Promise<string>>();
	const dynamicFavicon = document.createElement("link");
	dynamicFavicon.rel = "icon";
	dynamicFavicon.type = "image/png";

	const buildBadgeHref = async (count: number): Promise<string> => {
		const image = new Image();
		const loaded = new Promise<void>((resolve, reject) => {
			image.addEventListener("load", () => resolve());
			image.addEventListener("error", () =>
				reject(new Error("favicon load failed")),
			);
		});
		image.src = "/favicon-32x32.png";
		await loaded;
		const canvas = document.createElement("canvas");
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("favicon context missing");
		context.drawImage(image, 0, 0, 32, 32);
		context.beginPath();
		context.arc(24, 8, 6, 0, Math.PI * 2);
		context.fillStyle = "#d30000";
		context.fill();
		context.strokeStyle = "#ffffff";
		context.lineWidth = 2;
		context.stroke();
		context.fillStyle = "#ffffff";
		context.font = "bold 7px sans-serif";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(count > 9 ? "9+" : String(count), 24, 8);
		return canvas.toDataURL("image/png");
	};

	const clearUnread = (): void => {
		unreadCount = 0;
		document.title = baseTitle;
		dynamicFavicon.remove();
	};

	const renderUnread = (): void => {
		if (unreadCount < 1 || !document.hidden) return;
		document.title = `(${unreadCount}) ${baseTitle}`;
		if (!badgeHrefByCount.has(unreadCount))
			badgeHrefByCount.set(unreadCount, buildBadgeHref(unreadCount));
		const badgeHrefPromise = badgeHrefByCount.get(unreadCount);
		if (!badgeHrefPromise) return;
		void badgeHrefPromise
			.then((href) => {
				if (unreadCount < 1 || !document.hidden) return;
				dynamicFavicon.href = href;
				if (!dynamicFavicon.isConnected) document.head.append(dynamicFavicon);
			})
			.catch(() => {
				// title marker still indicates unread when favicon rendering fails
			});
	};

	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) clearUnread();
		else renderUnread();
	});
	window.addEventListener("focus", clearUnread);

	return {
		markUnread: () => {
			if (!document.hidden) return;
			unreadCount += 1;
			renderUnread();
		},
		clearUnread,
	};
}

function wireJoinForm(avatars: AvatarData[], atlases: AvatarAtlasCache): void {
	const picker = element<HTMLFieldSetElement>("join-avatar");
	const options = picker.querySelector<HTMLElement>(".character-options");
	if (!options) throw new Error("character picker is missing its options");
	for (const avatar of avatars) {
		const label = buildCharacterTile(avatar, atlases, "avatar");
		// no default pick; selection is required, enforced inline on submit
		label.querySelector("input")?.addEventListener("change", () => {
			element("join-avatar-error").hidden = true;
		});
		options.append(label);
	}
}

// the in-room picker; the live session fills the hooks in
function wireProfilePicker(
	avatars: AvatarData[],
	atlases: AvatarAtlasCache,
	hooks: SessionHooks,
): (avatarID: number) => void {
	const nameInput = element<HTMLInputElement>("profile-name");
	const options = element("profile-avatar-options");
	options.append(
		...avatars.map((avatar) =>
			buildCharacterTile(avatar, atlases, "profile-avatar"),
		),
	);
	const picker = element("profile-avatar-picker");
	const editButton = element<HTMLButtonElement>("avatar-edit");
	const setPickerOpen = (open: boolean): void => {
		picker.classList.toggle("open", open);
		editButton.setAttribute("aria-expanded", String(open));
		if (open)
			picker
				.querySelector("input:checked")
				?.closest("label")
				?.scrollIntoView({ block: "nearest" });
	};
	editButton.addEventListener("click", () => {
		setPickerOpen(!picker.classList.contains("open"));
	});
	const submitName = (): void => {
		hooks.applyProfile?.(nameInput.value, Number.NaN);
	};
	element("profile-name-apply").addEventListener("click", submitName);
	nameInput.addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		submitName();
	});
	options.addEventListener("change", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		hooks.applyProfile?.(nameInput.value, Number(target.value));
		setPickerOpen(false);
	});
	element("profile-room-options").addEventListener("change", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		hooks.switchRoom?.(target.value);
	});
	return (avatarID) => checkRadios(options, String(avatarID));
}

// keeps the classic dropdown and the modern grid pointing at the same backdrop without resending it
function wireBackgroundPicker(
	backdrops: BackdropCache,
): (name: string) => void {
	const backgroundSelect = element<HTMLSelectElement>("background-select");
	const backgroundOptions = element("background-options");
	const syncBackground = (name: string): void => {
		backgroundSelect.value = name;
		checkRadios(backgroundOptions, name);
	};
	if (backdrops.backdrops.length === 0) return syncBackground;
	const none = document.createElement("option");
	none.value = "";
	none.textContent = "None";
	backgroundSelect.append(
		none,
		...backdrops.backdrops.map((info) => {
			const option = document.createElement("option");
			option.value = info.name;
			const pack = BACKDROP_PACK[info.name];
			option.textContent = pack
				? `${displayName(info.name)} (${pack})`
				: displayName(info.name);
			return option;
		}),
	);
	backgroundOptions.append(
		buildBackgroundTile("", "None", null, undefined),
		...backdrops.backdrops.map((info) =>
			buildBackgroundTile(
				info.name,
				displayName(info.name),
				info.url,
				BACKDROP_PACK[info.name],
			),
		),
	);
	// a grid pick drives the same change path as the dropdown, so one sender handles both
	backgroundOptions.addEventListener("change", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || target.name !== "background")
			return;
		backgroundSelect.value = target.value;
		backgroundSelect.dispatchEvent(new Event("change"));
	});
	syncBackground("");
	element("background-picker").hidden = false;
	const backgroundButton = document.querySelector<HTMLButtonElement>(
		'.toolbar-button[data-panel="bg"]',
	);
	if (backgroundButton) backgroundButton.hidden = false;
	return syncBackground;
}

async function main(): Promise<void> {
	const status = element("status");
	const tabBadge = wireTabUnreadBadge();
	trackVisibleViewport();
	wireMobilePanels();
	wireSidebarMore();
	wireSidebarResize();
	await loadCanvasFonts();
	const response = await fetch("/assets/avatars/manifest.json");
	if (!response.ok)
		throw new Error(`failed to load avatar manifest: ${response.status}`);
	const manifest = (await response.json()) as { avatars: AvatarData[] };
	const atlases = new AvatarAtlasCache();
	const backdrops = new BackdropCache();
	await Promise.all([atlases.preload(manifest.avatars), backdrops.load()]);
	wireJoinForm(manifest.avatars, atlases);

	const hooks: SessionHooks = {
		applyProfile: null,
		switchRoom: null,
		refreshRooms: null,
		onBack: null,
	};
	wireRoomList(() => hooks.refreshRooms);
	const avatarDisplayName = (avatarID: number): string => {
		const cast = manifest.avatars.find(
			(avatar) => avatar.avatarID === avatarID,
		);
		return cast ? displayName(cast.name) : `#${avatarID}`;
	};

	// a remembered identity prefills the connect screen
	const rememberInput = element<HTMLInputElement>("join-remember");
	const storedProfile = loadStoredProfile();
	if (storedProfile) {
		rememberInput.checked = true;
		element<HTMLInputElement>("join-name").value = storedProfile.name;
		const remembered = document.querySelector<HTMLInputElement>(
			`#join-avatar input[value="${storedProfile.avatar}"]`,
		);
		if (remembered) remembered.checked = true;
	}

	const syncProfileAvatar = wireProfilePicker(manifest.avatars, atlases, hooks);
	const syncBackground = wireBackgroundPicker(backdrops);
	status.dataset.ready = "true";

	const tweaks = element<HTMLInputElement>("modern-toggle");
	tweaks.checked = localStorage.getItem(MODERN_TWEAKS_KEY) !== "off";
	document.body.classList.toggle("modern-tweaks", tweaks.checked);
	const view = new RoomView(
		atlases,
		backdrops,
		manifest.avatars,
		element("panels"),
		element("strip"),
		tweaks.checked,
	);
	tweaks.addEventListener("change", () => {
		localStorage.setItem(MODERN_TWEAKS_KEY, tweaks.checked ? "on" : "off");
		document.body.classList.toggle("modern-tweaks", tweaks.checked);
		// the grid may have missed a dropdown-driven change while it was hidden
		if (tweaks.checked)
			syncBackground(element<HTMLSelectElement>("background-select").value);
		view.setModernTweaks(tweaks.checked);
	});

	// ID_VIEW_COMICS / ID_VIEW_TEXT: one strip pane, two renderings
	const textToggle = element<HTMLInputElement>("text-toggle");
	textToggle.checked = localStorage.getItem(TEXT_VIEW_KEY) === "on";
	document.body.classList.toggle("text-view", textToggle.checked);
	textToggle.addEventListener("change", () => {
		localStorage.setItem(TEXT_VIEW_KEY, textToggle.checked ? "on" : "off");
		document.body.classList.toggle("text-view", textToggle.checked);
		const strip = element("strip");
		strip.scrollTop = strip.scrollHeight;
	});

	// bound once: a refused join hands the form back, so the submit handler can rerun
	window.addEventListener("popstate", () => hooks.onBack?.());

	const deps: SessionDeps = {
		view,
		avatars: manifest.avatars,
		atlases,
		hooks,
		avatarDisplayName,
		syncProfileAvatar,
		syncBackground,
		onIncomingChat: (entry, localAvatar, localName) => {
			// shareable avatars: only our own seat (avatar + name) suppresses the badge
			if (
				localAvatar !== null &&
				entry.avatar === localAvatar &&
				entry.name === localName
			)
				return;
			tabBadge.markUnread();
		},
	};

	const form = element<HTMLFormElement>("join-form");
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const room =
			form.querySelector<HTMLInputElement>('input[name="room"]:checked')
				?.value ?? "";
		const name = element<HTMLInputElement>("join-name").value.trim();
		const avatar = Number(
			form.querySelector<HTMLInputElement>('input[name="avatar"]:checked')
				?.value,
		);
		if (!room || !name) return;
		// inline requirement instead of a native bubble, which auto-scrolls the picker jarringly
		const avatarError = element("join-avatar-error");
		if (Number.isNaN(avatar)) {
			avatarError.hidden = false;
			return;
		}
		avatarError.hidden = true;
		element("join-name-error").hidden = true;
		const remember = rememberInput.checked;
		if (remember) saveStoredProfile({ name, avatar });
		else clearStoredProfile();
		joinRoom(deps, { room, name, avatar, remember });
	});

	// a room switch rejoins on the far side of the reload, announcing where we came from
	const pending = takeRoomSwitch();
	if (
		pending &&
		new URLSearchParams(location.search).get("room") === pending.room
	) {
		setDesiredRoom(pending.room);
		element<HTMLInputElement>("join-name").value = pending.name;
		const carried = document.querySelector<HTMLInputElement>(
			`#join-avatar input[value="${pending.avatar}"]`,
		);
		if (carried) carried.checked = true;
		joinRoom(deps, {
			room: pending.room,
			name: pending.name,
			avatar: pending.avatar,
			from: pending.from,
			remember: loadStoredProfile() !== null,
		});
	}
}

main().catch((error: unknown) => {
	const status = document.getElementById("status");
	if (status)
		status.textContent = error instanceof Error ? error.message : String(error);
	throw error;
});
