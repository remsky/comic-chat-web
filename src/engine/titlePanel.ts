// The "STARRING" opener from CUnitPanelPage::AddTitle/AddStars (v2.5 panel.cpp:1279-1446).

export interface TitleStar {
	avatarID: number;
	label: string;
}

export interface TitleCard {
	text: string;
	starring?: string;
	footer?: string;
	stars: TitleStar[];
}

export interface StarCandidate extends TitleStar {
	self?: boolean;
	departed?: boolean;
	sends?: number;
}

// IDS_TITLE1..16 (chat.rc:2484-2490, 2364-2372)
export const TITLE_TABLE: readonly string[] = [
	"EVERYONE'S A COMIC",
	"DOGGY DOGGY WAH WAH",
	"YOU SHOULDA BEEN THERE",
	"NO EXIT",
	"WISH YOU WERE HERE",
	"DEEPEST DARKEST DESIRES",
	"JUST US CHUMPS",
	"SIGHTED IN CYBERSPACE",
	"THE GANG'S ALL HERE",
	"BORN TO CHAT",
	"NETWORKED NERDS",
	"VIRTUALLY VACUOUS",
	"IF I ONLY HAD A BRAIN",
	"SLUMBER PARTY",
	"MEET MARKET",
	"MICROSOFT CHAT",
];

// the table stays whole as the 1996 record; the port skips two
export const TITLE_CHOICES: readonly string[] = TITLE_TABLE.filter(
	(title) => title !== "DOGGY DOGGY WAH WAH" && title !== "MICROSOFT CHAT",
);

// IDS_NOTITLE (chat.rc:2483) and ID_STARRING (chat.rc:2275)
export const NO_TITLE = "UNTITLED";
export const STARRING = "STARRING";

// nominal unit the layout constants were tuned against (fonts.cpp:102)
export const TITLE_UNIT = 4860;
// ICONSIZE / ICONSPACE / BELOWSTARRING (panel.cpp:42-44)
export const STAR_ICON_SIZE = 500;
export const STAR_ICON_SPACE = 100;
export const BELOW_STARRING = 300;
// clearance kept above and below the footer line
export const FOOTER_MARGIN = 240;
// how far the footer will shrink to fit under a full cast before a credit row goes
export const FOOTER_MIN_SCALE = 0.6;
// nFontHeightTitle / nFontHeightShout magnitudes (defines.h:137-138)
const TITLE_CELL = 576;
const SHOUT_CELL = 252;
// the title font's vertical kern (fonts.cpp:135)
export const TITLE_LEADING = -220;

// GetRandomTitle (panel.cpp:454-474)
export function randomTitle(randfloat: () => number): string {
	const chosen = Math.min(
		Math.trunc(randfloat() * TITLE_CHOICES.length),
		TITLE_CHOICES.length - 1,
	);
	return TITLE_CHOICES[chosen] ?? NO_TITLE;
}

// UpdateTitleFonts scales with the unit but never drops below the balloon font (fonts.cpp:103-128)
export function titleFontCell(unit: number, balloonCell: number): number {
	return Math.max(
		Math.round((TITLE_CELL * unit) / TITLE_UNIT),
		Math.round(1.2 * balloonCell),
	);
}

export function shoutFontCell(unit: number, balloonCell: number): number {
	return Math.max(Math.round((SHOUT_CELL * unit) / TITLE_UNIT), balloonCell);
}

// AddStarsAux ordering: self first, the departed last, busier talkers higher (panel.cpp:477-510)
export function orderStars(candidates: readonly StarCandidate[]): TitleStar[] {
	return candidates
		.map((candidate, index) => ({ candidate, index }))
		.sort((a, b) => {
			if ((a.candidate.self ?? false) !== (b.candidate.self ?? false))
				return a.candidate.self ? -1 : 1;
			if ((a.candidate.departed ?? false) !== (b.candidate.departed ?? false))
				return a.candidate.departed ? 1 : -1;
			const sends = (b.candidate.sends ?? 0) - (a.candidate.sends ?? 0);
			return sends !== 0 ? sends : a.index - b.index;
		})
		.map(({ candidate }) => ({
			avatarID: candidate.avatarID,
			label: candidate.label,
		}));
}
