interface ScreenActor {
	text?: string;
}

interface ScreenPanel {
	title?: string;
	starring?: string;
	footer?: string;
	actors: ScreenActor[];
}

export interface ScreenStrip {
	panels: ScreenPanel[];
}

export function screenStrip(
	strip: ScreenStrip,
	prohibited: (text: string) => boolean,
): string[] {
	const flagged: string[] = [];
	strip.panels.forEach((panel, p) => {
		for (const key of ["title", "starring", "footer"] as const) {
			const value = panel[key];
			if (value && prohibited(value)) flagged.push(`panels[${p}].${key}`);
		}
		panel.actors.forEach((actor, a) => {
			if (actor.text && prohibited(actor.text))
				flagged.push(`panels[${p}].actors[${a}].text`);
		});
	});
	return flagged;
}
