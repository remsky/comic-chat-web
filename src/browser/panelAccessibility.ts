import type { AvatarData } from "../engine/avatar.js";
import type { UnitPanel } from "../engine/panel.js";

export interface PanelTranscriptLine {
	speaker: string;
	text: string;
}

export function panelTranscript(
	panel: UnitPanel,
	avatars: readonly AvatarData[],
): PanelTranscriptLine[] {
	return panel.balloons.map((balloon) => ({
		speaker:
			avatars.find((avatar) => avatar.avatarID === balloon.speaker.avatarID)
				?.name ?? `Avatar ${balloon.speaker.avatarID}`,
		text: balloon.text,
	}));
}

export function panelAccessibleLabel(
	panel: UnitPanel,
	avatars: readonly AvatarData[],
): string {
	const lines = panelTranscript(panel, avatars);
	if (lines.length === 0) return "Comic panel with no dialogue";
	return `Comic panel. ${lines
		.map((line) => `${line.speaker}: ${line.text}`)
		.join(" ")}`;
}

export function syncPanelAccessibility(
	canvas: HTMLCanvasElement,
	transcript: HTMLOListElement,
	panel: UnitPanel,
	avatars: readonly AvatarData[],
): void {
	canvas.setAttribute("role", "img");
	canvas.setAttribute("aria-label", panelAccessibleLabel(panel, avatars));
	const fragment = document.createDocumentFragment();
	for (const line of panelTranscript(panel, avatars)) {
		const item = document.createElement("li");
		const speaker = document.createElement("strong");
		speaker.textContent = `${line.speaker}: `;
		item.append(speaker, line.text);
		fragment.append(item);
	}
	transcript.replaceChildren(fragment);
}
