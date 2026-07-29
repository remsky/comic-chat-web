// GET /studio/strip.svg?s=<packed>: composes the strip server-side and answers a self-contained SVG sheet.

import type { SvgImage } from "../../src/render/svgContext.js";
import { renderSheetSvg } from "../../src/render/svgSheet.js";
import { CanvasTextMeasurer } from "../../src/render/textMetrics.js";
import { TableMeasureContext } from "../../src/render/textTable.js";
import { emptyArt } from "../../src/studio/art.js";
import { composeStrip } from "../../src/studio/compose.js";
import {
	buildCatalog,
	COLUMNS_DEFAULT,
	parseStrip,
} from "../../src/studio/script.js";
import {
	fontFaceDefs,
	loadAvatars,
	loadBackdrops,
	loadImage,
} from "./assets.js";

// bounds the compose work a single request can ask for
const MAX_SCRIPT_BYTES = 65536;

function decodeBytes(encoded: string): Uint8Array {
	const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function inflate(bytes: Uint8Array): Promise<string> {
	const stream = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"));
	return new Response(stream).text();
}

async function scriptFromQuery(url: URL): Promise<string | null> {
	const packed = url.searchParams.get("s");
	if (packed) return inflate(decodeBytes(packed));
	// legacy plain-base64 alias
	const inline = url.searchParams.get("script");
	if (inline) return new TextDecoder().decode(decodeBytes(inline));
	return null;
}

function plain(status: number, text: string): Response {
	return new Response(text, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

export async function stripSvgResponse(
	request: Request,
	assets: Fetcher,
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD")
		return plain(405, "method not allowed");
	const url = new URL(request.url);

	let text: string | null;
	try {
		text = await scriptFromQuery(url);
	} catch {
		return plain(400, "the script parameter does not decode");
	}
	if (!text) return plain(400, "pass the strip as ?s=");
	if (text.length > MAX_SCRIPT_BYTES) return plain(413, "script too large");

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return plain(400, "the script is not valid JSON");
	}

	const [avatars, backdrops] = await Promise.all([
		loadAvatars(assets),
		loadBackdrops(assets),
	]);
	const catalog = buildCatalog(
		avatars,
		backdrops.map((entry) => entry.name),
	);
	const { strip, issues } = parseStrip(raw, catalog);
	const errors = issues.filter((issue) => issue.severity === "error");
	if (errors.length > 0)
		return plain(
			422,
			errors
				.map((e) => `error: ${e.path ? `${e.path}: ` : ""}${e.message}`)
				.join("\n"),
		);
	if (strip.panels.length === 0) return plain(422, "strip has no panels");

	const byName = new Map(catalog.avatars.map((entry) => [entry.name, entry]));
	const measurer = new CanvasTextMeasurer(new TableMeasureContext());
	const composed = composeStrip(strip, {
		avatars,
		resolveStyle: measurer.styleResolver(),
		artFor: (name) => byName.get(name)?.art ?? emptyArt(),
	});

	const cast = new Set(
		strip.panels.flatMap((panel) => panel.actors.map((actor) => actor.avatar)),
	);
	const atlasUrls = new Set<string>();
	for (const data of avatars)
		if (cast.has(data.name))
			for (const pose of data.poses)
				if (pose.sprite) atlasUrls.add(pose.sprite.atlasUrl);
	const backdropByName = new Map(backdrops.map((entry) => [entry.name, entry]));
	const usedBackdrops = new Set(
		strip.panels.flatMap((panel) =>
			panel.background ? [panel.background] : [],
		),
	);

	const atlasImages = new Map<string, SvgImage>();
	const backdropImages = new Map<string, SvgImage>();
	const [fontDefs] = await Promise.all([
		fontFaceDefs(assets),
		...[...atlasUrls].map(async (atlasUrl) => {
			atlasImages.set(atlasUrl, await loadImage(assets, atlasUrl));
		}),
		...[...usedBackdrops].map(async (name) => {
			const entry = backdropByName.get(name);
			if (entry) backdropImages.set(name, await loadImage(assets, entry.url));
		}),
	]);

	const svg = renderSheetSvg(composed, {
		avatars,
		columns: strip.columns ?? COLUMNS_DEFAULT,
		host: url.host,
		fontDefs,
		assets: {
			atlas: (atlasUrl) => {
				const image = atlasImages.get(atlasUrl);
				if (!image) throw new Error(`atlas ${atlasUrl} was not preloaded`);
				return image;
			},
			backdrop: (name) => backdropImages.get(name),
		},
	});

	return new Response(svg, {
		headers: {
			"content-type": "image/svg+xml; charset=utf-8",
			"cache-control": "public, max-age=86400",
		},
	});
}
