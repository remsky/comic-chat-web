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
									"depart",
									"flood",
									"mute",
									"name-block",
									"profile",
									"profile-avatar",
									"profile-block",
									"retention",
									"roster",
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
