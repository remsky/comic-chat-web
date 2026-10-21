import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// vitest-pool-workers teardown race: rpc closes with a module resolve pending; tests are unaffected
		onUnhandledError(error) {
			if (
				error.name === "EnvironmentTeardownError" &&
				String(error.message).includes("Closing rpc while")
			)
				return false;
		},
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
									"identity-fallback",
									"identity-replay",
									"identity-tabs",
									"legacy-migrate",
									"legacy-migrate-ancient",
									"mute",
									"mute-escalate",
									"mute-expire",
									"mute-off",
									"name-block",
									"notify",
									"notify-burst",
									"notify-cap",
									"notify-down",
									"notify-prune",
									"notify-quiet",
									"notify-rearm",
									"profile",
									"profile-avatar",
									"profile-block",
									"retention",
									"roster",
									"schema-contract",
									"socket-cap",
								],
								// a real throwaway VAPID pair; push tests sign and encrypt for real, only delivery is mocked
								VAPID_PUBLIC_KEY:
									"BJvHSA_9TAzSBxLZbXbZ_ol4F2A3dhJLgCmjtx62rJJX7nr0a6g0y9gZZflZU273wcSh2fkHqvvQ0vIogaXmNQk",
								VAPID_PRIVATE_KEY:
									"Eym_n-f1sNTckU42-IeAQYKP_uTGg1ID4exJCe94hRQ",
								VAPID_SUBJECT: "mailto:test@comic.test",
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
