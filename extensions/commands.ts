export type Command =
	| { type: "list" | "clear" | "help" }
	| { type: "push"; text: string }
	| { type: "pop" | "drop"; index: number };

export const HELP = [
	"/stash — browse drafts",
	"/stash push <text> — save explicit text",
	"/stash pop [n] — restore draft n (default 1, newest)",
	"/stash drop [n] — delete draft n",
	"/stash clear — confirm deletion of all listed drafts",
].join("\n");

export function parseCommand(args: string): Command {
	if (!args.trim()) return { type: "list" };
	const match = args.trimStart().match(/^(\S+)(?:[ \t]([\s\S]*))?$/);
	if (!match) throw new Error(HELP);
	const name = match[1];
	const rest = match[2] ?? "";

	if (name === "push") {
		if (!rest.trim()) throw new Error("Usage: /stash push <text>");
		return { type: "push", text: rest };
	}
	if (name === "pop" || name === "drop") {
		const position = rest.trim() || "1";
		if (!/^[1-9]\d*$/.test(position) || !Number.isSafeInteger(Number(position))) {
			throw new Error(`Usage: /stash ${name} [positive number]`);
		}
		return { type: name, index: Number(position) - 1 };
	}
	if ((name === "list" || name === "clear" || name === "help") && !rest.trim()) {
		return { type: name };
	}
	throw new Error(HELP);
}
