import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Catalog, CatalogAvatar } from "./catalog.js";
import { loadCatalog } from "./catalog.js";
import { stripLink } from "./link.js";
import { checkStrip } from "./validate.js";

// hard caps sized from catalog names and the warn thresholds in validate.ts
const actorSchema = z.strictObject({
	avatar: z.string().max(32).describe("Character name from the catalog"),
	text: z.string().max(200).optional().describe("Balloon text"),
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
	title: z.string().max(80).optional().describe("Heading, title panels only"),
	starring: z
		.string()
		.max(80)
		.optional()
		.describe("Subheading, title panels only"),
	footer: z
		.string()
		.max(80)
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
	actors: z.array(actorSchema).max(8).describe("Characters in this panel"),
});

const stripSchema = z.strictObject({
	version: z.number().describe("Schema version, currently 2"),
	size: z.enum(["classic", "modern"]).optional().describe("Panel aspect ratio"),
	seed: z
		.number()
		.int()
		.optional()
		.describe("Random seed for deterministic layout"),
	columns: z.number().int().optional().describe("Grid columns, 1 to 8"),
	panels: z.array(panelSchema).max(32).describe("Ordered list of panels"),
});

function isSpeaking(a: CatalogAvatar): boolean {
	return Object.values(a.emotions).reduce((sum, n) => sum + n, 0) > 1;
}

function describeAvatar(entry: CatalogAvatar): string {
	const faces = Object.entries(entry.emotions)
		.filter(([, count]) => count > 0)
		.map(([face, count]) => {
			const alias = entry.aliases?.[face];
			return alias
				? `${face} ${count} (drawn as ${alias})`
				: `${face} ${count}`;
		})
		.join(", ");
	return [
		entry.name,
		`  faces: ${faces}`,
		`  poses: ${(entry.gestures ?? []).join(", ") || "none"}`,
	].join("\n");
}

function summarizeAvatar(entry: CatalogAvatar): string {
	const faces = Object.keys(entry.emotions).filter(
		(e) => (entry.emotions[e] ?? 0) > 0,
	);
	const poses = (entry.gestures ?? []).length;
	return `  ${entry.name}: ${faces.join(" ")}${poses ? `, ${poses} poses` : ""}`;
}

function buildBearings(catalog: Catalog): string {
	return [
		`backgrounds: ${catalog.backgrounds.join(", ")}`,
		`sizes: ${catalog.sizes.join(", ")}`,
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
		"  {version: 2, size?, seed?, columns?, panels: [panel, ...]}",
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

export function createStudioServer(assets: Fetcher) {
	const server = new McpServer({
		name: "comic-chat-studio",
		version: "1.0.0",
	});

	server.registerPrompt(
		"comic-strip",
		{
			title: "Comic strip authoring guide",
			description:
				"Vocabulary, schema, cast overview, and workflow for authoring comic strips.",
		},
		async () => {
			const catalog = await loadCatalog(assets);
			const bearings = buildBearings(catalog);
			const speaking = catalog.avatars.filter(isSpeaking);
			const castBlock = [
				`speaking cast (${speaking.length} of ${catalog.avatars.length}):`,
				...speaking.map(summarizeAvatar),
			].join("\n");
			const workflow = [
				"next steps:",
				"  1. query_cast({avatars: [...]}) for detailed art on your chosen characters",
				"  2. create_strip to validate and get the studio link",
				"  use validate_strip to iterate without minting a link.",
			].join("\n");
			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: [bearings, "", castBlock, "", workflow].join("\n"),
						},
					},
				],
			};
		},
	);

	server.registerResource(
		"cast",
		"comic-chat://cast",
		{
			title: "Full cast inventory",
			description:
				"Every speaking character with variant counts and pose names.",
			mimeType: "text/plain",
		},
		async (uri) => {
			const catalog = await loadCatalog(assets);
			const speaking = catalog.avatars.filter(isSpeaking);
			const legend =
				'legend: "happy 3" = 3 variants; use emotion "happy" or "happy_1" through "happy_3" to pin one. "(drawn as sad)" = reuses sad\'s art. poses are literal names.';
			const lines = speaking.map(describeAvatar);
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: `${legend}\n\n${lines.join("\n\n")}`,
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
				"Vocabulary, limits, strip schema, and workflow. Call once at the start of a conversation. Redundant if the comic-strip prompt is loaded.",
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const catalog = await loadCatalog(assets);
			const workflow = [
				"",
				"workflow:",
				"  1. get_bearings (once per conversation)",
				"  2. query_cast({speaks: true}) to list characters who can react",
				"  3. query_cast({avatars: [...]}) to dump art inventories for your picks",
				"  4. create_strip to validate and get the studio link",
				"  create_strip validates internally. use validate_strip to iterate without minting a link.",
			].join("\n");
			return {
				content: [
					{
						type: "text" as const,
						text: buildBearings(catalog) + workflow,
					},
				],
			};
		},
	);

	server.registerTool(
		"query_cast",
		{
			title: "Query cast",
			description:
				"Look up which characters own a gesture, an emotion, or both. With character names, dump each one's full art inventory.",
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
				speaks: z
					.boolean()
					.optional()
					.describe(
						"Filter to characters with more than one drawing, so they can react",
					),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ avatars: names, gesture, emotion, speaks }) => {
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
				const legend =
					'legend: "happy 3" = 3 variants; use emotion "happy" or "happy_1" through "happy_3" to pin one. "(drawn as sad)" = reuses sad\'s art. poses are literal names.';
				const lines = names
					.map((n) => byName.get(n))
					.filter((a) => a !== undefined)
					.map(describeAvatar);
				return {
					content: [
						{
							type: "text" as const,
							text: `${legend}\n\n${lines.join("\n\n")}`,
						},
					],
				};
			}

			let matched = catalog.avatars;
			if (gesture)
				matched = matched.filter((a) => (a.gestures ?? []).includes(gesture));
			if (emotion)
				matched = matched.filter((a) => (a.emotions[emotion] ?? 0) > 0);
			if (speaks) matched = matched.filter(isSpeaking);

			const filters = [
				gesture && `gesture=${gesture}`,
				emotion && `emotion=${emotion}`,
				speaks && "speaks",
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
			annotations: { readOnlyHint: true },
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

			const url = await stripLink(strip);
			const warnings = issues.filter((i) => i.severity === "warning");
			const cast = new Set(
				strip.panels
					.filter((p) => p.kind !== "title")
					.flatMap((p) =>
						p.actors.filter((a) => a.avatar).map((a) => a.avatar),
					),
			);
			const cards = strip.panels.filter((p) => p.kind === "title").length;

			const summary = `ok: ${strip.panels.length} panel(s)${cards ? ` including ${cards} title card` : ""}, ${cast.size} character(s), ${url.length} byte link`;
			const parts: string[] = [summary];
			if (warnings.length > 0) {
				parts.push("");
				for (const w of warnings)
					parts.push(`warning: ${w.path ? `${w.path}: ` : ""}${w.message}`);
			}
			parts.push("", url);

			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
			};
		},
	);

	return server;
}
