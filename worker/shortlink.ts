// Temporary studio short links in KV: link:<slug> rows with 24h TTL, capped by live-link count. <slug> opens the editor, <slug>.svg the rendered strip.

export interface LinkStore {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options?: { expirationTtl?: number },
	): Promise<void>;
	list(options: {
		prefix: string;
		limit: number;
	}): Promise<{ keys: { name: string }[] }>;
}

export const SHORT_LINK_PATH = "/studio/s/";
export const LINK_TTL_SECONDS = 86400;
const MINT_ATTEMPTS = 3;
const SLUG_PATTERN = /^[a-z]+-[a-z]+-\d{1,4}$/;

const ADJECTIVES = [
	"amber",
	"bold",
	"brave",
	"bravo",
	"breezy",
	"calm",
	"cheery",
	"clever",
	"cosmic",
	"crafty",
	"daring",
	"deft",
	"eager",
	"fleet",
	"gentle",
	"giddy",
	"golden",
	"jolly",
	"keen",
	"lively",
	"lucky",
	"mellow",
	"merry",
	"nifty",
	"peppy",
	"plucky",
	"proud",
	"quick",
	"snappy",
	"sunny",
	"swift",
	"witty",
] as const;

const ANIMALS = [
	"badger",
	"beaver",
	"bison",
	"camel",
	"condor",
	"coyote",
	"crane",
	"dingo",
	"falcon",
	"ferret",
	"finch",
	"gecko",
	"gerbil",
	"gibbon",
	"heron",
	"ibex",
	"jackal",
	"koala",
	"lemur",
	"llama",
	"magpie",
	"marmot",
	"ocelot",
	"otter",
	"panda",
	"puffin",
	"quokka",
	"robin",
	"tapir",
	"toucan",
	"walrus",
	"wombat",
] as const;

function randomSlug(): string {
	const r = new Uint32Array(3);
	crypto.getRandomValues(r);
	const adjective = ADJECTIVES[(r[0] as number) % ADJECTIVES.length];
	const animal = ANIMALS[(r[1] as number) % ANIMALS.length];
	return `${adjective}-${animal}-${((r[2] as number) % 9999) + 1}`;
}

// cap = max live links; KV lists at most 1000 keys, the ceiling any cap can enforce
export async function mintShortLink(
	store: LinkStore,
	query: string,
	cap: number,
): Promise<string | null> {
	if (cap <= 0) return null;
	const effectiveCap = Math.min(cap, 1000);
	const live = await store.list({ prefix: "link:", limit: effectiveCap });
	if (live.keys.length >= effectiveCap) return null;
	for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
		const slug = randomSlug();
		if ((await store.get(`link:${slug}`)) !== null) continue;
		await store.put(`link:${slug}`, query, {
			expirationTtl: LINK_TTL_SECONDS,
		});
		return slug;
	}
	return null;
}

const EXPIRED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><text x="16" y="46" font-family="sans-serif" font-size="16">link expired</text></svg>`;

const EXPIRED_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link expired</title></head>
<body style="font-family: sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem">
<h1>Link expired</h1>
<p>Short links only last 24 hours. Ask for a fresh one, or use the full studio link if you saved it.</p>
<p><a href="/studio.html">Open the studio</a></p>
</body>
</html>`;

export async function shortLinkResponse(
	request: Request,
	store: LinkStore,
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response("method not allowed", { status: 405 });
	const url = new URL(request.url);
	let slug = url.pathname.slice(SHORT_LINK_PATH.length);
	const svg = slug.endsWith(".svg");
	if (svg) slug = slug.slice(0, -4);
	const query = SLUG_PATTERN.test(slug)
		? await store.get(`link:${slug}`)
		: null;
	if (query === null)
		return svg
			? new Response(EXPIRED_SVG, {
					status: 404,
					headers: { "content-type": "image/svg+xml" },
				})
			: new Response(EXPIRED_PAGE, {
					status: 404,
					headers: { "content-type": "text/html; charset=utf-8" },
				});
	const target = svg ? "/studio/strip.svg" : "/studio.html";
	return new Response(null, {
		status: 302,
		headers: {
			location: `${url.origin}${target}?${query}`,
			"cache-control": "no-store",
		},
	});
}
