// The constructor: one collapsible card per panel, one row per character in it.

import { displayName, revealWithin } from "../browser/dom.js";
import { attachReorder, moveItem } from "./reorder.js";
import {
	emptyPanel,
	NEUTRAL_KEY,
	type Strip,
	type StripActor,
	type StripCatalog,
	type StripIssue,
	type StripPanel,
	ZOOM_MAX,
	ZOOM_MIN,
} from "./script.js";

export interface EditorOptions {
	container: HTMLElement;
	// the pane that scrolls, so revealing a card never moves the page itself
	scroller: HTMLElement;
	catalog: StripCatalog;
	// a value changed; the strip is already up to date
	onEdit: () => void;
	onSelect: (index: number) => void;
}

function named<T extends HTMLElement>(control: T, label: string): T {
	control.setAttribute("aria-label", label);
	control.title = label;
	return control;
}

function selectOf(
	values: readonly string[],
	current: string,
	blank = "None",
): HTMLSelectElement {
	const select = document.createElement("select");
	fillOptions(select, values, blank);
	select.value = current;
	return select;
}

function fillOptions(
	select: HTMLSelectElement,
	values: readonly string[],
	blank: string,
): void {
	select.replaceChildren();
	for (const value of values) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = value === "" ? blank : displayName(value);
		select.append(option);
	}
}

type Degrees = Record<string, readonly number[]>;

function nearestDegree(steps: readonly number[], intensity: number): number {
	let best = 0;
	steps.forEach((value, index) => {
		if (Math.abs(value - intensity) < Math.abs((steps[best] ?? 1) - intensity))
			best = index;
	});
	return best;
}

// emotion and degree in one list, holding only what this character has distinct art for
function fillEmotions(
	select: HTMLSelectElement,
	emotions: readonly string[],
	degrees: Degrees,
): void {
	select.replaceChildren();
	const neutral = document.createElement("option");
	neutral.value = NEUTRAL_KEY;
	neutral.textContent = displayName(NEUTRAL_KEY);
	select.append(neutral);
	for (const key of emotions) {
		const steps = degrees[key];
		if (!steps || steps.length === 0) continue;
		steps.forEach((_, degree) => {
			const option = document.createElement("option");
			option.value = `${key}:${degree}`;
			option.textContent =
				steps.length === 1
					? displayName(key)
					: `${displayName(key)} ${degree + 1}`;
			select.append(option);
		});
	}
}

function emotionValue(actor: StripActor, degrees: Degrees): string {
	const key = actor.emotion ?? NEUTRAL_KEY;
	const steps = degrees[key];
	if (!steps || steps.length === 0) return NEUTRAL_KEY;
	return `${key}:${nearestDegree(steps, actor.intensity ?? 1)}`;
}

function iconButton(glyph: string, title: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "sicon";
	button.textContent = glyph;
	return named(button, title);
}

function toggleButton(
	glyph: string,
	title: string,
	pressed: boolean,
): HTMLButtonElement {
	const button = iconButton(glyph, title);
	button.classList.add("stoggle");
	button.setAttribute("aria-pressed", String(pressed));
	return button;
}

function summarize(panel: StripPanel): string {
	if (panel.actors.length === 0) return "empty";
	const cast = panel.actors
		.map((actor) => displayName(actor.avatar))
		.join(", ");
	const line = panel.actors.find((actor) => actor.text)?.text;
	return line ? `${cast} - "${line}"` : cast;
}

export class PanelEditor {
	strip: Strip;
	private cards: HTMLElement[] = [];
	private issues: readonly StripIssue[] = [];
	private selected = 0;

	constructor(
		strip: Strip,
		private readonly options: EditorOptions,
	) {
		this.strip = strip;
		attachReorder({
			container: options.container,
			touch: true,
			itemFor: (target) =>
				target.closest<HTMLElement>(".pedit-grip")
					? target.closest<HTMLElement>(".pedit")
					: null,
			onMove: (from, to) => this.move(from, to),
		});
	}

