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
					cloudflareTest({
						isolatedStorage: true,
						wrangler: { configPath: "./wrangler.jsonc" },
						// one allowlisted room per test so no two tests share a Durable Object
						miniflare: {
							bindings: {
								ROOMS: [
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
