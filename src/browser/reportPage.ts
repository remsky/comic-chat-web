// The report page: renders the snapshot the room handed over, and clears it from storage as it loads.

import { element } from "./dom.js";
import { takeReport } from "./report.js";

const COPY_LABEL = "Copy transcript";

const text = element<HTMLTextAreaElement>("report-text");
const copy = element<HTMLButtonElement>("report-copy");
const draft = takeReport(sessionStorage);

if (draft) text.value = draft;
else
	element<HTMLParagraphElement>("report-status").textContent =
		"No transcript carried over. Press Report inside a room to capture one.";

copy.addEventListener("click", () => {
	void navigator.clipboard.writeText(text.value).then(
		() => {
			copy.textContent = "Copied";
		},
		() => {
			copy.textContent = "Copy failed";
		},
	);
	window.setTimeout(() => {
		copy.textContent = COPY_LABEL;
	}, 2000);
});
