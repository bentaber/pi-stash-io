// SDK fixture adapted from @fitchmultz/pi-stash's native-ui.test.ts (MIT).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@earendil-works/pi-tui";
import { StashStore } from "../extensions/store.ts";

class MemoryTerminal implements Terminal {
	columns = 100;
	rows = 30;
	kittyProtocolActive = false;
	onInput?: (data: string) => void;
	onResize?: () => void;
	start(input: (data: string) => void, resize: () => void) {
		this.onInput = input;
		this.onResize = resize;
	}
	stop() {
		this.onInput = undefined;
		this.onResize = undefined;
	}
	async drainInput() {}
	write(_data: string) {}
	moveBy(_lines: number) {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle(_title: string) {}
	setProgress(_active: boolean) {}
	send(data: string) {
		assert.ok(this.onInput);
		this.onInput(data);
	}
	resize(columns: number, rows: number) {
		this.columns = columns;
		this.rows = rows;
		this.onResize?.();
	}
}

const rendered = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

test("real Pi shortcuts, picker, and session lifecycle", { timeout: 30_000 }, async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-stash-io-native-"));
	const agentDir = join(home, "agent");
	mkdirSync(agentDir);
	const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.mock.method(globalThis, "fetch", async () => {
		throw new Error("No network allowed in native UI tests");
	});
	let cleanup: (() => Promise<void>) | undefined;
	try {
		const pi = await import("@earendil-works/pi-coding-agent");
		let context: ExtensionCommandContext | undefined;
		const settingsManager = pi.SettingsManager.inMemory({ theme: "dark", quietStartup: true });
		const modelRuntime = await pi.ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
		});
		const runtime = await pi.createAgentSessionRuntime(
			async ({ cwd, sessionManager }) => {
				const services = await pi.createAgentSessionServices({
					cwd,
					agentDir,
					modelRuntime,
					settingsManager,
					resourceLoaderOptions: {
						noExtensions: true,
						noSkills: true,
						noPromptTemplates: true,
						noThemes: true,
						noContextFiles: true,
						additionalExtensionPaths: [fileURLToPath(new URL("../extensions/stash.ts", import.meta.url))],
						extensionFactories: [
							(api) =>
								api.registerCommand("qa-context", {
									handler: async (_args, ctx) => {
										context = ctx;
									},
								}),
						],
					},
				});
				assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
				return {
					...(await pi.createAgentSessionFromServices({ services, sessionManager, tools: [] })),
					services,
					diagnostics: services.diagnostics,
				};
			},
			{ cwd: home, agentDir, sessionManager: pi.SessionManager.inMemory(home) },
		);
		const terminal = new MemoryTerminal();
		const mode = new pi.InteractiveMode(runtime, { terminal, initialThemeSetting: "dark" });
		cleanup = async () => {
			try {
				mode.stop();
			} finally {
				await runtime.dispose();
			}
		};
		await mode.init();
		assert.deepEqual(runtime.session.extensionRunner.getShortcutDiagnostics(), []);
		await runtime.session.prompt("/qa-context");
		const ctx = () => {
			assert.ok(context);
			return context;
		};
		const store = new StashStore(agentDir, home);
		const texts = () => store.list().map((draft) => draft.text);
		// The host has no public screen observer; use its renderer in this fixture.
		const renderer = () =>
			(mode as unknown as { renderer: { mode: string; previousScreen?: string[]; previousLines?: string[] } }).renderer;
		const screen = () =>
			(renderer().mode === "fullscreen" ? renderer().previousScreen : renderer().previousLines) ?? [];

