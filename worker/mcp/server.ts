import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	type LinkStore,
	mintShortLink,
	SHORT_LINK_PATH,
} from "../shortlink.js";
import type { Catalog, CatalogAvatar } from "./catalog.js";
import { loadCatalog } from "./catalog.js";
import { loadBlob, loadDoc } from "./docs.js";
import { stripLinks } from "./link.js";
import { screenStrip } from "./screen.js";
import { checkStrip, MAX_TEXT, MAX_TITLE } from "./validate.js";

// hard caps sized from catalog names and the warn thresholds in validate.ts
const actorSchema = z.strictObject({
	avatar: z.string().max(32).describe("Character name from the catalog"),
	text: z.string().max(MAX_TEXT).optional().describe("Balloon text"),
	mode: z
		.enum(["say", "think", "whisper", "action"])
		.optional()
		.describe("Balloon style, default say"),
	emotion: z
		.string()
		.max(32)
		.optional()
		.describe("Face name, or name_N to pin a variant"),
	gesture: z
		.string()
		.max(32)
		.optional()
		.describe("Pose name from the character's inventory"),
	facing: z
		.enum(["left", "right"])
		.optional()
		.describe("Direction the character faces"),
});

const panelSchema = z.strictObject({
	kind: z
		.enum(["scene", "title"])
		.optional()
		.describe("Panel type, default scene"),
	title: z
		.string()
		.max(MAX_TITLE)
		.optional()
		.describe("Heading, title panels only"),
	starring: z
		.string()
		.max(MAX_TITLE)
		.optional()
		.describe("Subheading, title panels only"),
	footer: z
		.string()
		.max(MAX_TITLE)
		.optional()
		.describe("Footer text, title panels only"),
	background: z
		.string()
		.max(32)
		.optional()
		.describe("Background name from the catalog"),
	camera: z
		.enum(["wide", "close"])
		.optional()
		.describe("Shot framing, default wide"),
	zoom: z.number().optional().describe("Zoom level, 0.5 to 2"),
	border: z.boolean().optional().describe("Draw panel border"),
	actors: z.array(actorSchema).max(5).describe("Characters in this panel"),
});

const stripSchema = z.strictObject({
	version: z.number().describe("Schema version, currently 2"),
	seed: z
		.number()
		.int()
		.optional()
		.describe("Random seed for deterministic layout"),
	columns: z.number().int().optional().describe("Grid columns, 1 to 8"),
	panels: z.array(panelSchema).max(32).describe("Ordered list of panels"),
});

function isExpressive(a: CatalogAvatar): boolean {
	return Object.values(a.emotions).reduce((sum, n) => sum + n, 0) > 1;
}

const LEGEND =
	'legend: "happy 3" = 3 variants; use emotion "happy" or "happy_1" through "happy_3" to pin one. "(drawn as sad)" = reuses sad\'s art. poses are literal names.';

function facesOf(entry: CatalogAvatar): string {
	return Object.entries(entry.emotions)
		.filter(([, count]) => count > 0)
		.map(([face, count]) => {
			const alias = entry.aliases?.[face];
			return alias
				? `${face} ${count} (drawn as ${alias})`
				: `${face} ${count}`;
		})
		.join(", ");
}

function findRegister(catalog: Catalog, wanted: string) {
	return catalog.registers.find((group) =>
		group.key.startsWith(wanted.toLowerCase()),
	);
}

function registersOf(catalog: Catalog, name: string): string[] {
	return catalog.registers
		.filter((group) => group.names.includes(name))
		.map((group) => group.label);
}

function describeAvatar(entry: CatalogAvatar, catalog: Catalog): string {
	const groups = registersOf(catalog, entry.name);
	const lines = [entry.name];
	if (entry.look && entry.range)
		lines.push(`  look     ${entry.look}`, `  range    ${entry.range}`);
	lines.push(`  faces    ${facesOf(entry)}`);
	lines.push(`  poses    ${(entry.gestures ?? []).join(", ") || "none"}`);
	if (groups.length > 0) lines.push(`  register ${groups.join("; ")}`);
	return lines.join("\n");
}

