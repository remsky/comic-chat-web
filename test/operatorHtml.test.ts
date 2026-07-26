import { describe, expect, it } from "vitest";
import {
	robotsTxt,
	sitemapXml,
	substituteOperator,
} from "../tools/operatorHtml.js";

const PAGE = `<!--if:SITE_ORIGIN-->
<link rel="canonical" href="%SITE_ORIGIN%/legal" />
<meta property="og:image" content="%SITE_ORIGIN%/og.jpg" />
<!--/if-->
<p>governed by the laws of %LEGAL_JURISDICTION%, and</p>
<p>contact %LEGAL_CONTACT%.</p>
<button data-contact="%OPERATOR_CONTACT%" data-jurisdiction="%OPERATOR_JURISDICTION%"></button>
<!--if:SUPPORT_URL-->
<a class="titlebar-button" href="%SUPPORT_URL%">Buy me a coffee</a>
<!--/if-->`;

describe("operator substitution", () => {
	it("keeps neutral wording when the deploy names no operator", () => {
		const html = substituteOperator(PAGE, {});
		expect(html).toContain("the jurisdiction in which the operator resides");
		expect(html).toContain("the operator of this deployment");
		expect(html).not.toContain("%");
	});

	it("fills each slot the deploy sets and leaves the other alone", () => {
		const html = substituteOperator(PAGE, {
			LEGAL_CONTACT: "hello@example.test",
		});
		expect(html).toContain("hello@example.test");
		expect(html).not.toContain("the operator of this deployment");
		expect(html).toContain("the jurisdiction in which the operator resides");
	});

	it("leaves the report transcript's fields empty when the deploy names no operator", () => {
		const html = substituteOperator(PAGE, {});
		expect(html).toContain('data-contact=""');
		expect(html).toContain('data-jurisdiction=""');
	});

	it("stamps the report transcript's fields with the configured values", () => {
		const html = substituteOperator(PAGE, {
			LEGAL_CONTACT: "hello@example.test",
			LEGAL_JURISDICTION: "Ontario, Canada",
		});
		expect(html).toContain('data-contact="hello@example.test"');
		expect(html).toContain('data-jurisdiction="Ontario, Canada"');
	});

	it("takes any wording in the contact slot, not just a bare address", () => {
		const html = substituteOperator(PAGE, {
			LEGAL_CONTACT: "Jane Doe at hello@example.test",
		});
		expect(html).toContain("Jane Doe at hello@example.test");
	});

	it("treats a blank value as unset", () => {
		const html = substituteOperator(PAGE, { LEGAL_CONTACT: "   " });
		expect(html).toContain("the operator of this deployment");
	});

	it("escapes a value instead of letting it inject markup", () => {
		const html = substituteOperator(PAGE, {
			LEGAL_CONTACT: '"><script>alert(1)</script>',
		});
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("keeps the upstream support link when the deploy sets none", () => {
		const html = substituteOperator(PAGE, {});
		expect(html).toContain('href="https://buymeacoffee.com/remsky"');
		expect(html).not.toContain("<!--if:");
		expect(html).not.toContain("<!--/if-->");
	});

	it("points the support link at the url the deploy sets", () => {
		const html = substituteOperator(PAGE, {
			SUPPORT_URL: "https://buymeacoffee.com/someone",
		});
		expect(html).toContain('href="https://buymeacoffee.com/someone"');
		expect(html).not.toContain("remsky");
	});

	it("drops the whole block for a value that is not a plain https link", () => {
		for (const SUPPORT_URL of ["none", "javascript:x"]) {
			const html = substituteOperator(PAGE, { SUPPORT_URL });
			expect(html).not.toContain("Buy me a coffee");
			expect(html).not.toContain("remsky");
		}
	});

	it("absolutizes the canonical and social image against the site origin", () => {
		const html = substituteOperator(PAGE, {
			SITE_ORIGIN: "https://fork.example/",
		});
		expect(html).toContain('href="https://fork.example/legal"');
		expect(html).toContain('content="https://fork.example/og.jpg"');
	});

	it("drops the tags that need an origin when none is configured", () => {
		const html = substituteOperator(PAGE, {});
		expect(html).not.toContain("canonical");
		expect(html).not.toContain("og:image");
	});

	it("drops them for a value that is not a bare origin too", () => {
		const html = substituteOperator(PAGE, { SITE_ORIGIN: 'https://evil"><b>' });
		expect(html).not.toContain("canonical");
		expect(html).not.toContain("<b>");
	});
});

describe("crawler files", () => {
	it("names the site origin in the sitemap directive", () => {
		const body = robotsTxt("https://fork.example");
		expect(body).toContain("Disallow: /api/");
		expect(body).toContain("Sitemap: https://fork.example/sitemap.xml");
	});

	it("omits the directive when no origin is configured", () => {
		expect(robotsTxt(undefined)).not.toContain("Sitemap:");
		expect(robotsTxt(undefined)).toContain("Disallow: /api/");
	});

	it("lists every crawlable page against the site origin", () => {
		const body = sitemapXml("https://fork.example");
		for (const path of ["/", "/studio", "/legal"])
			expect(body).toContain(`<loc>https://fork.example${path}</loc>`);
	});

	it("skips the sitemap entirely without an origin to list", () => {
		expect(sitemapXml(undefined)).toBeNull();
		expect(sitemapXml('https://evil"><b>')).toBeNull();
	});
});
