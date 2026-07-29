// Static-asset readers for server-side rendering: manifests, atlas data URIs, and the embedded fonts.

import type { AvatarData } from "../../src/engine/avatar.js";
import type { SvgImage } from "../../src/render/svgContext.js";

export interface BackdropEntry {
	name: string;
	url: string;
}

let avatarsCache: Promise<AvatarData[]> | undefined;
let backdropsCache: Promise<BackdropEntry[]> | undefined;
let fontDefsCache: Promise<string> | undefined;
const imageCache = new Map<string, Promise<SvgImage>>();

async function fetchAsset(assets: Fetcher, path: string): Promise<Response> {
	const response = await assets.fetch(
		new Request(`https://placeholder${path}`),
	);
	if (!response.ok) throw new Error(`asset ${path}: ${response.status}`);
	return response;
}

export function loadAvatars(assets: Fetcher): Promise<AvatarData[]> {
	avatarsCache ??= fetchAsset(assets, "/assets/avatars/manifest.json")
		.then((response) => response.json())
		.then((manifest) => (manifest as { avatars: AvatarData[] }).avatars);
	return avatarsCache;
}

export function loadBackdrops(assets: Fetcher): Promise<BackdropEntry[]> {
	backdropsCache ??= fetchAsset(assets, "/assets/backgrounds/manifest.json")
		.then((response) => response.json())
		.then((manifest) => (manifest as { backdrops: BackdropEntry[] }).backdrops);
	return backdropsCache;
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

// width and height straight from the IHDR chunk, which always opens a PNG
function pngSize(bytes: Uint8Array): { width: number; height: number } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function loadImage(assets: Fetcher, url: string): Promise<SvgImage> {
	let image = imageCache.get(url);
	if (!image) {
		image = fetchAsset(assets, url)
			.then((response) => response.arrayBuffer())
			.then((buffer) => {
				const bytes = new Uint8Array(buffer);
				return {
					href: `data:image/png;base64,${toBase64(bytes)}`,
					...pngSize(bytes),
				};
			});
		imageCache.set(url, image);
		image.catch(() => {
			if (imageCache.get(url) === image) imageCache.delete(url);
		});
	}
	return image;
}

async function fontData(assets: Fetcher, path: string): Promise<string> {
	const buffer = await (await fetchAsset(assets, path)).arrayBuffer();
	return toBase64(new Uint8Array(buffer));
}

export function fontFaceDefs(assets: Fetcher): Promise<string> {
	fontDefsCache ??= Promise.all([
		fontData(assets, "/assets/fonts/comic-neue-400.woff2"),
		fontData(assets, "/assets/fonts/comic-neue-400-italic.woff2"),
	]).then(
		([regular, italic]) =>
			`<style>@font-face{font-family:'Comic Neue';font-weight:400;src:url(data:font/woff2;base64,${regular}) format('woff2')}@font-face{font-family:'Comic Neue';font-style:italic;font-weight:400;src:url(data:font/woff2;base64,${italic}) format('woff2')}</style>`,
	);
	return fontDefsCache;
}
