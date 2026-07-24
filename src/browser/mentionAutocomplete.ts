// Composer mention completion: `@` only summons the menu; it inserts the bare nick (IRC-style, no sigil) over the bare-name addressing model (addressing.ts).

export interface MentionAutocompleteOptions {
	input: HTMLInputElement;
	getNames: () => string[];
	isEnabled: () => boolean;
	signal?: AbortSignal;
}

const MAX_SUGGESTIONS = 6;

export class MentionAutocomplete {
	private readonly input: HTMLInputElement;
	private readonly getNames: () => string[];
	private readonly isEnabled: () => boolean;
	private menu: HTMLUListElement | null = null;
	private items: string[] = [];
	private active = 0;
	private tokenStart = -1;

	constructor(options: MentionAutocompleteOptions) {
		this.input = options.input;
		this.getNames = options.getNames;
		this.isEnabled = options.isEnabled;
		const listen = { signal: options.signal };
		this.input.addEventListener("input", () => this.refresh(), listen);
		this.input.addEventListener(
			"keydown",
			(event) => this.onKeydown(event),
			listen,
		);
		this.input.addEventListener("blur", () => this.close(), listen);
	}

	// the @token under the caret: @ at a word boundary, then the non-space run up to the caret
	private tokenAtCaret(): { start: number; query: string } | null {
		const caret = this.input.selectionStart;
		if (caret === null || caret !== this.input.selectionEnd) return null;
		const value = this.input.value;
		let i = caret - 1;
		while (i >= 0 && value[i] !== "@" && value[i] !== " ") i--;
		if (i < 0 || value[i] !== "@") return null;
		const before = i === 0 ? "" : value[i - 1];
		if (before !== "" && before !== " ") return null;
		return { start: i, query: value.slice(i + 1, caret) };
	}

	private refresh(): void {
		if (!this.isEnabled()) {
			this.close();
			return;
		}
		const token = this.tokenAtCaret();
		if (!token) {
			this.close();
			return;
		}
		const query = token.query.toLowerCase();
		const matches = this.getNames().filter((name) =>
			name.toLowerCase().startsWith(query),
		);
		if (matches.length === 0) {
			this.close();
			return;
		}
		this.items = matches.slice(0, MAX_SUGGESTIONS);
		this.tokenStart = token.start;
		this.active = 0;
		this.paint();
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

	private accept(name: string | undefined): void {
		if (name === undefined) return;
		const value = this.input.value;
		const caret = this.input.selectionStart ?? value.length;
		const head = value.slice(0, this.tokenStart);
		const tail = value.slice(caret);
		// IRC address form: 'nick:' at line start, bare 'nick' elsewhere (facing keys off the name either way)
		const insert = head.trim() === "" ? `${name}: ` : `${name} `;
		this.input.value = head + insert + tail;
		const pos = head.length + insert.length;
		this.input.setSelectionRange(pos, pos);
		this.close();
		this.input.focus();
	}

	private paint(): void {
		if (!this.menu) {
			this.menu = document.createElement("ul");
			this.menu.className = "bodycam-menu mention-menu";
			document.body.append(this.menu);
		}
		this.menu.replaceChildren(
			...this.items.map((name, index) => {
				const item = document.createElement("li");
				item.textContent = name;
				if (index === this.active) item.classList.add("active");
				// mousedown, not click: fire before the input's blur so focus and the caret survive
				item.addEventListener("mousedown", (event) => {
					event.preventDefault();
					this.accept(name);
				});
				return item;
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
		this.tokenStart = -1;
	}
}
