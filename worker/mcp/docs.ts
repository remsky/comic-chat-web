// The skill's reference docs, republished by the build so MCP clients read the same text.

const textCache = new Map<string, string>();
const blobCache = new Map<string, string>();

export async function loadDoc(assets: Fetcher, file: string): Promise<string> {
	const hit = textCache.get(file);
	if (hit !== undefined) return hit;
	const response = await assets.fetch(
		new Request(`https://placeholder/assets/${file}`),
	);
	// SPA fallback answers a missing asset with index.html and a 200, so html here means the doc never shipped
	const html = (response.headers.get("content-type") ?? "").includes(
		"text/html",
	);
	// a missing asset degrades to vocabulary-only output rather than failing the call
	if (!response.ok || html) return "";
	const text = (await response.text()).trim();
	textCache.set(file, text);
	return text;
}

export async function loadBlob(
	assets: Fetcher,
	file: string,
): Promise<string | null> {
	const hit = blobCache.get(file);
	if (hit !== undefined) return hit;
	const response = await assets.fetch(
		new Request(`https://placeholder/assets/${file}`),
	);
	const html = (response.headers.get("content-type") ?? "").includes(
		"text/html",
	);
	if (!response.ok || html) return null;
	const bytes = new Uint8Array(await response.arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const b64 = btoa(binary);
	blobCache.set(file, b64);
	return b64;
}
