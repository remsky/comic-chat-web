// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ComposerAutocomplete } from "../src/browser/composerAutocomplete.js";
import { gestureInsert } from "../src/browser/gestures.js";

const NICKS = ["anna", "bolo"];
const GESTURES = ["wave", "point", "shrug"];

function mount(): HTMLInputElement {
	document.body.replaceChildren();
	const input = document.createElement("input");
	document.body.append(input);
	new ComposerAutocomplete({
		input,
		sources: [
			{
				sigil: "@",
				isEnabled: () => true,
				list: () => NICKS,
				insert: (name, head) => (head.trim() === "" ? `${name}: ` : `${name} `),
			},
			{
				sigil: "/",
				lineStartOnly: true,
				showSigil: true,
				isEnabled: () => true,
				list: () => GESTURES,
				insert: gestureInsert,
			},
		],
	});
	return input;
}

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.setSelectionRange(value.length, value.length);
	input.dispatchEvent(new Event("input"));
}

function press(input: HTMLInputElement, key: string): void {
	input.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function menuItems(): string[] {
	return Array.from(document.querySelectorAll(".completion-menu li")).map(
		(item) => item.textContent ?? "",
	);
}

describe("gesture completion", () => {
	it("shows the slash, because the slash is what triggers the pose", () => {
		const input = mount();
		type(input, "/");
		expect(menuItems()).toEqual(["/wave", "/point", "/shrug"]);
	});

	it("accepts back into the composer as a command the parser still sees", () => {
		const input = mount();
		type(input, "/");
		press(input, "Enter");
		expect(input.value).toBe("/wave ");
	});

	it("filters on the typed prefix", () => {
		const input = mount();
		type(input, "/sh");
		expect(menuItems()).toEqual(["/shrug"]);
		press(input, "Enter");
		expect(input.value).toBe("/shrug ");
	});

	it("stays shut for a slash that does not open the line", () => {
		const input = mount();
		type(input, "well /sh");
		expect(menuItems()).toEqual([]);
	});

	it("moves the selection with the arrow keys", () => {
		const input = mount();
		type(input, "/");
		press(input, "ArrowDown");
		press(input, "Enter");
		expect(input.value).toBe("/point ");
	});
});

describe("mention completion", () => {
	it("inserts a bare nick, address form at the line start", () => {
		const input = mount();
		type(input, "@an");
		expect(menuItems()).toEqual(["anna"]);
		press(input, "Enter");
		expect(input.value).toBe("anna: ");
	});

	it("inserts a bare nick mid-line", () => {
		const input = mount();
		type(input, "hey @bo");
		press(input, "Enter");
		expect(input.value).toBe("hey bolo ");
	});
});
