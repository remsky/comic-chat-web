// cast.md's prose, parsed at generate time so the catalog carries look, range, and registers.

export interface CastNote {
	look: string;
	range: string;
}

export interface CastRegister {
	// the label's first word, lowercased: what --register and query_cast match on
	key: string;
	label: string;
	names: string[];
}

export interface CastProse {
	notes: Record<string, CastNote>;
	registers: CastRegister[];
}

// the markdown ticks are for a reader, not for output
const plain = (text: string | undefined): string =>
	(text ?? "").replaceAll("`", "").trim();

// known names gate both passes: the troupe table and the register bullets share their shape with other prose
export function parseCastProse(
	markdown: string,
	known: ReadonlySet<string>,
): CastProse {
	// the troupe table: | name | look | range |
	const notes: Record<string, CastNote> = {};
	for (const [, name, look, range] of markdown.matchAll(
		/^\| ([a-z]+) \| ([^|]+) \| ([^|]+) \|$/gm,
	))
		if (name && known.has(name))
			notes[name] = { look: plain(look), range: plain(range) };

	// the casting-by-register bullets: - **Label**: `name`, `name`
	const registers: CastRegister[] = [];
	for (const [, label, body] of markdown.matchAll(
		/^- \*\*([^*]+)\*\*(.*)$/gm,
	)) {
		if (!label) continue;
		const names = [
			...new Set(
				[...(body ?? "").matchAll(/`([a-z]+)`/g)]
					.map((match) => match[1] as string)
					.filter((name) => known.has(name)),
			),
		];
		// a bullet naming nobody is ordinary prose, not a register
		if (names.length === 0) continue;
		const clean = label.trim();
		registers.push({
			key: clean.toLowerCase().split(" ")[0] as string,
			label: clean,
			names,
		});
	}

	return { notes, registers };
}