	// full rebuild; value edits never call it, so typing keeps the caret
	rebuild(): void {
		this.selected = Math.min(this.selected, this.strip.panels.length - 1);
		const top = this.options.scroller.scrollTop;
		const fragment = document.createDocumentFragment();
		this.cards = this.strip.panels.map((panel, index) => {
			const card = this.panelCard(panel, index);
			fragment.append(card);
			return card;
		});
		const add = document.createElement("button");
		add.type = "button";
		add.className = "sbutton sbutton--add";
		add.textContent = "+ Panel";
		add.addEventListener("click", () => this.addPanel());
		fragment.append(add);
		this.options.container.replaceChildren(fragment);
		this.options.scroller.scrollTop = top;
		this.paint();
	}

	addPanel(): void {
		this.strip.panels.push(emptyPanel());
		this.structural(this.strip.panels.length - 1);
	}

	move(from: number, to: number): void {
		moveItem(this.strip.panels, from, to);
		this.structural(to);
	}

	// a panel came or went, so every card's number and position shifts
	private structural(nextSelection: number): void {
		this.selected = nextSelection;
		this.rebuild();
		this.options.onEdit();
		this.options.onSelect(this.selected);
		this.reveal();
	}

	private reveal(): void {
		const card = this.cards[this.selected];
		if (card) revealWithin(this.options.scroller, card);
	}

	private panelCard(panel: StripPanel, index: number): HTMLElement {
		const open = index === this.selected;
		const card = document.createElement("section");
		card.className = open ? "pedit pedit--open" : "pedit";
		card.dataset.index = String(index);
		card.dataset.path = `panels[${index}]`;

		const grip = iconButton("≡", `Reorder panel ${index + 1}`);
		grip.classList.add("pedit-grip");
		grip.addEventListener("keydown", (event) => {
			const step =
				event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
			if (step === 0) return;
			event.preventDefault();
			const to = index + step;
			if (to < 0 || to >= this.strip.panels.length) return;
			this.move(index, to);
			this.cards[this.selected]
				?.querySelector<HTMLElement>(".pedit-grip")
				?.focus({ preventScroll: true });
		});

		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "pedit-toggle";
		toggle.setAttribute("aria-expanded", String(open));
		const number = document.createElement("span");
		number.className = "pedit-num";
		number.textContent = String(index + 1);
		const cast = document.createElement("span");
		cast.className = "pedit-cast";
		cast.textContent = summarize(panel);
		toggle.append(number, cast);
		toggle.addEventListener("click", () => {
			this.options.onSelect(open ? -1 : index);
		});

		const copy = iconButton("⧉", `Duplicate panel ${index + 1}`);
		copy.addEventListener("click", () => {
			this.strip.panels.splice(index + 1, 0, structuredClone(panel));
			this.structural(index + 1);
		});
		const remove = iconButton("✕", `Delete panel ${index + 1}`);
		remove.addEventListener("click", () => {
			this.strip.panels.splice(index, 1);
			this.structural(Math.min(index, this.strip.panels.length - 1));
		});

		const actions = document.createElement("span");
		actions.className = "pedit-actions";
		actions.append(copy, remove);

		const header = document.createElement("header");
		header.className = "pedit-head";
		header.append(grip, toggle, actions);
		card.append(header);
		if (open) card.append(this.panelBody(panel, index));
		return card;
	}