		for (const tuiMode of ["fullscreen", "regular"] as const) {
			(mode as unknown as { switchTuiMode(mode: string): boolean }).switchTuiMode(tuiMode);
			await t.test(`${tuiMode}: Alt+S stashes, Alt+Shift+S pops one at a time`, async () => {
				ctx().ui.setEditorText("  Draft 界🙂\nsecond line  ");
				terminal.send("\x1bs"); // Alt+S via legacy escape prefix.
				await rendered();
				assert.equal(ctx().ui.getEditorText(), "");
				ctx().ui.setEditorText("newer");
				terminal.send("\x1b[115;3u"); // Alt+S via Kitty keyboard protocol.
				await rendered();
				assert.deepEqual(texts(), ["newer", "  Draft 界🙂\nsecond line  "]);
				terminal.send("\x1b[115;4u"); // Alt+Shift+S.
				await rendered();
				assert.equal(ctx().ui.getEditorText(), "newer");
				assert.deepEqual(texts(), ["  Draft 界🙂\nsecond line  "]);
				terminal.send("\x1b[115;4u");
				await rendered();
				assert.equal(ctx().ui.getEditorText(), "newer");
				assert.equal(store.list().length, 1);
				ctx().ui.setEditorText(" ");
				terminal.send("\x1b[115;4u");
				await rendered();
				assert.equal(ctx().ui.getEditorText(), " ");
				assert.equal(store.list().length, 1);
				ctx().ui.setEditorText("");
				terminal.send("\x1b[115;4u");
				await rendered();
				assert.equal(ctx().ui.getEditorText(), "  Draft 界🙂\nsecond line  ");
				assert.deepEqual(texts(), []);
				ctx().ui.setEditorText("");
			});

			await t.test(`${tuiMode}: commands, picker, and cancellation`, async () => {
				await runtime.session.prompt("/stash push older 界🙂");
				await runtime.session.prompt("/stash push newer 界🙂");
				ctx().ui.setEditorText("untouched");
				const picker = runtime.session.prompt("/stash");
				await rendered();
				terminal.resize(44, 24);
				await rendered();
				assert.ok(screen().some((line) => line.includes("newer 界")));
				terminal.send("\x1b");
				await picker;
				assert.equal(ctx().ui.getEditorText(), "untouched");
				await runtime.session.prompt("/stash pop");
				assert.equal(ctx().ui.getEditorText(), "untouched");
				assert.equal(store.list().length, 2);
				ctx().ui.setEditorText("");
				const selected = runtime.session.prompt("/stash list");
				await rendered();
				terminal.send("\r");
				await selected;
				assert.equal(ctx().ui.getEditorText(), "newer 界🙂");
				await runtime.session.prompt("/stash drop");
				assert.deepEqual(texts(), []);
				await runtime.session.prompt("/stash pop 1junk");
				assert.equal(ctx().ui.getEditorText(), "newer 界🙂");
				ctx().ui.setEditorText("");
				terminal.resize(100, 30);
			});
		}

		await t.test("full stack and corrupt storage leave the current draft intact", async () => {
			for (let index = 0; index < 10; index++) await runtime.session.prompt(`/stash push draft ${index}`);
			ctx().ui.setEditorText("do not lose this");
			terminal.send("\x1bs");
			await rendered();
			assert.equal(ctx().ui.getEditorText(), "do not lose this");
			assert.equal(store.list().length, 10);
			store.clear(store.list().map((draft) => draft.id));
			writeFileSync(store.file, "{invalid");
			terminal.send("\x1bs");
			await rendered();
			assert.equal(ctx().ui.getEditorText(), "do not lose this");
			rmSync(store.file);
			ctx().ui.setEditorText("");
		});

		await t.test("fullscreen mouse selects a draft and returns editor focus", async () => {
			(mode as unknown as { switchTuiMode(mode: string): boolean }).switchTuiMode("fullscreen");
			await runtime.session.prompt("/stash push older mouse draft");
			await runtime.session.prompt("/stash push newer mouse draft");
			const picker = runtime.session.prompt("/stash");
			await rendered();
			const row = screen().findIndex((line) => line.includes("older mouse draft"));
			assert.ok(row >= 0);
			terminal.send(`\x1b[<0;5;${row + 1}M`);
			terminal.send(`\x1b[<0;5;${row + 1}m`);
			await picker;
			assert.equal(ctx().ui.getEditorText(), "older mouse draft");
			terminal.send("!");
			assert.equal(ctx().ui.getEditorText(), "older mouse draft!");
			assert.deepEqual(texts(), ["newer mouse draft"]);
			ctx().ui.setEditorText("");
		});

		await t.test("session replacement cancels the picker; fork, resume, and reload preserve drafts", async () => {
			const picker = runtime.session.prompt("/stash");
			await rendered();
			const outgoing = ctx();
			assert.equal((await outgoing.newSession()).cancelled, false);
			await picker;
			await runtime.session.prompt("/qa-context");
			assert.throws(() => outgoing.ui.getEditorText(), /stale|invalid|disposed|active/i);
			assert.deepEqual(texts(), ["newer mouse draft"]);
			await runtime.session.prompt("/stash push branch marker");
			const marker = runtime.session.sessionManager.appendCustomEntry("qa-branch");
			assert.equal((await ctx().fork(marker, { position: "at" })).cancelled, false);
			await runtime.session.prompt("/qa-context");
			const manager = runtime.session.sessionManager;
			const journal = join(home, "resume.jsonl");
			writeFileSync(
				journal,
				`${[manager.getHeader(), ...manager.getBranch()].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
			);
			assert.equal((await ctx().switchSession(journal)).cancelled, false);
			await runtime.session.prompt("/qa-context");
			await ctx().reload();
			await runtime.session.prompt("/qa-context");
			assert.deepEqual(texts(), ["branch marker", "newer mouse draft"]);
			await runtime.session.prompt("/stash pop 2");
			assert.equal(ctx().ui.getEditorText(), "newer mouse draft");
			assert.deepEqual(texts(), ["branch marker"]);
		});
	} finally {
		try {
			await cleanup?.();
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(home, { recursive: true, force: true });
		}
	}
});
