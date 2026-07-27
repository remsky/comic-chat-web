// Build-time operator substitution: a deploy stamps its own details into the pages it ships.

export interface OperatorValues {
	LEGAL_CONTACT?: string;
	LEGAL_JURISDICTION?: string;
	SUPPORT_URL?: string;
	SITE_ORIGIN?: string;
}

const SUPPORT_LINK = /^https:\/\/[^\s"'<>]+$/;
const ORIGIN = /^https?:\/\/[a-z0-9.:-]+$/i;

const NO_CONTACT = "the operator of this deployment";
const NO_JURISDICTION = "the jurisdiction in which the operator resides";

// unset keeps the upstream author's link; any value that is not an https url drops the button
const UPSTREAM_SUPPORT = "https://buymeacoffee.com/remsky";

const CRAWLER_PATHS = ["/", "/studio", "/agent-skill", "/legal"];

// <!--if:KEY--> ... <!--/if--> drops whole tags a blank value would leave broken
function resolveBlocks(html: string, set: Record<string, boolean>): string {
	let out = html;
	for (const [key, keep] of Object.entries(set))
		if (!keep)
			out = out.replace(
				new RegExp(`<!--if:${key}-->[\\s\\S]*?<!--/if-->\\s*`, "g"),
				"",
			);
	return out.replace(/<!--if:[A-Z_]+-->\s*|\s*<!--\/if-->/g, "");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function trimOrigin(value: string | undefined): string {
	const origin = value?.trim().replace(/\/+$/, "") ?? "";
	return ORIGIN.test(origin) ? origin : "";
}

// an unset value keeps the neutral wording, so a fork that configures nothing still reads correctly
export function substituteOperator(
	html: string,
	values: OperatorValues,
): string {
	const contact = values.LEGAL_CONTACT?.trim() ?? "";
	const jurisdiction = values.LEGAL_JURISDICTION?.trim() ?? "";
	const support = values.SUPPORT_URL?.trim() || UPSTREAM_SUPPORT;
	const funded = SUPPORT_LINK.test(support);
	const origin = trimOrigin(values.SITE_ORIGIN);
	const slots: Record<string, string> = {
		"%LEGAL_CONTACT%": escapeHtml(contact || NO_CONTACT),
		"%LEGAL_JURISDICTION%": escapeHtml(jurisdiction || NO_JURISDICTION),
		// the report transcript labels these as fields, where the neutral prose fallback would read as a value
		"%OPERATOR_CONTACT%": escapeHtml(contact),
		"%OPERATOR_JURISDICTION%": escapeHtml(jurisdiction),
		"%SUPPORT_URL%": funded ? escapeHtml(support) : "",
		"%SITE_ORIGIN%": origin,
	};
	const body = resolveBlocks(html, {
		SUPPORT_URL: funded,
		SITE_ORIGIN: Boolean(origin),
	});
	return Object.entries(slots).reduce(
		(out, [token, value]) => out.replaceAll(token, value),
		body,
	);
}

export function robotsTxt(siteOrigin: string | undefined): string {
	const origin = trimOrigin(siteOrigin);
	const sitemap = origin ? `\nSitemap: ${origin}/sitemap.xml\n` : "";
	return `User-agent: *\nAllow: /\nDisallow: /api/\n${sitemap}`;
}

// no origin means no absolute locations to list, and a sitemap of nothing is worth skipping
export function sitemapXml(siteOrigin: string | undefined): string | null {
	const origin = trimOrigin(siteOrigin);
	if (!origin) return null;
	const entries = CRAWLER_PATHS.map(
		(path) => `\t<url>\n\t\t<loc>${origin}${path}</loc>\n\t</url>`,
	).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