function summarizeAvatar(entry: CatalogAvatar): string {
	const lead = entry.look ? `${entry.look}. ` : "";
	if (!isExpressive(entry)) return `  ${entry.name}: ${lead}one drawing`;
	const faces = Object.keys(entry.emotions).filter(
		(e) => (entry.emotions[e] ?? 0) > 0,
	);
	const poses = (entry.gestures ?? []).length;
	return `  ${entry.name}: ${lead}${faces.join(" ")}${poses ? `, ${poses} poses` : ""}`;
}

function buildCastBlock(catalog: Catalog): string {
	return [
		`cast (${catalog.avatars.length}):`,
		...catalog.avatars.map(summarizeAvatar),
		'  "one drawing" characters still take speaking parts; the fixed face is the performance.',
		`  registers: ${catalog.registers.map((group) => group.key).join(", ")}. query_cast filters by them.`,
	].join("\n");
}

function buildBearings(catalog: Catalog): string {
	return [
		`backgrounds: ${catalog.backgrounds.join(", ")}`,
		`cameras: ${catalog.cameras.join(", ")} (default wide)`,
		`facings: ${catalog.facings.join(", ")}`,
		`modes: ${catalog.modes.join(", ")} (default say)`,
		`panel kinds: ${catalog.kinds.join(", ")} (default scene)`,
		`gestures (shared): ${catalog.gestures.join(", ")}`,
		"  characters may also have unique poses; query_cast shows each inventory.",
		"",
		`limits: ${catalog.limits.actors} actors per panel, ${catalog.limits.balloons} balloons per panel, zoom ${catalog.limits.zoom[0]} to ${catalog.limits.zoom[1]}, ${catalog.limits.columns[0]} to ${catalog.limits.columns[1]} columns`,
		"",
		"strip shape:",
		"  {version: 2, seed?, columns?, panels: [panel, ...]}",
		"",
		"scene panel:",
		"  {background?, camera?, zoom?, border?, actors: [actor, ...]}",
		"",
		"title panel:",
		'  {kind: "title", title?, starring?, footer?, actors: [{avatar, text?}, ...]}',
		"  credit rows only. mode/emotion/gesture/facing are ignored on title actors.",
		"",
		"actor:",
		"  {avatar, text?, mode?, emotion?, gesture?, facing?}",
		'  emotion: "happy" picks randomly among variants. "happy_2" pins variant 2.',
		"  gesture: a named pose from the character's inventory.",
		"  if a character lacks the emotion or gesture, it renders neutral.",
		"",
		"aliases: some characters share art between emotions.",
		'  "angry (drawn as sad)" means the angry face reuses sad\'s art.',
		"  both names work, but the result looks the same.",
	].join("\n");
}

const WORKFLOW = [
	"workflow:",
	"  1. get_bearings (once per conversation)",
	"  2. create_strip to validate and get the studio link",
	"  query_cast({avatars: [...]}) lists exact pose names, needed only to pin a gesture.",
	"  create_strip validates internally. use validate_strip to iterate without minting a link.",
].join("\n");

// vocabulary, cast, backdrops, craft, then what to call: one payload behind both the prompt and get_bearings
function buildBriefing(
	catalog: Catalog,
	backdrops: string,
	guidance: string,
): string {
	const parts = [buildBearings(catalog), buildCastBlock(catalog)];
	if (backdrops) parts.push(backdrops);
	if (guidance) parts.push(guidance);
	parts.push(WORKFLOW);
	return parts.join("\n\n");
}

async function loadBriefing(assets: Fetcher): Promise<string> {
	const [catalog, backdrops, guidance] = await Promise.all([
		loadCatalog(assets),
		loadDoc(assets, "backgrounds.md"),
		loadDoc(assets, "guidance.md"),
	]);
	return buildBriefing(catalog, backdrops, guidance);
}

const MAX_SHORT_QUERY = 8192;

export interface StudioServerOptions {
	assets: Fetcher;
	base: string;
	shortLinks?: LinkStore;
	cap: number;
	prohibited?: (text: string) => boolean;
}

