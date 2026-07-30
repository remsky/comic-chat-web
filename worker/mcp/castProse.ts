// cast.md's prose: the look, range, and registers the catalog's art counts cannot carry.

export interface CastNote {
	look: string;
	range: string;
}

export interface CastRegister {
	label: string;
	key: string;
	names: Set<string>;
}

export interface CastProse {
	notes: Map<string, CastNote>;
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
	const notes = new Map<string, CastNote>();
	for (const [, name, look, range] of markdown.matchAll(
		/^\| ([a-z]+) \| ([^|]+) \| ([^|]+) \|$/gm,
	))
		if (name && known.has(name))
			notes.set(name, { look: plain(look), range: plain(range) });

	// the casting-by-register bullets: - **Label**: `name`, `name`
	const registers: CastRegister[] = [];
	for (const [, label, body] of markdown.matchAll(
		/^- \*\*([^*]+)\*\*(.*)$/gm,
	)) {
		if (!label) continue;
		const names = [...(body ?? "").matchAll(/`([a-z]+)`/g)]
			.map((match) => match[1] as string)
			.filter((name) => known.has(name));
		// a bullet naming nobody is ordinary prose, not a register
		if (names.length === 0) continue;
		registers.push({
			label: label.trim(),
			key: label.trim().toLowerCase(),
			names: new Set(names),
		});
	}

	return { notes, registers };
}

export function isSilent(prose: CastProse, name: string): boolean {
	return (prose.notes.get(name)?.range ?? "").includes("one drawing");
}

export function registersOf(prose: CastProse, name: string): string[] {
	return prose.registers
		.filter((group) => group.names.has(name))
		.map((group) => group.label);
}

export function findRegister(
	prose: CastProse,
	wanted: string,
): CastRegister | undefined {
	return prose.registers.find((group) =>
		group.key.startsWith(wanted.toLowerCase()),
	);
}
