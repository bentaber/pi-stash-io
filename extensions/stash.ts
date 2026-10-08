// Adapted from @fitchmultz/pi-stash 0.4.0 (MIT). See LICENSE.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, SelectList, Text } from "@earendil-works/pi-tui";
import { HELP, parseCommand } from "./commands.ts";
import { countLabel, type Draft, isBlank, preview, StashStore } from "./store.ts";

type PickerResult = { action: "restore" | "drop"; id: string } | { action: "clear" } | { action: "cancel" };

function storeFor(ctx: ExtensionContext): StashStore {
	return new StashStore(getAgentDir(), ctx.cwd);
}

function updateStatus(ctx: ExtensionContext): void {
	const count = storeFor(ctx).list().length;
	ctx.ui.setStatus("pi-stash-io", count ? ctx.ui.theme.fg("accent", `stash: ${countLabel(count)}`) : undefined);
}

function requireUI(ctx: ExtensionContext): void {
	if (!ctx.hasUI) throw new Error("Stash commands require an interactive editor or RPC client.");
}

function stashEditor(ctx: ExtensionContext): void {
	requireUI(ctx);
	const text = ctx.ui.getEditorText();
	if (isBlank(text)) throw new Error("Nothing to stash");
	storeFor(ctx).push(text);
	ctx.ui.setEditorText("");
	updateStatus(ctx);
	ctx.ui.notify("Draft stashed. Ctrl+Shift+S to pop.", "info");
}

async function restore(ctx: ExtensionContext, signal: AbortSignal, id?: string): Promise<void> {
	requireUI(ctx);
	const store = storeFor(ctx);
	if (!store.list().some((draft) => id === undefined || draft.id === id)) {
		throw new Error("No stashed draft at that position");
	}
	if (ctx.mode === "rpc") {
		const confirmed = await ctx.ui.confirm(
			"Restore stashed draft?",
			"This RPC client cannot report editor contents. Restoring will replace its current draft.",
			{ signal },
		);
		if (signal.aborted || !confirmed) return;
	}
	if (signal.aborted) return;
	if (ctx.mode === "tui" && ctx.ui.getEditorText().length > 0) {
		throw new Error("Editor is not empty. Send, clear, or stash the current draft first.");
	}
	const draft = store.take(id, (entry) => ctx.ui.setEditorText(entry.text));
	if (!draft) throw new Error("That draft was already removed by another Pi window.");
	updateStatus(ctx);
	ctx.ui.notify("Draft popped into the editor.", "info");
}

async function clear(ctx: ExtensionContext, signal: AbortSignal, drafts: Draft[]): Promise<void> {
	if (!drafts.length) throw new Error("No stashed drafts");
	const confirmed = await ctx.ui.confirm("Clear stashes?", `Delete ${countLabel(drafts.length)}?`, { signal });
	if (signal.aborted || !confirmed) return;
	// Leave drafts added by another window while the confirmation was open.
	const count = storeFor(ctx).clear(drafts.map((draft) => draft.id));
	updateStatus(ctx);
	ctx.ui.notify(`Deleted ${countLabel(count)}.`, "info");
}

async function showPicker(ctx: ExtensionContext, signal: AbortSignal, drafts: Draft[]): Promise<PickerResult> {
	return ctx.ui.custom<PickerResult>((tui, theme, _keybindings, done) => {
		const abort = () => done({ action: "cancel" });
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
		const container = new Container();
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(`Stashed drafts (${drafts.length})`))));
		const list = new SelectList(
			drafts.map((draft, index) => ({
				value: draft.id,
				label: `${index + 1}. ${preview(draft.text)}`,
				description: `${draft.text.split("\n").length} lines${index === 0 ? " • newest" : ""}`,
			})),
			Math.min(drafts.length, 10),
			{
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		);
		list.onSelect = (item) => done({ action: "restore", id: item.value });
		list.onCancel = abort;
		container.addChild(list);
		container.addChild(
			new Text(
				theme.fg(
					"dim",
					[
						keyHint("tui.select.confirm", "restore"),
						rawKeyHint("ctrl+d", "delete"),
						rawKeyHint("ctrl+x", "clear"),
						keyHint("tui.select.cancel", "cancel"),
					].join(" • "),
				),
			),
		);
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleMouse: (event) => container.handleMouse(event),
			dispose: () => signal.removeEventListener("abort", abort),
			handleInput(data) {
				if (matchesKey(data, Key.ctrl("d"))) {
					const item = list.getSelectedItem();
					if (item) done({ action: "drop", id: item.value });
				} else if (matchesKey(data, Key.ctrl("x"))) {
					done({ action: "clear" });
				} else {
					list.handleInput(data);
					tui.requestRender();
				}
			},
		};
	});
}

