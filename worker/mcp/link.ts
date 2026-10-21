async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function stripQuery(strip: unknown): Promise<string> {
	const json = new TextEncoder().encode(JSON.stringify(strip));
	const packed = await deflateRaw(json);
	return `s=${packed.toBase64({ alphabet: "base64url", omitPadding: true })}`;
}

export interface StripLinks {
	studio: string;
	image: string;
	query: string;
}

export async function stripLinks(
	strip: unknown,
	base: string,
): Promise<StripLinks> {
	const query = await stripQuery(strip);
	const root = base.replace(/\/$/, "");
	return {
		studio: `${root}/studio.html?${query}`,
		image: `${root}/studio/strip.svg?${query}`,
		query,
	};
}
