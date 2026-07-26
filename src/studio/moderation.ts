// The profanity screen. The wordlist stays in the worker, so the studio asks rather than checks.

import type { Strip, StripActor, StripIssue } from "./script.js";

interface ScreenRequest {
	texts: string[];
}

interface ScreenResponse {
	flagged: number[];
}

interface Held {
	// the last text the screen cleared for this balloon
	drawn: string;
	flagged: boolean;
}

const MESSAGE = "flagged by the profanity screen";

export function collectTexts(strip: Strip): { path: string; text: string }[] {
	const found: { path: string; text: string }[] = [];
	strip.panels.forEach((panel, panelIndex) => {
		panel.actors.forEach((actor, actorIndex) => {
			if (actor.text)
				found.push({
					path: `panels[${panelIndex}].actors[${actorIndex}]`,
					text: actor.text,
				});
		});
	});
	return found;
}

async function ask(texts: string[]): Promise<Set<number> | null> {
	const body: ScreenRequest = { texts };
	try {
		const response = await fetch("/api/moderate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok) return null;
		const { flagged } = (await response.json()) as ScreenResponse;
		return Array.isArray(flagged) ? new Set(flagged) : null;
	} catch {
		return null;
	}
}

export class StripScreen {
	private readonly verdicts = new Map<string, boolean>();
	private readonly held = new WeakMap<StripActor, Held>();
	// a deploy with the screen off, or a dev server with no worker behind it, screens nothing
	private reachable = true;

	// the strip as the canvas may draw it: a balloon holds its last cleared text until a verdict lands
	drawable(strip: Strip): Strip {
		return {
			...strip,
			panels: strip.panels.map((panel) => ({
				...panel,
				actors: panel.actors.map((actor) => this.settle(actor)),
			})),
		};
	}

	issues(strip: Strip): StripIssue[] {
		const found: StripIssue[] = [];
		strip.panels.forEach((panel, panelIndex) => {
			panel.actors.forEach((actor, actorIndex) => {
				if (this.held.get(actor)?.flagged)
					found.push({
						path: `panels[${panelIndex}].actors[${actorIndex}]`,
						message: MESSAGE,
						severity: "error",
					});
			});
		});
		return found;
	}

	// screens what the strip has added since the last pass, and reports whether the answer moves anything
	async update(strip: Strip): Promise<boolean> {
		const texts = [...new Set(collectTexts(strip).map((entry) => entry.text))];
		const pending = texts.filter((text) => this.verdict(text) === undefined);
		if (pending.length === 0) return false;
		const flagged = await ask(pending);
		if (!flagged) {
			this.reachable = false;
			return true;
		}
		pending.forEach((text, index) => {
			this.verdicts.set(text, flagged.has(index));
		});
		return true;
	}

	// an export asks again about every line, so a stale answer cannot let one through
	async recheck(strip: Strip): Promise<void> {
		const entries = collectTexts(strip);
		if (entries.length === 0) return;
		const flagged = await ask(entries.map((entry) => entry.text));
		if (!flagged) {
			this.reachable = false;
			return;
		}
		entries.forEach((entry, index) => {
			this.verdicts.set(entry.text, flagged.has(index));
		});
	}

	private settle(actor: StripActor): StripActor {
		const text = actor.text ?? "";
		const verdict = this.verdict(text);
		if (verdict === true)
			this.held.set(actor, {
				drawn: this.held.get(actor)?.drawn ?? "",
				flagged: true,
			});
		else if (verdict === false)
			this.held.set(actor, { drawn: text, flagged: false });
		const drawn = this.held.get(actor)?.drawn ?? "";
		if (drawn === text) return actor;
		const copy = { ...actor };
		if (drawn) copy.text = drawn;
		else delete copy.text;
		return copy;
	}

	// undefined until the screen has answered for this exact text
	private verdict(text: string): boolean | undefined {
		if (!this.reachable || text === "") return false;
		return this.verdicts.get(text);
	}
}
