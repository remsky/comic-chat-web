import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EVENT_FIELDS } from "../../worker/db/events.js";

describe("events schema contract", () => {
	it("backs every derived column with a real table column", async () => {
		const stub = env.CHAT_ROOM.getByName("schema-contract");
		const columns = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ name: string }>("PRAGMA table_info(events)")
				.toArray()
				.map((column) => column.name),
		);
		// every field the row contract reads or writes must exist in storage; the table's write-only `at` need not
		expect(columns).toEqual(expect.arrayContaining([...EVENT_FIELDS]));
	});
});
