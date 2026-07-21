// Radio-tile builders for the character, background, and room pickers.

import type { AvatarData } from "../engine/avatar.js";
import type { RoomListing } from "../protocol/room.js";
import type { AvatarAtlasCache } from "./avatarAssets.js";
import { displayName } from "./dom.js";

const RELEASE_CHIP: Record<string, { label: string; tone: string }> = {
	buck: { label: "v2.1b", tone: "v2" },
	kirby: { label: "v2.1b", tone: "v2" },
	veronica: { label: "v2.1b", tone: "v2" },
	kevin: { label: "ART1", tone: "art1" },
	kwensa: { label: "ART1", tone: "art1" },
	maynard: { label: "ART1", tone: "art1" },
	rebecca: { label: "ART1", tone: "art1" },
	sage: { label: "ART1", tone: "art1" },
	scotty: { label: "ART1", tone: "art1" },
};

// backdrops sourced from artpack1; base comicart ones stay unlabeled
export const BACKDROP_PACK: Record<string, string> = {
	den: "ART1",
	volcano: "ART1",
};

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

export function buildCharacterTile(
	avatar: AvatarData,
	atlases: AvatarAtlasCache,
	group: string,
): HTMLLabelElement {
	const label = radioTile("character-option", group, String(avatar.avatarID));
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
	const name = document.createElement("span");
	name.className = "character-option-name";
	name.textContent = displayName(avatar.name);
	const content = document.createElement("span");
	content.className = "character-option-content";
	content.append(canvas, name);
	const release = RELEASE_CHIP[avatar.name];
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
