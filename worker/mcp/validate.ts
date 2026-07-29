import type { Catalog, CatalogAvatar } from "./catalog.js";

const LONG_BALLOON = 90;
const LONG_TITLE = 30;
const LONG_CREDIT = 24;
const LONG_FOOTER = 40;

const STRIP_KEYS = ["version", "size", "seed", "columns", "panels"];
const PANEL_KEYS = [
	"kind",
	"title",
	"starring",
	"footer",
	"background",
	"camera",
	"zoom",
	"border",
	"actors",
];
const ACTOR_KEYS = ["avatar", "text", "mode", "emotion", "gesture", "facing"];
const SCENE_KEYS = ["background", "camera", "zoom", "border"];
const TITLE_KEYS = ["title", "starring", "footer"];

export interface StripIssue {
	path: string;
	message: string;
	severity: "error" | "warning";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitName(name: string): { base: string; index?: number } {
	const match = /^([a-z]+)_(\d+)$/.exec(name);
	return match?.[1]
		? { base: match[1], index: Number(match[2]) }
		: { base: name };
}

function checkKeys(
	raw: Record<string, unknown>,
	allowed: string[],
	path: string,
	issues: StripIssue[],
): void {
	for (const key of Object.keys(raw))
		if (!allowed.includes(key))
			issues.push({
				path: path ? `${path}.${key}` : key,
				message: `unknown field "${key}"`,
				severity: "warning",
			});
}

function checkEnum(
	raw: Record<string, unknown>,
	key: string,
	allowed: readonly string[],
	path: string,
	issues: StripIssue[],
): void {
	if (raw[key] === undefined) return;
	if (!allowed.includes(raw[key] as string))
		issues.push({
			path: `${path}.${key}`,
			message: `unknown ${key} "${String(raw[key])}"; use one of ${allowed.join(", ")}`,
			severity: "error",
		});
}

function checkActor(
	raw: unknown,
	path: string,
	catalog: Catalog,
	avatars: Map<string, CatalogAvatar>,
	issues: StripIssue[],
): void {
	if (!isRecord(raw)) {
		issues.push({
			path,
			message: "actor must be an object",
			severity: "error",
		});
		return;
	}
	checkKeys(raw, ACTOR_KEYS, path, issues);
	const entry = avatars.get(raw.avatar as string);
	if (typeof raw.avatar !== "string" || raw.avatar === "")
		issues.push({
			path: `${path}.avatar`,
			message: "avatar is required",
			severity: "error",
		});
	else if (!entry)
		issues.push({
			path: `${path}.avatar`,
			message: `unknown character "${raw.avatar}"`,
			severity: "error",
		});

	if (raw.text !== undefined && typeof raw.text !== "string")
		issues.push({
			path: `${path}.text`,
			message: "text must be a string",
			severity: "error",
		});
	else if (typeof raw.text === "string" && raw.text.length > LONG_BALLOON)
		issues.push({
			path: `${path}.text`,
			message: `${raw.text.length} characters will crowd the art; split it across panels`,
			severity: "warning",
		});

	checkEnum(raw, "mode", catalog.modes, path, issues);
	checkEnum(raw, "facing", catalog.facings, path, issues);

	if (raw.emotion !== undefined) {
		const { base, index } = splitName(String(raw.emotion));
		const count = entry?.emotions[base] ?? 0;
		if (!catalog.emotions.includes(base))
			issues.push({
				path: `${path}.emotion`,
				message: `unknown emotion "${String(raw.emotion)}"`,
				severity: "error",
			});
		else if (entry && count === 0) {
			const available = Object.entries(entry.emotions)
				.filter(([, n]) => n > 0)
				.map(([e]) => e)
				.join(", ");
			issues.push({
				path: `${path}.emotion`,
				message: `${entry.name} has no "${base}" art and will pose neutral. available: ${available}`,
				severity: "warning",
			});
		} else if (index !== undefined && (index < 1 || index > count))
			issues.push({
				path: `${path}.emotion`,
				message: `${entry?.name} draws ${count} "${base}" face(s), so "${base}" or "${base}_1" to "${base}_${count}"`,
				severity: "error",
			});
		const alias = entry?.aliases?.[base];
		if (alias !== undefined)
			issues.push({
				path: `${path}.emotion`,
				message: `${entry?.name} draws "${base}" with its "${alias}" faces, so the two look the same`,
				severity: "warning",
			});
	}

	if (raw.gesture !== undefined) {
		const gesture = String(raw.gesture);
		const { base, index } = splitName(gesture);
		const named =
			catalog.gestures.includes(gesture) ||
			(catalog.emotions.includes(base) && index !== undefined);
		if (!named)
			issues.push({
				path: `${path}.gesture`,
				message: `unknown gesture "${gesture}"`,
				severity: "error",
			});
		else if (entry && !(entry.gestures ?? []).includes(gesture)) {
			const available = (entry.gestures ?? []).join(", ");
			issues.push({
				path: `${path}.gesture`,
				message: `${entry.name} has no "${gesture}" art and will pose neutral. available: ${available}`,
				severity: "warning",
			});
		}
	}
}

function checkStar(
	raw: unknown,
	path: string,
	avatars: Map<string, CatalogAvatar>,
	issues: StripIssue[],
): void {
	if (!isRecord(raw)) {
		issues.push({
			path,
			message: "actor must be an object",
			severity: "error",
		});
		return;
	}
	checkKeys(raw, ACTOR_KEYS, path, issues);
	if (typeof raw.avatar !== "string" || raw.avatar === "")
		issues.push({
			path: `${path}.avatar`,
			message: "avatar is required",
			severity: "error",
		});
	else if (!avatars.has(raw.avatar))
		issues.push({
			path: `${path}.avatar`,
			message: `unknown character "${raw.avatar}"`,
			severity: "error",
		});

	if (raw.text !== undefined && typeof raw.text !== "string")
		issues.push({
			path: `${path}.text`,
			message: "text must be a string",
			severity: "error",
		});
	else if (typeof raw.text === "string" && raw.text.length > LONG_CREDIT)
		issues.push({
			path: `${path}.text`,
			message: `${raw.text.length} characters is a long credit; the rows centre on the widest one`,
			severity: "warning",
		});

	for (const key of ["mode", "emotion", "gesture", "facing"])
		if ((raw as Record<string, unknown>)[key] !== undefined)
			issues.push({
				path: `${path}.${key}`,
				message: `a credit row ignores ${key}`,
				severity: "warning",
			});
}

function checkTitlePanel(
	raw: Record<string, unknown>,
	path: string,
	catalog: Catalog,
	avatars: Map<string, CatalogAvatar>,
	issues: StripIssue[],
): void {
	for (const key of SCENE_KEYS)
		if (raw[key] !== undefined)
			issues.push({
				path: `${path}.${key}`,
				message: `a title card ignores ${key}`,
				severity: "warning",
			});

	for (const key of TITLE_KEYS)
		if (raw[key] !== undefined && typeof raw[key] !== "string")
			issues.push({
				path: `${path}.${key}`,
				message: `${key} must be a string`,
				severity: "error",
			});

	if (
		typeof raw.title === "string" &&
		(raw.title as string).length > LONG_TITLE
	)
		issues.push({
			path: `${path}.title`,
			message: `${(raw.title as string).length} characters wraps the title over several lines and crowds the cast off the card`,
			severity: "warning",
		});
	if (
		typeof raw.footer === "string" &&
		(raw.footer as string).length > LONG_FOOTER
	)
		issues.push({
			path: `${path}.footer`,
			message: `${(raw.footer as string).length} characters is a long footer; it draws on one line`,
			severity: "warning",
		});

	if (!Array.isArray(raw.actors)) {
		issues.push({
			path: `${path}.actors`,
			message: "actors must be an array",
			severity: "error",
		});
		return;
	}
	if (raw.actors.length === 0)
		issues.push({
			path: `${path}.actors`,
			message: "title card credits nobody",
			severity: "warning",
		});
	if (raw.actors.length > catalog.limits.actors)
		issues.push({
			path: `${path}.actors`,
			message: `a card holds at most ${catalog.limits.actors} credit rows`,
			severity: "error",
		});
	(raw.actors as unknown[]).forEach((actor, index) => {
		checkStar(actor, `${path}.actors[${index}]`, avatars, issues);
	});
}

function checkPanel(
	raw: unknown,
	path: string,
	catalog: Catalog,
	avatars: Map<string, CatalogAvatar>,
	issues: StripIssue[],
): void {
	if (!isRecord(raw)) {
		issues.push({
			path,
			message: "panel must be an object",
			severity: "error",
		});
		return;
	}
	checkKeys(raw, PANEL_KEYS, path, issues);
	checkEnum(raw, "kind", catalog.kinds, path, issues);
	if (raw.kind === "title") {
		checkTitlePanel(raw, path, catalog, avatars, issues);
		return;
	}
	for (const key of TITLE_KEYS)
		if (raw[key] !== undefined)
			issues.push({
				path: `${path}.${key}`,
				message: `${key} draws only on a "title" panel`,
				severity: "warning",
			});
	if (raw.background !== undefined && raw.background !== "")
		checkEnum(raw, "background", catalog.backgrounds, path, issues);
	checkEnum(raw, "camera", catalog.cameras, path, issues);

	const [zoomMin, zoomMax] = catalog.limits.zoom;
	if (raw.zoom !== undefined) {
		if (typeof raw.zoom !== "number" || !Number.isFinite(raw.zoom))
			issues.push({
				path: `${path}.zoom`,
				message: "zoom must be a number",
				severity: "error",
			});
		else if (raw.zoom < zoomMin || raw.zoom > zoomMax)
			issues.push({
				path: `${path}.zoom`,
				message: `zoom must be ${zoomMin} to ${zoomMax}`,
				severity: "error",
			});
	}
	if (raw.border !== undefined && typeof raw.border !== "boolean")
		issues.push({
			path: `${path}.border`,
			message: "border must be a boolean",
			severity: "error",
		});

	if (!Array.isArray(raw.actors)) {
		issues.push({
			path: `${path}.actors`,
			message: "actors must be an array",
			severity: "error",
		});
		return;
	}
	if (raw.actors.length === 0)
		issues.push({
			path: `${path}.actors`,
			message: "panel draws nobody",
			severity: "warning",
		});
	if (raw.actors.length > catalog.limits.actors)
		issues.push({
			path: `${path}.actors`,
			message: `a panel holds at most ${catalog.limits.actors} characters`,
			severity: "error",
		});
	const balloons = (raw.actors as unknown[]).filter(
		(actor) => isRecord(actor) && actor.text,
	).length;
	if (balloons > catalog.limits.balloons)
		issues.push({
			path: `${path}.actors`,
			message: `a panel holds at most ${catalog.limits.balloons} balloons`,
			severity: "error",
		});
	(raw.actors as unknown[]).forEach((actor, index) => {
		checkActor(actor, `${path}.actors[${index}]`, catalog, avatars, issues);
	});
}

function checkShape(panels: unknown[], issues: StripIssue[]): void {
	panels.forEach((panel, index) => {
		if (isRecord(panel) && panel.kind === "title" && index > 0)
			issues.push({
				path: `panels[${index}]`,
				message: "a title card opens a strip; this one interrupts one",
				severity: "warning",
			});
	});
	const drawn = panels
		.map((panel, index) => ({ panel, index }))
		.filter(({ panel }) => isRecord(panel) && panel.kind !== "title");
	if (drawn.length < 3) return;
	const actorsOf = ({ panel }: { panel: unknown }) =>
		(Array.isArray((panel as Record<string, unknown>).actors)
			? ((panel as Record<string, unknown>).actors as unknown[])
			: []
		).filter(isRecord);

	if (
		drawn.every(({ panel }) => !(panel as Record<string, unknown>).background)
	)
		issues.push({
			path: "panels",
			message: "no panel has a backdrop; a blank strip reads unfinished",
			severity: "warning",
		});

	const close = drawn.filter(
		({ panel }) => (panel as Record<string, unknown>).camera === "close",
	).length;
	if (close * 2 >= drawn.length)
		issues.push({
			path: "panels",
			message: `${close} of ${drawn.length} panels are close shots; wide should carry most of a strip`,
			severity: "warning",
		});

	if (!drawn.some((entry) => actorsOf(entry).some((actor) => actor.gesture)))
		issues.push({
			path: "panels",
			message:
				"no panel names a gesture, so every figure holds the same standing pose",
			severity: "warning",
		});

	const faces = new Map<string, { index: number; face: string }[]>();
	drawn.forEach((entry) => {
		for (const actor of actorsOf(entry)) {
			if (typeof actor.avatar !== "string") continue;
			const held = faces.get(actor.avatar) ?? [];
			const face =
				actor.emotion !== undefined
					? String(actor.emotion)
					: actor.text
						? `<auto:${entry.index}>`
						: "neutral";
			held.push({ index: entry.index, face });
			faces.set(actor.avatar, held);
		}
	});
	for (const [avatar, held] of faces) {
		let run = 1;
		for (let i = 1; i < held.length; i++) {
			const previous = held[i - 1];
			const current = held[i];
			if (!previous || !current) continue;
			run =
				current.face === previous.face && current.index === previous.index + 1
					? run + 1
					: 1;
			if (run === 3)
				issues.push({
					path: "panels",
					message: `${avatar} wears "${current.face}" in panels[${current.index - 2}] through panels[${current.index}]; vary the face`,
					severity: "warning",
				});
		}
	}
}

export function checkStrip(raw: unknown, catalog: Catalog): StripIssue[] {
	const issues: StripIssue[] = [];
	const avatars = new Map(catalog.avatars.map((a) => [a.name, a]));

	if (!isRecord(raw)) {
		issues.push({
			path: "",
			message: "strip must be a JSON object",
			severity: "error",
		});
		return issues;
	}
	checkKeys(raw, STRIP_KEYS, "", issues);
	if (raw.version !== catalog.version)
		issues.push({
			path: "version",
			message: `expected version ${catalog.version}`,
			severity: "warning",
		});
	checkEnum(raw, "size", catalog.sizes, "", issues);
	if (raw.seed !== undefined && !Number.isInteger(raw.seed))
		issues.push({
			path: "seed",
			message: "seed must be an integer",
			severity: "error",
		});

	const [colMin, colMax] = catalog.limits.columns;
	if (raw.columns !== undefined) {
		if (!Number.isInteger(raw.columns))
			issues.push({
				path: "columns",
				message: "columns must be an integer",
				severity: "error",
			});
		else if (
			(raw.columns as number) < colMin ||
			(raw.columns as number) > colMax
		)
			issues.push({
				path: "columns",
				message: `columns must be ${colMin} to ${colMax}`,
				severity: "error",
			});
	}

	if (!Array.isArray(raw.panels)) {
		issues.push({
			path: "panels",
			message: "panels must be an array",
			severity: "error",
		});
		return issues;
	}
	if (raw.panels.length === 0)
		issues.push({
			path: "panels",
			message: "strip has no panels",
			severity: "warning",
		});
	(raw.panels as unknown[]).forEach((panel, index) => {
		checkPanel(panel, `panels[${index}]`, catalog, avatars, issues);
	});
	checkShape(raw.panels as unknown[], issues);
	return issues;
}
