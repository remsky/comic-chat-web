// Content-hashes the shipped art into /art so it can be cached immutably: the name moves whenever the bytes do.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export const ART_DIR = "art";

function hashedName(file: string, bytes: Buffer): string {
	const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
	return `${file.replace(/\.png$/, "")}-${digest}.png`;
}

export function artUrls(avatarJson: string, backgroundJson: string): string[] {
	const { avatars } = JSON.parse(avatarJson) as {
		avatars: { poses: { sprite?: { atlasUrl: string } }[] }[];
	};
	const { backdrops } = JSON.parse(backgroundJson) as {
		backdrops: { url: string }[];
	};
	const urls = new Set<string>();
	for (const avatar of avatars)
		for (const pose of avatar.poses)
			if (pose.sprite) urls.add(pose.sprite.atlasUrl);
	for (const backdrop of backdrops) urls.add(backdrop.url);
	return [...urls];
}

export function moveArt(staged: string, urls: string[]): Map<string, string> {
	mkdirSync(join(staged, ART_DIR), { recursive: true });
	const moved = new Map<string, string>();
	for (const url of urls) {
		const source = join(staged, url.slice(1));
		const name = hashedName(url.split("/").pop() ?? "", readFileSync(source));
		renameSync(source, join(staged, ART_DIR, name));
		moved.set(url, `/${ART_DIR}/${name}`);
	}
	return moved;
}

// quoted so a rewrite can only land on a whole JSON string value
export function rewriteArtUrls(
	json: string,
	moved: ReadonlyMap<string, string>,
): string {
	let out = json;
	for (const [from, to] of moved) out = out.split(`"${from}"`).join(`"${to}"`);
	return out;
}
