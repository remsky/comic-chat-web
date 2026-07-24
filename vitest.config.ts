import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "node",
					exclude: [
						...configDefaults.exclude,
						"test/browser/**",
						"test/worker/**",
					],
				},
			},
			// worker tests run inside workerd so Durable Object SQL storage is the real thing
			{
				plugins: [
					// .sql files import as strings, mirroring the wrangler Text rule
					{
						name: "sql-as-text",
						transform(code, id) {
							return id.endsWith(".sql")
								? { code: `export default ${JSON.stringify(code)};` }
								: undefined;
						},
					},
					cloudflareTest({
						isolatedStorage: true,
						wrangler: { configPath: "./wrangler.jsonc" },
						// one allowlisted room per test so no two tests share a Durable Object
						miniflare: {
							bindings: {
								ROOMS: [
									"annotation-bounds",
									"annotation-trip",
									"arrive",
									"backdrop-tags",
									"backdrop-chunk",
									"backdrop-prune",
									"depart",
									"flood",
									"legacy-migrate",
									"legacy-migrate-ancient",
									"mute",
									"name-block",
									"profile",
									"profile-avatar",
									"profile-block",
									"retention",
									"roster",
									"schema-contract",
									"socket-cap",
								],
							},
						},
					}),
				],
				test: {
					name: "worker",
					include: ["test/worker/**/*.test.ts"],
					// obscenity ships CJS; workerd needs it pre-bundled to expose the named exports
					deps: {
						optimizer: { ssr: { enabled: true, include: ["obscenity"] } },
					},
				},
			},
		],
	},
});
