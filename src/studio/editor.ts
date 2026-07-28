// The constructor: one collapsible card per panel, one row per character in it.

import { displayName, revealWithin } from "../browser/dom.js";
import { TITLE_CHOICES } from "../engine/titlePanel.js";
import { type AvatarArt, emptyArt, splitArtName } from "./art.js";
import { attachReorder, moveItem } from "./reorder.js";
import {
	emptyPanel,
	emptyTitlePanel,
	NEUTRAL_KEY,
	type Strip,
	type StripActor,
	type StripCatalog,
	type StripIssue,
	type StripPanel,
	ZOOM_MAX,
	ZOOM_MIN,
} from "./script.js";
import type { Suggester } from "./suggest.js";

export interface EditorOptions {
	container: HTMLElement;
	// the pane that scrolls, so revealing a card never moves the page itself
	scroller: HTMLElement;
	catalog: StripCatalog;
	// the pose and facing the chat rules would reach for, so untouched fields follow the text
	suggest: Suggester;
	// the character's face icon, drawn inside the picker's options
	icon?: (avatarName: string) => HTMLElement | null;
	// a value changed; the strip is already up to date
	onEdit: () => void;
	onSelect: (index: number) => void;
}

// rich options render only where the browser takes the base-select opt-in
const RICH_SELECT =
	typeof CSS !== "undefined" && CSS.supports("appearance", "base-select");

function named<T extends HTMLElement>(control: T, label: string): T {
	control.setAttribute("aria-label", label);
	control.title = label;
	return control;
}

function selectOf(
	values: readonly string[],
	current: string,
	blank = "None",
	label = displayName,
): HTMLSelectElement {
	const select = document.createElement("select");
	fillOptions(select, values, blank, label);
	select.value = current;
	return select;
}

function fillOptions(
	select: HTMLSelectElement,
	values: readonly string[],
	blank: string,
	label = displayName,
): void {
	select.replaceChildren();
	for (const value of values) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = value === "" ? blank : label(value);
		select.append(option);
	}
}

// "neutral_2" carries the underscore over the wire and reads as "Neutral 2" here
function artLabel(name: string): string {
	const { base, index } = splitArtName(name);
	return index === undefined
		? displayName(base)
		: `${displayName(base)} ${index}`;
}

// every face this character draws, neutral first, under the same names the strip format takes
function fillEmotions(
	select: HTMLSelectElement,
	emotions: readonly string[],
	art: AvatarArt,
): void {
	select.replaceChildren();
	const keys = [NEUTRAL_KEY, ...emotions.filter((key) => key !== NEUTRAL_KEY)];
	for (const key of keys) {
		const count = art.counts[key] ?? 0;
		for (let nth = 1; nth <= count; nth++) {
			const option = document.createElement("option");
			option.value = count === 1 ? key : `${key}_${nth}`;
			option.textContent = artLabel(option.value);
			select.append(option);
		}
	}
}

