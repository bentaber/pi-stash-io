import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import stashIo from "../extensions/stash.ts";
import { StashStore } from "../extensions/store.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type Shortcut = Parameters<ExtensionAPI["registerShortcut"]>[1];

function fixture(t: TestContext, mode: "tui" | "rpc" = "rpc") {
	const root = mkdtempSync(join(tmpdir(), "pi-stash-io-extension-"));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	});
	let text = "";
	let confirm: () => Promise<boolean> = async () => false;
	const notifications: string[] = [];
	const events = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const shortcuts = new Map<string, Shortcut>();
	let command: Command | undefined;
	stashIo({
		on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			events.set(name, handler);
		},
		registerShortcut: (key: string, shortcut: Shortcut) => {
			shortcuts.set(key, shortcut);
		},
		registerCommand: (_name: string, registered: Command) => {
			command = registered;
		},
	} as unknown as ExtensionAPI);
	const context = {
		cwd: root,
		mode,
		hasUI: true,
		ui: {
			getEditorText: () => text,
			setEditorText: (value: string) => {
				text = value;
			},
			setStatus: () => {},
			theme: { fg: (_color: string, value: string) => value },
			notify: (message: string) => {
				notifications.push(message);
			},
			confirm: () => confirm(),
		},
	} as unknown as ExtensionCommandContext;
	assert.ok(command);
	const registered = command;
	return {
		context,
		shortcuts,
		notifications,
		store: new StashStore(agentDir, root),
		text: () => text,
		setConfirm: (next: () => Promise<boolean>) => {
			confirm = next;
		},
		run: (args: string) => registered.handler(args, context),
		shutdown: () => events.get("session_shutdown")?.({}, context),
	};
}

test("RPC listing uses a summary; declined restoration leaves the stack intact", async (t) => {
	const f = fixture(t);
	f.store.push("saved");
	await f.run("");
	assert.ok(f.notifications.some((message) => message.includes("1. saved")));
	await f.run("pop");
	assert.equal(f.text(), "");
	assert.equal(f.store.list().length, 1);
	f.setConfirm(async () => true);
	await f.run("pop");
	assert.equal(f.text(), "saved");
	assert.equal(f.store.list().length, 0);
});

test("session shutdown cancels restoration during RPC confirmation", async (t) => {
	const f = fixture(t);
	f.store.push("saved");
	let approve: (confirmed: boolean) => void = () => {};
	let opened: () => void = () => {};
	const showing = new Promise<void>((resolve) => {
		opened = resolve;
	});
	f.setConfirm(() => {
		opened();
		return new Promise((resolve) => {
			approve = resolve;
		});
	});
	const pending = f.run("pop");
	await showing;
	f.shutdown();
	approve(true);
	await pending;
	assert.equal(f.text(), "");
	assert.equal(f.store.list().length, 1);
});

test("clear confirmation retains drafts added by a second window", async (t) => {
	const f = fixture(t);
	f.store.push("old");
	f.setConfirm(async () => {
		f.store.push("new while confirming");
		return true;
	});
	await f.run("clear");
	assert.deepEqual(
		f.store.list().map((draft) => draft.text),
		["new while confirming"],
	);
});

test("queued shortcut operations use the current editor and do not duplicate drafts", async (t) => {
	const f = fixture(t, "tui");
	f.context.ui.setEditorText("draft");
	const shortcut = f.shortcuts.get("ctrl+s");
	assert.ok(shortcut);
	await Promise.all([shortcut.handler(f.context), shortcut.handler(f.context)]);
	assert.deepEqual(
		f.store.list().map((draft) => draft.text),
		["draft"],
	);
	assert.equal(f.text(), "");
});

test("an unavailable editor rolls back a pop", async (t) => {
	const f = fixture(t, "tui");
	f.store.push("preserve");
	f.context.ui.setEditorText = () => {
		throw new Error("editor unavailable");
	};
	await f.run("pop");
	assert.equal(f.store.list()[0].text, "preserve");
	assert.ok(f.notifications.includes("editor unavailable"));
});
