import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { lockSync } from "proper-lockfile";
import { MAX_DRAFTS, StashStore } from "../extensions/store.ts";

function fixture(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pi-stash-io-store-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const cwd = join(root, "project");
	mkdirSync(cwd);
	const agentDir = join(root, "agent");
	return { root, cwd, agentDir, store: new StashStore(agentDir, cwd) };
}

test("drafts pop newest-first, preserve exact text, and persist in new instances", (t) => {
	const { store, agentDir, cwd } = fixture(t);
	const first = "  界🙂\nsecond line  ";
	store.push(first);
	store.push("newer");
	const reloaded = new StashStore(agentDir, cwd);
	assert.equal(reloaded.take()?.text, "newer");
	assert.equal(reloaded.take()?.text, first);
	assert.equal(reloaded.take(), undefined);
});

test("equal text creates separate drafts; selection removes only the chosen ID", (t) => {
	const { store } = fixture(t);
	const first = store.push("same");
	const second = store.push("same");
	assert.notEqual(first.id, second.id);
	assert.equal(store.take(first.id)?.id, first.id);
	assert.deepEqual(
		store.list().map((draft) => draft.id),
		[second.id],
	);
});

test("projects are isolated and symlink aliases share a stack", (t) => {
	const { store, root, cwd, agentDir } = fixture(t);
	const other = join(root, "other");
	mkdirSync(other);
	const alias = join(root, "alias");
	symlinkSync(cwd, alias, "dir");
	store.push("project draft");
	assert.deepEqual(new StashStore(agentDir, other).list(), []);
	assert.equal(new StashStore(agentDir, alias).list()[0].text, "project draft");
});

test("full stacks and blank drafts are refused without losing a draft", (t) => {
	const { store } = fixture(t);
	assert.throws(() => store.push(" \n\t"), /Nothing to stash/);
	for (let index = 0; index < MAX_DRAFTS; index++) store.push(String(index));
	const original = readFileSync(store.file, "utf8");
	assert.throws(() => store.push("overflow"), /full/);
	assert.equal(readFileSync(store.file, "utf8"), original);
	assert.equal(store.list().length, 10);
});

test("clear deletes only the confirmed IDs, retaining drafts added afterward", (t) => {
	const { store } = fixture(t);
	const old = store.push("old");
	store.push("added during confirmation");
	assert.equal(store.clear([old.id]), 1);
	assert.equal(store.list()[0].text, "added during confirmation");
	assert.equal(store.take(old.id), undefined);
});

test("invalid snapshots are kept unchanged", (t) => {
	const { store, cwd } = fixture(t);
	store.push("valid");
	for (const value of [
		"{broken",
		"null",
		JSON.stringify({ version: 99, cwd, drafts: [] }),
		JSON.stringify({ version: 1, cwd: "wrong", drafts: [] }),
		JSON.stringify({ version: 1, cwd, drafts: [{ id: "x", text: " ", createdAt: 1 }] }),
		JSON.stringify({ version: 1, cwd, drafts: Array(2).fill({ id: "same", text: "x", createdAt: 1 }) }),
	]) {
		writeFileSync(store.file, value);
		assert.throws(() => store.push("new"), /Invalid stash file/);
		assert.equal(readFileSync(store.file, "utf8"), value);
	}
});

test("failed editor restoration puts the draft back", (t) => {
	const { store } = fixture(t);
	store.push("keep");
	assert.throws(
		() =>
			store.take(undefined, () => {
				throw new Error("editor unavailable");
			}),
		/editor unavailable/,
	);
	assert.equal(store.list()[0].text, "keep");
});

test("owner-only permissions protect stored drafts", (t) => {
	if (process.platform === "win32") return t.skip("POSIX permissions");
	const { store } = fixture(t);
	store.push("private");
	assert.equal(statSync(store.file).mode & 0o777, 0o600);
});

test("a busy lock refuses changes and releases cleanly", (t) => {
	const { store } = fixture(t);
	store.push("original");
	const release = lockSync(store.file, { realpath: false });
	try {
		assert.throws(() => store.push("blocked"), /busy/);
		assert.deepEqual(
			store.list().map((draft) => draft.text),
			["original"],
		);
	} finally {
		release();
	}
	store.push("after release");
	assert.equal(store.list().length, 2);
});

test("a lock left by a crashed process expires", (t) => {
	const { store } = fixture(t);
	store.push("before crash");
	mkdirSync(`${store.file}.lock`);
	const old = new Date(Date.now() - 30_000);
	utimesSync(`${store.file}.lock`, old, old);
	store.push("after crash");
	assert.equal(store.list().length, 2);
});

test("simultaneous processes do not overwrite each other's drafts", { timeout: 10_000 }, async (t) => {
	const { store, agentDir, cwd } = fixture(t);
	const moduleURL = new URL("../extensions/store.ts", import.meta.url).href;
	const writer = (prefix: string) =>
		new Promise<void>((resolve, reject) => {
			const script = `
			import { StashStore } from ${JSON.stringify(moduleURL)};
			const store = new StashStore(${JSON.stringify(agentDir)}, ${JSON.stringify(cwd)});
			for (let index = 0; index < 5; index++) {
				for (;;) {
					try { store.push(${JSON.stringify(prefix)} + index); break; }
					catch (error) {
						if (!error.message.includes("busy")) throw error;
						await new Promise(resolve => setTimeout(resolve, 10));
					}
				}
			}
		`;
			const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
				stdio: ["ignore", "ignore", "pipe"],
			});
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
		});
	await Promise.all([writer("a"), writer("b")]);
	assert.equal(store.list().length, 10);
	assert.equal(new Set(store.list().map((draft) => draft.text)).size, 10);
});
