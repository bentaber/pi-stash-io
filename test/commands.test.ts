import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../extensions/commands.ts";

test("default command lists; pop and drop default to newest", () => {
	assert.deepEqual(parseCommand(""), { type: "list" });
	assert.deepEqual(parseCommand("list"), { type: "list" });
	assert.deepEqual(parseCommand("pop"), { type: "pop", index: 0 });
	assert.deepEqual(parseCommand("drop 2"), { type: "drop", index: 1 });
	assert.deepEqual(parseCommand("clear"), { type: "clear" });
	assert.deepEqual(parseCommand("help"), { type: "help" });
});

test("push preserves whitespace after the command separator", () => {
	assert.deepEqual(parseCommand("push   first\nsecond  "), { type: "push", text: "  first\nsecond  " });
});

test("invalid commands and positions fail without partially parsing a number", () => {
	for (const args of [
		"pop 0",
		"drop -1",
		"pop 1junk",
		"pop 1.2",
		"pop 1 2",
		"pop 9007199254740992",
		"push",
		"push   ",
		"clear extra",
		"unknown",
	]) {
		assert.throws(() => parseCommand(args));
	}
});
