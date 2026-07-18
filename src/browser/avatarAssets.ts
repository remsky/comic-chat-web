import type { AvatarData, PoseData } from "../engine/avatar.js";

export type AvatarAtlasImage = CanvasImageSource & { close?: () => void };
export type AtlasDecoder = (url: string) => Promise<AvatarAtlasImage>;

async function decodeAtlas(url: string): Promise<AvatarAtlasImage> {
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`failed to load avatar atlas ${url}: ${response.status}`);
	const blob = await response.blob();
	if (typeof createImageBitmap === "function") {
		return createImageBitmap(blob, {
			premultiplyAlpha: "premultiply",
			colorSpaceConversion: "none",
		});
	}
	if (typeof Image === "undefined")
		throw new Error("no browser image decoder is available");
	const objectUrl = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.decoding = "async";
		image.src = objectUrl;
		await image.decode();
		return image;
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export class AvatarAtlasCache {
	private readonly decoder: AtlasDecoder;
	private readonly images = new Map<string, Promise<AvatarAtlasImage>>();

	constructor(decoder: AtlasDecoder = decodeAtlas) {
		this.decoder = decoder;
	}

	load(url: string): Promise<AvatarAtlasImage> {
		let image = this.images.get(url);
		if (!image) {
			image = this.decoder(url);
			this.images.set(url, image);
			// drop failed decodes so a transient error does not poison the URL for the session
			image.catch(() => {
				if (this.images.get(url) === image) this.images.delete(url);
			});
		}
		return image;
	}

	async preload(avatars: readonly AvatarData[]): Promise<void> {
		const urls = new Set<string>();
		for (const avatar of avatars)
			for (const pose of avatar.poses)
				if (pose.sprite) urls.add(pose.sprite.atlasUrl);
		await Promise.all(
			[...urls].map(async (url) => {
				const image = await this.load(url);
				if (this.disposed) {
					image.close?.();
					return;
				}
				this.ready.set(url, image);
			}),
		);
	}

	get(pose: PoseData): AvatarAtlasImage {
		if (!pose.sprite)
			throw new Error(`pose ${pose.poseID} has no atlas mapping`);
		const promise = this.images.get(pose.sprite.atlasUrl);
		if (!promise)
			throw new Error(`atlas ${pose.sprite.atlasUrl} was not preloaded`);
		const ready = this.ready.get(pose.sprite.atlasUrl);
		if (!ready)
			throw new Error(`atlas ${pose.sprite.atlasUrl} is not decoded yet`);
		return ready;
	}

	private readonly ready = new Map<string, AvatarAtlasImage>();
	private disposed = false;

	dispose(): void {
		this.disposed = true;
		for (const image of this.ready.values()) image.close?.();
		this.ready.clear();
		this.images.clear();
	}
}