export function createStudioServer(options: StudioServerOptions) {
	const { assets } = options;
	const server = new McpServer({
		name: "comic-chat-studio",
		version: "1.0.0",
	});

	server.registerPrompt(
		"comic-strip",
		{
			title: "Comic strip authoring guide",
			description:
				"Vocabulary, schema, cast overview, craft guidance, and workflow for authoring comic strips.",
		},
		async () => ({
			messages: [
				{
					role: "user" as const,
					content: {
						type: "text" as const,
						text: await loadBriefing(assets),
					},
				},
			],
		}),
	);

	server.registerResource(
		"cast",
		"comic-chat://cast",
		{
			title: "Full cast inventory",
			description:
				"Every character with its look, range, variant counts, pose names, and registers.",
			mimeType: "text/plain",
		},
		async (uri) => {
			const catalog = await loadCatalog(assets);
			const lines = catalog.avatars.map((entry) =>
				describeAvatar(entry, catalog),
			);
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: `${LEGEND}\n\n${lines.join("\n\n")}`,
					},
				],
			};
		},
	);

	server.registerTool(
		"get_bearings",
		{
			title: "Get bearings",
			description:
				"Vocabulary, cast, limits, strip schema, staging and pacing craft, and workflow. Call once at the start of a conversation, before writing any panels. Redundant if the comic-strip prompt is loaded. Pass images: true to include character and background reference sheets (adds ~750 KB).",
			inputSchema: {
				images: z
					.boolean()
					.optional()
					.describe(
						"Include cast and background contact-sheet images for visual reference",
					),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ images }) => {
			const content: Array<
				| { type: "text"; text: string }
				| { type: "image"; data: string; mimeType: string }
			> = [{ type: "text" as const, text: await loadBriefing(assets) }];
			if (images) {
				const [cast, bgs] = await Promise.all([
					loadBlob(assets, "thumbs/cast.png"),
					loadBlob(assets, "thumbs/backgrounds.png"),
				]);
				if (cast)
					content.push({
						type: "image" as const,
						data: cast,
						mimeType: "image/png",
					});
				if (bgs)
					content.push({
						type: "image" as const,
						data: bgs,
						mimeType: "image/png",
					});
			}
			return { content };
		},
	);

	server.registerTool(
		"query_cast",
		{
			title: "Query cast",
			description:
				"Look up which characters own a gesture or an emotion, or cast by register. With character names, dump each one's look, range, art inventory, and registers.",
			inputSchema: {
				avatars: z
					.array(z.string())
					.optional()
					.describe("Dump these characters in full"),
				gesture: z
					.string()
					.optional()
					.describe("Filter to characters that own this pose"),
				emotion: z
					.string()
					.optional()
					.describe("Filter to characters that own this face"),
				register: z
					.string()
					.optional()
					.describe(
						"Filter to a casting register, e.g. office, young, wise, creatures",
					),
				human: z
					.boolean()
					.optional()
					.describe("Filter out the creatures of the cast"),
				reacts: z
					.boolean()
					.optional()
					.describe("Filter to characters with more than one drawing"),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ avatars: names, gesture, emotion, register, human, reacts }) => {
			const catalog = await loadCatalog(assets);

			if (names && names.length > 0) {
				const byName = new Map(catalog.avatars.map((a) => [a.name, a]));
				const unknown = names.filter((n) => !byName.has(n));
				if (unknown.length > 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: `unknown: ${unknown.join(", ")}. catalog has: ${catalog.avatars.map((a) => a.name).join(", ")}`,
							},
						],
						isError: true,
					};
				}
				const lines = names
					.map((n) => byName.get(n))
					.filter((a) => a !== undefined)
					.map((entry) => describeAvatar(entry, catalog));
				return {
					content: [
						{
							type: "text" as const,
							text: `${LEGEND}\n\n${lines.join("\n\n")}`,
						},
					],
				};
			}

			const group = register ? findRegister(catalog, register) : undefined;
			if (register && !group)
				return {
					content: [
						{
							type: "text" as const,
							text: `unknown register "${register}". use one of ${catalog.registers.map((r) => r.key).join(", ")}`,
						},
					],
					isError: true,
				};
			const creatures = findRegister(catalog, "creature");

			let matched = catalog.avatars;
			if (gesture)
				matched = matched.filter((a) => (a.gestures ?? []).includes(gesture));
			if (emotion)
				matched = matched.filter((a) => (a.emotions[emotion] ?? 0) > 0);
			if (group) matched = matched.filter((a) => group.names.includes(a.name));
			if (human)
				matched = matched.filter((a) => !creatures?.names.includes(a.name));
			if (reacts) matched = matched.filter(isExpressive);

			const filters = [
				gesture && `gesture=${gesture}`,
				emotion && `emotion=${emotion}`,
				group && `register=${group.label}`,
				human && "human",
				reacts && "reacts",
			]
				.filter(Boolean)
				.join(" ");
			const header = `${filters || "all"}: ${matched.length} of ${catalog.avatars.length} characters`;
			const lines = matched.map(summarizeAvatar);

			return {
				content: [
					{
						type: "text" as const,
						text: [header, ...lines].join("\n"),
					},
				],
			};
		},
	);

	server.registerTool(
		"validate_strip",
		{
			title: "Validate strip",
			description:
				"Check a strip document against the catalog. Returns errors and warnings. create_strip validates internally; use this tool to iterate without minting a link.",
			inputSchema: {
				strip: z
					.record(z.string(), z.unknown())
					.describe("The strip JSON document (any shape accepted)"),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ strip }) => {
			const catalog = await loadCatalog(assets);
			const issues = checkStrip(strip, catalog);
			const errors = issues.filter((i) => i.severity === "error");
			const warnings = issues.filter((i) => i.severity === "warning");

			if (issues.length === 0) {
				return {
					content: [{ type: "text" as const, text: "ok: no issues found" }],
				};
			}

			const lines = issues.map(
				(i) => `${i.severity}: ${i.path ? `${i.path}: ` : ""}${i.message}`,
			);
			lines.push(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				isError: errors.length > 0,
			};
		},
	);

	server.registerTool(
		"create_strip",
		{
			title: "Create strip",
			description:
				"Validate a strip document and return the link that opens it in the studio editor. Fails on errors; warnings are included alongside the link.",
			inputSchema: {
				strip: stripSchema.describe("The strip JSON document"),
			},
			// minting a short link writes a KV row
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async ({ strip }) => {
			const catalog = await loadCatalog(assets);
			const issues = checkStrip(strip, catalog);
			const errors = issues.filter((i) => i.severity === "error");

			if (errors.length > 0) {
				const lines = issues.map(
					(i) => `${i.severity}: ${i.path ? `${i.path}: ` : ""}${i.message}`,
				);
				lines.push(
					`\n${errors.length} error(s); fix them before creating the link`,
				);
				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					isError: true,
				};
			}

			if (options.prohibited) {
				const flagged = screenStrip(strip, options.prohibited);
				if (flagged.length > 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: `blocked: prohibited language in ${flagged.join(", ")}`,
							},
						],
						isError: true,
					};
				}
			}

			const links = await stripLinks(strip, options.base);
			let editor = links.studio;
			let image = links.image;
			let expires = false;
			if (options.shortLinks && links.query.length <= MAX_SHORT_QUERY) {
				// minting is best effort; the full links stand on their own
				try {
					const slug = await mintShortLink(
						options.shortLinks,
						links.query,
						options.cap,
					);
					if (slug) {
						editor = `${options.base}${SHORT_LINK_PATH}${slug}`;
						image = `${options.base}${SHORT_LINK_PATH}${slug}.svg`;
						expires = true;
					}
				} catch {}
			}

			const warnings = issues.filter((i) => i.severity === "warning");
			const cast = new Set(
				strip.panels
					.filter((p) => p.kind !== "title")
					.flatMap((p) =>
						p.actors.filter((a) => a.avatar).map((a) => a.avatar),
					),
			);
			const cards = strip.panels.filter((p) => p.kind === "title").length;

			const summary = `ok: ${strip.panels.length} panel(s)${cards ? ` including ${cards} title card` : ""}, ${cast.size} character(s)`;
			const parts: string[] = [summary];
			if (warnings.length > 0) {
				parts.push("");
				for (const w of warnings)
					parts.push(`warning: ${w.path ? `${w.path}: ` : ""}${w.message}`);
			}
			parts.push("", `editor: ${editor}`, `image: ${image}`);
			if (expires) parts.push("links expire in 24h");

			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
			};
		},
	);

	return server;
}
