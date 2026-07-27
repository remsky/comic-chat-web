// Radio-tile builders for the character, background, and room pickers.

import type { AvatarData } from "../engine/avatar.js";
import { ART_PACKS, packOf } from "../protocol/castPacks.js";
import type { RoomListing } from "../protocol/room.js";
import type { AvatarAtlasCache } from "./avatarAssets.js";
import { displayName } from "./dom.js";

// backdrops a pack brought with it; base comicart ones stay unlabeled
export const BACKDROP_PACK: Record<string, string> = Object.fromEntries(
	ART_PACKS.flatMap((pack) =>
		pack.backdrops.map((name) => [name, pack.chip.label]),
	),
);

function radioTile(
	className: string,
	group: string,
	value: string,
): HTMLLabelElement {
	const label = document.createElement("label");
	label.className = className;
	const radio = document.createElement("input");
	radio.type = "radio";
	radio.name = group;
	radio.value = value;
	radio.autocomplete = "off";
	label.append(radio);
	return label;
}

function chip(tone: string, text: string): HTMLSpanElement {
	const badge = document.createElement("span");
	badge.className = `character-option-chip character-option-chip--${tone}`;
	badge.textContent = text;
	return badge;
}

// the 40x40 icon pose every atlas carries in its top-left corner
export function avatarIconCanvas(
	avatar: AvatarData,
	atlases: AvatarAtlasCache,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = 40;
	canvas.height = 40;
	canvas.setAttribute("aria-hidden", "true");
	const icon = avatar.poses.find((pose) => pose.poseID === avatar.iconPoseID);
	if (icon?.sprite)
		canvas
			.getContext("2d")
			?.drawImage(
				atlases.get(icon),
				icon.sprite.x,
				icon.sprite.y,
				icon.width,
				icon.height,
				0,
				0,
				40,
				40,
			);
	return canvas;
}

// data URLs so the icon survives selectedcontent's cloning, which blanks a canvas
const iconUrls = new Map<string, string>();

export function avatarIconUrl(
	avatar: AvatarData,
	atlases: AvatarAtlasCache,
): string {
	let url = iconUrls.get(avatar.name);
	if (url === undefined) {
		url = avatarIconCanvas(avatar, atlases).toDataURL();
		iconUrls.set(avatar.name, url);
	}
	return url;
}

export function buildCharacterTile(
	avatar: AvatarData,
	atlases: AvatarAtlasCache,
	group: string,
): HTMLLabelElement {
	const label = radioTile("character-option", group, String(avatar.avatarID));
	const canvas = avatarIconCanvas(avatar, atlases);
	const name = document.createElement("span");
	name.className = "character-option-name";
	name.textContent = displayName(avatar.name);
	const content = document.createElement("span");
	content.className = "character-option-content";
	content.append(canvas, name);
	const release = packOf(avatar.name)?.chip;
	if (release) content.append(chip(release.tone, release.label));
	label.append(content);
	return label;
}

export function buildBackgroundTile(
	value: string,
	label: string,
	url: string | null,
	pack: string | undefined,
): HTMLLabelElement {
	const option = radioTile("character-option", "background", value);
	const content = document.createElement("span");
	content.className = "character-option-content";
	let thumb: HTMLElement;
	if (url === null) {
		thumb = document.createElement("span");
		thumb.className = "background-thumb background-thumb--none";
	} else {
		const img = document.createElement("img");
		img.className = "background-thumb";
		img.src = url;
		img.alt = "";
		img.loading = "lazy";
		thumb = img;
	}
	const name = document.createElement("span");
	name.className = "character-option-name";
	name.textContent = label;
	content.append(thumb, name);
	if (pack) content.append(chip("art1", pack));
	option.append(content);
	return option;
}

// the directory forgets rooms after a day; hours suffice
function lastActiveLabel(active: number): string {
	const minutes = Math.max(0, Math.round((Date.now() - active) / 60_000));
	if (minutes < 1) return "active just now";
	if (minutes < 60) return `active ${minutes}m ago`;
	return `active ${Math.round(minutes / 60)}h ago`;
}

export function buildRoomOption(
	group: string,
	listing: RoomListing,
): HTMLLabelElement {
	const label = radioTile("room-option", group, listing.name);
	const name = document.createElement("span");
	name.className = "room-option-name";
	name.textContent = listing.name;
	const detail = document.createElement("span");
	detail.className = "room-option-detail";
	detail.textContent =
		listing.members === 1
			? "1 member"
			: listing.members > 1
				? `${listing.members} members`
				: listing.active > 0
					? lastActiveLabel(listing.active)
					: "empty";
	label.append(name, detail);
	return label;
}
