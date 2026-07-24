// Composer completion: a sigil under the caret summons a menu; each source owns what it lists and what it inserts.

export interface CompletionSource {
	sigil: string;
	// a command opens the line, so its sigil only completes at the head of the input
	lineStartOnly?: boolean;
	// the sigil is part of a command but not part of a nick, so only some menus show it
	showSigil?: boolean;
	isEnabled: () => boolean;
	list: () => string[];
	// accept() replaces the sigil too, so anything the inserted text still needs must be spelled out here
	insert: (item: string, head: string) => string;
}

export interface ComposerAutocompleteOptions {
	input: HTMLInputElement;
	sources: readonly CompletionSource[];
	signal?: AbortSignal;
}

const MAX_SUGGESTIONS = 8;

export class ComposerAutocomplete {
	private readonly input: HTMLInputElement;
	private readonly sources: readonly CompletionSource[];
	private menu: HTMLUListElement | null = null;
	private items: string[] = [];
	private source: CompletionSource | null = null;
	private active = 0;
	private tokenStart = -1;

	constructor(options: ComposerAutocompleteOptions) {
		this.input = options.input;
		this.sources = options.sources;
		const listen = { signal: options.signal };
		this.input.addEventListener("input", () => this.refresh(), listen);
		this.input.addEventListener(
			"keydown",
			(event) => this.onKeydown(event),
			listen,
		);
		this.input.addEventListener("blur", () => this.close(), listen);
	}

	// the token under the caret: a sigil at a word boundary, then the non-space run up to the caret
	private tokenAtCaret(
		source: CompletionSource,
	): { start: number; query: string } | null {
		const caret = this.input.selectionStart;
		if (caret === null || caret !== this.input.selectionEnd) return null;
		const value = this.input.value;
		let i = caret - 1;
		while (i >= 0 && value[i] !== source.sigil && value[i] !== " ") i--;
		if (i < 0 || value[i] !== source.sigil) return null;
		const before = i === 0 ? "" : value[i - 1];
		if (before !== "" && before !== " ") return null;
		if (source.lineStartOnly && value.slice(0, i).trim() !== "") return null;
		return { start: i, query: value.slice(i + 1, caret) };
	}

	private refresh(): void {
		for (const source of this.sources) {
			if (!source.isEnabled()) continue;
			const token = this.tokenAtCaret(source);
			if (!token) continue;
			const query = token.query.toLowerCase();
			const matches = source
				.list()
				.filter((item) => item.toLowerCase().startsWith(query));
			if (matches.length === 0) continue;
			this.items = matches.slice(0, MAX_SUGGESTIONS);
			this.source = source;
			this.tokenStart = token.start;
			this.active = 0;
			this.paint();
			return;
		}
		this.close();
	}

	private onKeydown(event: KeyboardEvent): void {
		if (!this.menu) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.active = (this.active + 1) % this.items.length;
			this.paint();
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			this.active = (this.active - 1 + this.items.length) % this.items.length;
			this.paint();
		} else if (event.key === "Enter" || event.key === "Tab") {
			// swallow the key so Enter never submits and Tab never leaves the composer while choosing
			event.preventDefault();
			this.accept(this.items[this.active]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			this.close();
		}
	}

	private accept(item: string | undefined): void {
		if (item === undefined || !this.source) return;
		const value = this.input.value;
		const caret = this.input.selectionStart ?? value.length;
		const head = value.slice(0, this.tokenStart);
		const tail = value.slice(caret);
		const insert = this.source.insert(item, head);
		this.input.value = head + insert + tail;
		const pos = head.length + insert.length;
		this.input.setSelectionRange(pos, pos);
		this.close();
		this.input.focus();
	}

	private paint(): void {
		if (!this.menu) {
			this.menu = document.createElement("ul");
			this.menu.className = "bodycam-menu completion-menu";
			document.body.append(this.menu);
		}
		const sigil = this.source?.showSigil ? this.source.sigil : "";
		this.menu.replaceChildren(
			...this.items.map((item, index) => {
				const entry = document.createElement("li");
				entry.textContent = sigil + item;
				if (index === this.active) entry.classList.add("active");
				// mousedown, not click: fire before the input's blur so focus and the caret survive
				entry.addEventListener("mousedown", (event) => {
					event.preventDefault();
					this.accept(item);
				});
				return entry;
			}),
		);
		const rect = this.input.getBoundingClientRect();
		const size = this.menu.getBoundingClientRect();
		this.menu.style.left = `${rect.left}px`;
		this.menu.style.top = `${rect.top - size.height - 2}px`;
	}

	private close(): void {
		this.menu?.remove();
		this.menu = null;
		this.items = [];
		this.source = null;
		this.tokenStart = -1;
	}
}