	private panelBody(panel: StripPanel, index: number): HTMLElement {
		const body = document.createElement("div");
		body.className = "pedit-body";

		const background = named(
			selectOf(
				["", ...this.options.catalog.backgrounds],
				panel.background ?? "",
				"No background",
			),
			"Background",
		);
		background.addEventListener("change", () => {
			if (background.value) panel.background = background.value;
			else delete panel.background;
			this.options.onEdit();
		});

		const camera = document.createElement("span");
		camera.className = "seg";
		camera.setAttribute("role", "group");
		camera.setAttribute("aria-label", "Camera");
		for (const value of this.options.catalog.cameras) {
			const option = document.createElement("button");
			option.type = "button";
			option.className = "sbutton seg-option";
			option.textContent = displayName(value);
			option.setAttribute(
				"aria-pressed",
				String(value === (panel.camera ?? "wide")),
			);
			option.addEventListener("click", () => {
				panel.camera = value;
				for (const sibling of camera.children)
					sibling.setAttribute("aria-pressed", String(sibling === option));
				this.options.onEdit();
			});
			camera.append(option);
		}

		const zoom = named(document.createElement("input"), "Zoom");
		zoom.type = "range";
		zoom.min = String(ZOOM_MIN);
		zoom.max = String(ZOOM_MAX);
		zoom.step = "0.05";
		zoom.value = String(panel.zoom ?? 1);
		const zoomValue = document.createElement("output");
		zoomValue.textContent = `${zoom.value}x`;
		zoom.addEventListener("input", () => {
			panel.zoom = Number(zoom.value);
			zoomValue.textContent = `${zoom.value}x`;
			this.options.onEdit();
		});
		const zoomRow = document.createElement("span");
		zoomRow.className = "srange";
		zoomRow.append(zoom, zoomValue);

		const border = toggleButton("▣", "Panel border", panel.border !== false);
		border.addEventListener("click", () => {
			panel.border = border.getAttribute("aria-pressed") === "false";
			border.setAttribute("aria-pressed", String(panel.border));
			this.options.onEdit();
		});

		const settings = document.createElement("div");
		settings.className = "pedit-settings";
		settings.append(background, camera, zoomRow, border);

		const actors = document.createElement("ol");
		actors.className = "pedit-actors";
		panel.actors.forEach((actor, actorIndex) => {
			actors.append(this.actorRow(panel, actor, index, actorIndex));
		});

		const addActor = document.createElement("button");
		addActor.type = "button";
		addActor.className = "sbutton sbutton--add";
		addActor.textContent = "+ Character";
		addActor.disabled = panel.actors.length >= this.options.catalog.maxActors;
		addActor.addEventListener("click", () => {
			const first = this.options.catalog.avatars[0];
			if (!first) return;
			panel.actors.push({ avatar: first.name });
			this.refresh(index);
			this.options.onEdit();
		});

		body.append(settings, actors, addActor);
		return body;
	}

	private actorRow(
		panel: StripPanel,
		actor: StripActor,
		panelIndex: number,
		actorIndex: number,
	): HTMLElement {
		const row = document.createElement("li");
		row.className = "actor";
		row.dataset.path = `panels[${panelIndex}].actors[${actorIndex}]`;

		const avatar = named(
			selectOf(
				this.options.catalog.avatars.map((entry) => entry.name),
				actor.avatar,
			),
			"Character",
		);
		avatar.className = "actor-who";
		const gesture = named(
			selectOf(
				["", ...this.gesturesFor(actor.avatar)],
				actor.gesture ?? "",
				"No gesture",
			),
			"Gesture",
		);

		let degrees = this.degreesFor(actor.avatar);
		const emotion = named(document.createElement("select"), "Emotion");
		fillEmotions(emotion, this.options.catalog.emotions, degrees);
		emotion.value = emotionValue(actor, degrees);

		avatar.addEventListener("change", () => {
			actor.avatar = avatar.value;
			// the new character may not have art for the old gesture, so re-offer only what it can strike
			const available = this.gesturesFor(actor.avatar);
			if (actor.gesture && !available.includes(actor.gesture))
				delete actor.gesture;
			fillOptions(gesture, ["", ...available], "No gesture");
			gesture.value = actor.gesture ?? "";
			// likewise the emotion degrees: another character poses a different number of steps
			degrees = this.degreesFor(actor.avatar);
			fillEmotions(emotion, this.options.catalog.emotions, degrees);
			const steps = actor.emotion ? degrees[actor.emotion] : undefined;
			const snapped = steps?.[nearestDegree(steps, actor.intensity ?? 1)];
			if (snapped === undefined) {
				delete actor.emotion;
				delete actor.intensity;
			} else actor.intensity = snapped;
			emotion.value = emotionValue(actor, degrees);
			this.resummarize(panelIndex);
			this.options.onEdit();
		});
		gesture.addEventListener("change", () => {
			if (gesture.value) actor.gesture = gesture.value;
			else delete actor.gesture;
			this.options.onEdit();
		});
		emotion.addEventListener("change", () => {
			const [key, degree] = emotion.value.split(":");
			actor.emotion = key ?? NEUTRAL_KEY;
			if (degree === undefined) delete actor.intensity;
			else actor.intensity = degrees[actor.emotion]?.[Number(degree)] ?? 1;
			this.options.onEdit();
		});

		const facing = toggleButton(
			"→",
			"Facing right",
			(actor.facing ?? "right") === "right",
		);
		facing.classList.add("actor-facing");
		facing.addEventListener("click", () => {
			actor.facing = actor.facing === "left" ? "right" : "left";
			const right = actor.facing === "right";
			facing.textContent = right ? "→" : "←";
			named(facing, right ? "Facing right" : "Facing left");
			facing.setAttribute("aria-pressed", String(right));
			this.options.onEdit();
		});
		if ((actor.facing ?? "right") === "left") {
			facing.textContent = "←";
			named(facing, "Facing left");
		}

		const mode = named(
			selectOf(this.options.catalog.modes, actor.mode ?? "say"),
			"Balloon style",
		);
		mode.addEventListener("change", () => {
			actor.mode = mode.value as StripActor["mode"];
			this.options.onEdit();
		});

		const text = named(document.createElement("input"), "Balloon text");
		text.type = "text";
		text.className = "actor-text";
		text.placeholder = "Say something, or leave blank for a silent pose";
		text.value = actor.text ?? "";
		text.addEventListener("input", () => {
			if (text.value) actor.text = text.value;
			else delete actor.text;
			this.resummarize(panelIndex);
			this.options.onEdit();
		});

		const remove = iconButton(
			"✕",
			`Remove ${displayName(actor.avatar)} from panel ${panelIndex + 1}`,
		);
		remove.classList.add("actor-drop");
		remove.addEventListener("click", () => {
			panel.actors.splice(actorIndex, 1);
			this.refresh(panelIndex);
			this.options.onEdit();
		});

		// who and how on one line, what they say on the next
		const meta = document.createElement("div");
		meta.className = "actor-meta";
		meta.append(avatar, emotion, gesture, facing, mode);
		row.append(meta, text, remove);
		return row;
	}