function emotionValue(actor: StripActor, art: AvatarArt): string {
	const { base, index } = splitArtName(actor.emotion ?? NEUTRAL_KEY);
	const count = art.counts[base] ?? 0;
	if (count === 0) return NEUTRAL_KEY;
	if (count === 1) return base;
	// bare names whichever the engine reaches unasked: the first of the neutrals, the strongest of the rest
	const nth = index ?? (base === NEUTRAL_KEY ? 1 : count);
	return `${base}_${Math.min(Math.max(nth, 1), count)}`;
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
	if (panel.kind === "title") {
		const text = panel.title?.trim() ? `"${panel.title}"` : "untitled";
		const cast = panel.actors
			.map((actor) => actor.text?.trim() || displayName(actor.avatar))
			.join(", ");
		return cast ? `${text} starring ${cast}` : text;
	}
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
		// a title card opens the strip, so its button sits above the cards it would lead
		const addTitle = document.createElement("button");
		addTitle.type = "button";
		addTitle.className = "sbutton sbutton--add";
		addTitle.textContent = "+ Title";
		addTitle.addEventListener("click", () => this.addTitlePanel());
		fragment.append(addTitle);
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
		const panel = emptyPanel();
		const scenes = this.strip.panels.filter((p) => p.kind !== "title").length;
		panel.camera = this.options.suggest.camera(scenes);
		this.strip.panels.push(panel);
		this.structural(this.strip.panels.length - 1);
	}

	addTitlePanel(): void {
		this.strip.panels.unshift(emptyTitlePanel());
		this.structural(0);
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
		if (open)
			card.append(
				panel.kind === "title"
					? this.titleBody(panel, index)
					: this.panelBody(panel, index),
			);
		return card;
	}

	// the title card: one line of title text, then who gets a credit row
	private titleBody(panel: StripPanel, index: number): HTMLElement {
		const body = document.createElement("div");
		body.className = "pedit-body";

		const title = named(document.createElement("input"), "Title");
		title.type = "text";
		title.className = "actor-text";
		title.dataset.path = `panels[${index}].title`;
		title.placeholder = "UNTITLED";
		title.value = panel.title ?? "";
		title.addEventListener("input", () => {
			if (title.value) panel.title = title.value;
			else delete panel.title;
			this.resummarize(index);
			this.options.onEdit();
		});

		// cycles the classic 1996 titles, skipping whatever is already in the box
		const cycle = iconButton("⟳", "Cycle a classic title");
		cycle.addEventListener("click", () => {
			const pool = TITLE_CHOICES.filter((entry) => entry !== title.value);
			const pick = pool[Math.floor(Math.random() * pool.length)];
			if (!pick) return;
			title.value = pick;
			panel.title = pick;
			this.resummarize(index);
			this.options.onEdit();
		});

		const row = document.createElement("div");
		row.className = "pedit-title";
		row.append(title, cycle);

		// the line over the cast, so "STARRING" can become "A Story Told By"
		const starring = named(document.createElement("input"), "Starring line");
		starring.type = "text";
		starring.className = "actor-text";
		starring.dataset.path = `panels[${index}].starring`;
		starring.placeholder = "STARRING";
		starring.value = panel.starring ?? "";
		starring.addEventListener("input", () => {
			if (starring.value) panel.starring = starring.value;
			else delete panel.starring;
			this.options.onEdit();
		});

		const stars = document.createElement("ol");
		stars.className = "pedit-actors";
		panel.actors.forEach((actor, actorIndex) => {
			stars.append(this.starRow(panel, actor, index, actorIndex));
		});

		const addStar = document.createElement("button");
		addStar.type = "button";
		addStar.className = "sbutton sbutton--add";
		addStar.textContent = "+ Character";
		addStar.disabled = panel.actors.length >= this.options.catalog.maxActors;
		addStar.addEventListener("click", () => {
			const first = this.options.catalog.avatars[0];
			if (!first) return;
			panel.actors.push({ avatar: first.name });
			this.refresh(index);
			this.options.onEdit();
		});

		// the bottom line, blank until someone wants a "Written by"
		const footer = named(document.createElement("input"), "Footer line");
		footer.type = "text";
		footer.className = "actor-text";
		footer.dataset.path = `panels[${index}].footer`;
		footer.placeholder = "Footer (optional)";
		footer.value = panel.footer ?? "";
		footer.addEventListener("input", () => {
			if (footer.value) panel.footer = footer.value;
			else delete panel.footer;
			this.options.onEdit();
		});

		body.append(row, starring, stars, addStar, footer);
		return body;
	}

	private starRow(
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
		avatar.addEventListener("change", () => {
			actor.avatar = avatar.value;
			this.resummarize(panelIndex);
			this.options.onEdit();
		});

		const text = named(document.createElement("input"), "Credit name");
		text.type = "text";
		text.className = "actor-text";
		text.placeholder = `Credited as ${displayName(actor.avatar)}`;
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

		const meta = document.createElement("div");
		meta.className = "actor-meta";
		meta.append(avatar);
		row.append(meta, text, remove);
		return row;
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
			this.reface(panel, () => {
				panel.actors.push({ avatar: first.name });
			});
			this.refresh(index);
			this.options.onEdit();
		});

		body.append(settings, actors, addActor);
		return body;
	}

	// the cast changed, so whoever has not been turned by hand faces their new neighbours
	private reface(panel: StripPanel, mutate: () => void): void {
		const before = this.options.suggest.facings(panel);
		const pinned = new Map(
			panel.actors.map((actor, index) => [
				actor,
				(actor.facing ?? "right") !== before[index],
			]),
		);
		mutate();
		this.options.suggest.facings(panel).forEach((facing, index) => {
			const actor = panel.actors[index];
			if (!actor || pinned.get(actor)) return;
			if (facing === "right") delete actor.facing;
			else actor.facing = facing;
		});
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

		const avatar = named(this.characterSelect(actor.avatar), "Character");
		avatar.className = "actor-who";
		// selectedcontent mirrors the icon itself; the fallback keeps one beside the select
		let face: HTMLSpanElement | null = null;
		let paintFace = (): void => {};
		if (!RICH_SELECT && this.options.icon) {
			face = document.createElement("span");
			face.className = "actor-icon";
			const slot = face;
			paintFace = () => {
				const icon = this.options.icon?.(actor.avatar);
				slot.replaceChildren(...(icon ? [icon] : []));
			};
			paintFace();
		}
		const gesture = named(
			selectOf(
				["", ...this.gesturesFor(actor.avatar)],
				actor.gesture ?? "",
				"No gesture",
				artLabel,
			),
			"Gesture",
		);

		let art = this.artFor(actor.avatar);
		const emotion = named(document.createElement("select"), "Emotion");
		fillEmotions(emotion, this.options.catalog.emotions, art);
		emotion.value = emotionValue(actor, art);

		let auto = actor.emotion === undefined && actor.gesture === undefined;

		avatar.addEventListener("change", () => {
			actor.avatar = avatar.value;
			paintFace();
			const available = this.gesturesFor(actor.avatar);
			if (actor.gesture && !available.includes(actor.gesture))
				delete actor.gesture;
			fillOptions(gesture, ["", ...available], "No gesture", artLabel);
			gesture.value = actor.gesture ?? "";
			art = this.artFor(actor.avatar);
			fillEmotions(emotion, this.options.catalog.emotions, art);
			if (actor.emotion !== undefined) {
				const { base, index } = splitArtName(actor.emotion);
				const count = art.counts[base] ?? 0;
				if (count === 0) delete actor.emotion;
				else if (index !== undefined && index > count)
					actor.emotion = `${base}_${count}`;
			}
			emotion.value = emotionValue(actor, art);
			this.resummarize(panelIndex);
			this.options.onEdit();
		});
		gesture.addEventListener("change", () => {
			if (gesture.value) actor.gesture = gesture.value;
			else delete actor.gesture;
			this.options.onEdit();
		});
		emotion.addEventListener("change", () => {
			actor.emotion = emotion.value;
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

		const details = document.createElement("span");
		details.className = "actor-details";
		details.append(emotion, gesture, facing, mode);
		if (auto) details.hidden = true;

		const autoToggle = document.createElement("span");
		autoToggle.className = "seg actor-auto";
		autoToggle.setAttribute("role", "group");
		autoToggle.setAttribute("aria-label", "Pose mode");
		const autoBtn = document.createElement("button");
		autoBtn.type = "button";
		autoBtn.className = "sicon seg-option";
		autoBtn.innerHTML =
			'<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">' +
			'<path d="M9 0L3 9h4l-1 7 7-10H9z"/>' +
			"</svg>";
		autoBtn.title = "Auto pose";
		autoBtn.setAttribute("aria-pressed", String(auto));
		const manualBtn = document.createElement("button");
		manualBtn.type = "button";
		manualBtn.className = "sicon seg-option";
		manualBtn.innerHTML =
			'<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">' +
			'<path d="M6 0h4v2.2a5.5 5.5 0 011.7 1L13.4 1.5 15.2 3.3 13.5 5a5.5 5.5 0 011 1.7H16v4h-2.2a5.5 5.5 0 01-1 1.7l1.7 1.7-1.8 1.8L11 13.5a5.5 5.5 0 01-1.7 1V16H6v-2.2a5.5 5.5 0 01-1.7-1L2.6 14.5.8 12.7 2.5 11a5.5 5.5 0 01-1-1.7H0V6h2.2a5.5 5.5 0 011-1.7L1.5 2.6 3.3.8 5 2.5A5.5 5.5 0 016.7 1.5V0zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/>' +
			"</svg>";
		manualBtn.title = "Configure pose";
		manualBtn.setAttribute("aria-pressed", String(!auto));
		autoToggle.append(manualBtn, autoBtn);
		const setMode = (next: boolean) => {
			auto = next;
			autoBtn.setAttribute("aria-pressed", String(auto));
			manualBtn.setAttribute("aria-pressed", String(!auto));
			details.hidden = auto;
			if (auto) {
				delete actor.emotion;
				delete actor.gesture;
			} else {
				const snap = this.options.suggest.snapshot(actor);
				actor.emotion = snap.emotion;
				actor.gesture = snap.gesture;
				emotion.value = emotionValue(actor, art);
				gesture.value = actor.gesture ?? "";
			}
			this.options.onEdit();
		};
		autoBtn.addEventListener("click", () => {
			if (!auto) setMode(true);
		});
		manualBtn.addEventListener("click", () => {
			if (auto) setMode(false);
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
			this.reface(panel, () => {
				panel.actors.splice(actorIndex, 1);
			});
			this.refresh(panelIndex);
			this.options.onEdit();
		});

		// who and how on one line, what they say on the next
		const meta = document.createElement("div");
		meta.className = "actor-meta";
		if (face) meta.append(face);
		meta.append(avatar, details);
		row.append(autoToggle, meta, text, remove);
		return row;
	}

	// options carry the icon and name where the browser allows it, the name alone elsewhere
	private characterSelect(current: string): HTMLSelectElement {
		const select = document.createElement("select");
		if (RICH_SELECT && this.options.icon) {
			const button = document.createElement("button");
			button.append(document.createElement("selectedcontent"));
			select.append(button);
		}
		for (const entry of this.options.catalog.avatars) {
			const option = document.createElement("option");
			option.value = entry.name;
			const icon = RICH_SELECT ? this.options.icon?.(entry.name) : null;
			if (icon) option.append(icon);
			option.append(displayName(entry.name));
			select.append(option);
		}
		select.value = current;
		return select;
	}

	private artFor(avatarName: string): AvatarArt {
		return (
			this.options.catalog.avatars.find((entry) => entry.name === avatarName)
				?.art ?? emptyArt()
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