async function browse(ctx: ExtensionContext, signal: AbortSignal): Promise<void> {
	requireUI(ctx);
	while (!signal.aborted) {
		const drafts = storeFor(ctx).list();
		if (!drafts.length) {
			ctx.ui.notify("No stashed drafts.", "info");
			return;
		}
		if (ctx.mode !== "tui") {
			ctx.ui.notify(drafts.map((draft, index) => `${index + 1}. ${preview(draft.text)}`).join("\n"), "info");
			return;
		}
		const result = await showPicker(ctx, signal, drafts);
		if (signal.aborted || result.action === "cancel") return;
		if (result.action === "clear") return clear(ctx, signal, drafts);
		if (result.action === "restore") return restore(ctx, signal, result.id);
		storeFor(ctx).take(result.id);
		updateStatus(ctx);
		ctx.ui.notify("Draft deleted.", "info");
	}
}

export default function stashIo(pi: ExtensionAPI): void {
	let generation = 0;
	let interaction: AbortController | undefined;
	let pending = Promise.resolve();

	const enqueue = (ctx: ExtensionContext, operation: (signal: AbortSignal) => void | Promise<void>): Promise<void> => {
		const requestedGeneration = generation;
		const run = async () => {
			if (requestedGeneration !== generation) return;
			const current = new AbortController();
			interaction = current;
			try {
				await operation(current.signal);
			} catch (error) {
				if (!current.signal.aborted) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
				}
			} finally {
				if (interaction === current) interaction = undefined;
			}
		};
		const result = pending.then(run, run);
		pending = result.then(
			() => {},
			() => {},
		);
		return result;
	};

	const reset = () => {
		generation++;
		interaction?.abort();
		interaction = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		reset();
		try {
			updateStatus(ctx);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
		}
	});
	pi.on("session_shutdown", (_event, ctx) => {
		reset();
		ctx.ui.setStatus("pi-stash-io", undefined);
	});
	pi.on("session_tree", (_event, ctx) => {
		reset();
		updateStatus(ctx);
	});

	pi.registerShortcut("ctrl+s", {
		description: "Stash the current draft and clear the editor",
		handler: (ctx) => enqueue(ctx, () => stashEditor(ctx)),
	});
	pi.registerShortcut("ctrl+shift+s", {
		description: "Pop the newest stashed draft into an empty editor",
		handler: (ctx) => enqueue(ctx, (signal) => restore(ctx, signal)),
	});
	pi.registerCommand("stash", {
		description: "Browse drafts, push text, pop [n], drop [n], or clear",
		getArgumentCompletions: (prefix) => {
			const names = ["list", "push", "pop", "drop", "clear", "help"].filter((name) => name.startsWith(prefix));
			return names.length ? names.map((name) => ({ value: name, label: name })) : null;
		},
		handler: (args, ctx) =>
			enqueue(ctx, async (signal) => {
				requireUI(ctx);
				const command = parseCommand(args);
				switch (command.type) {
					case "list":
						return browse(ctx, signal);
					case "help":
						ctx.ui.notify(HELP, "info");
						return;
					case "push":
						storeFor(ctx).push(command.text);
						updateStatus(ctx);
						ctx.ui.notify("Draft stashed.", "info");
						return;
					case "clear":
						return clear(ctx, signal, storeFor(ctx).list());
					case "pop":
					case "drop": {
						const draft = storeFor(ctx).list()[command.index];
						if (!draft) throw new Error("No stashed draft at that position");
						if (command.type === "pop") return restore(ctx, signal, draft.id);
						storeFor(ctx).take(draft.id);
						updateStatus(ctx);
						ctx.ui.notify("Draft deleted.", "info");
					}
				}
			}),
	});
}