	private degreesFor(avatarName: string): Degrees {
		return (
			this.options.catalog.avatars.find((entry) => entry.name === avatarName)
				?.degrees ?? {}
		);
	}

	private gesturesFor(avatarName: string): string[] {
		return (
			this.options.catalog.avatars.find((entry) => entry.name === avatarName)
				?.gestures ?? []
		);
	}

	// the header quotes the cast and the first line, so a value edit has to redraw it
	private resummarize(index: number): void {
		const panel = this.strip.panels[index];
		const cast = this.cards[index]?.querySelector(".pedit-cast");
		if (panel && cast) cast.textContent = summarize(panel);
	}

	// swaps one card in place, so the rest of the list keeps its scroll and its open card
	private refresh(index: number): void {
		const panel = this.strip.panels[index];
		const old = this.cards[index];
		if (!panel || !old) return;
		const next = this.panelCard(panel, index);
		old.replaceWith(next);
		this.cards[index] = next;
		this.paint();
	}

	// paints the deepest element each issue names, so a bad field is visible without a rebuild
	showIssues(issues: readonly StripIssue[]): void {
		this.issues = issues;
		this.paint();
	}

	private paint(): void {
		const container = this.options.container;
		for (const marked of container.querySelectorAll(
			".has-error, .has-warning",
		)) {
			marked.classList.remove("has-error", "has-warning");
			marked.removeAttribute("title");
		}
		for (const issue of this.issues) {
			let path = issue.path;
			let target = container.querySelector(`[data-path="${path}"]`);
			while (!target && path.includes(".")) {
				path = path.slice(0, path.lastIndexOf("."));
				target = container.querySelector(`[data-path="${path}"]`);
			}
			if (!target) continue;
			target.classList.add(
				issue.severity === "error" ? "has-error" : "has-warning",
			);
			const existing = target.getAttribute("title");
			target.setAttribute(
				"title",
				existing ? `${existing}\n${issue.message}` : issue.message,
			);
		}
	}

	// selection and expansion are the same thing: one panel is open at a time
	focus(index: number): void {
		if (index === this.selected) return;
		const previous = this.selected;
		this.selected = index;
		this.refresh(previous);
		this.refresh(index);
	}

	scrollTo(index: number): void {
		const card = this.cards[index];
		if (card) revealWithin(this.options.scroller, card);
	}
}
