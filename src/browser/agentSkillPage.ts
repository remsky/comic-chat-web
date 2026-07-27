// The agent skill page: a copy button on each install command block.

import { element } from "./dom.js";

const COPIED_MS = 1200;

const template = element<HTMLTemplateElement>("copy-button");

for (const block of document.querySelectorAll<HTMLPreElement>(
	"pre.copy-block",
)) {
	const button = template.content.firstElementChild?.cloneNode(
		true,
	) as HTMLButtonElement;
	const command = block.textContent ?? "";
	button.addEventListener("click", () => {
		void navigator.clipboard.writeText(command).then(() => {
			button.dataset.copied = "";
			window.setTimeout(() => {
				delete button.dataset.copied;
			}, COPIED_MS);
		});
	});
	block.append(button);
}
