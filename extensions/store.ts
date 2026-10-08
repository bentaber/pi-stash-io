import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lockSync } from "proper-lockfile";

export const MAX_DRAFTS = 10;

export interface Draft {
	id: string;
	text: string;
	createdAt: number;
}

interface Snapshot {
	version: 1;
	cwd: string;
	drafts: Draft[];
}

export function isBlank(text: string): boolean {
	return text.trim().length === 0;
}

// Adapted from @fitchmultz/pi-stash's previewDraft and countLabel helpers.
export function preview(text: string, limit = 64): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`;
}

export function countLabel(count: number): string {
	return count === 1 ? "1 draft" : `${count} drafts`;
}

export class StashStore {
	readonly cwd: string;
	readonly file: string;

	constructor(agentDir: string, cwd: string) {
		this.cwd = realpathSync(cwd);
		const hash = createHash("sha256").update(this.cwd).digest("hex").slice(0, 16);
		this.file = join(agentDir, "pi-stash-io", `${hash}.json`);
	}

	list(): Draft[] {
		let text: string;
		try {
			text = readFileSync(this.file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}

		let snapshot: Partial<Snapshot>;
		try {
			snapshot = JSON.parse(text);
		} catch {
			throw new Error(`Invalid stash file; left unchanged: ${this.file}`);
		}
		if (
			snapshot?.version !== 1 ||
			snapshot.cwd !== this.cwd ||
			!Array.isArray(snapshot.drafts) ||
			snapshot.drafts.length > MAX_DRAFTS ||
			!snapshot.drafts.every(
				(draft) =>
					draft &&
					typeof draft.id === "string" &&
					draft.id.length > 0 &&
					typeof draft.text === "string" &&
					!isBlank(draft.text) &&
					typeof draft.createdAt === "number" &&
					Number.isFinite(draft.createdAt),
			) ||
			new Set(snapshot.drafts.map((draft) => draft.id)).size !== snapshot.drafts.length
		) {
			throw new Error(`Invalid stash file; left unchanged: ${this.file}`);
		}
		return snapshot.drafts;
	}

	push(text: string): Draft {
		if (isBlank(text)) throw new Error("Nothing to stash");
		return this.change((drafts) => {
			if (drafts.length >= MAX_DRAFTS) {
				throw new Error(`Stash is full (${MAX_DRAFTS} drafts). Pop or drop one first.`);
			}
			const draft = { id: randomUUID(), text, createdAt: Date.now() };
			return { drafts: [draft, ...drafts], result: draft };
		});
	}

	take(id?: string, restore?: (draft: Draft) => void): Draft | undefined {
		return this.change(
			(drafts) => {
				const index = id === undefined ? 0 : drafts.findIndex((draft) => draft.id === id);
				const result = drafts[index];
				return { drafts: result ? drafts.toSpliced(index, 1) : drafts, result };
			},
			(draft) => {
				if (draft) restore?.(draft);
			},
		);
	}

	clear(ids: readonly string[]): number {
		const selected = new Set(ids);
		return this.change((drafts) => {
			const remaining = drafts.filter((draft) => !selected.has(draft.id));
			return { drafts: remaining, result: drafts.length - remaining.length };
		});
	}

	private change<T>(update: (drafts: Draft[]) => { drafts: Draft[]; result: T }, afterSave?: (result: T) => void): T {
		mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
		let release: () => void;
		try {
			// Synchronous locking keeps editor changes in the same input event.
			release = lockSync(this.file, { realpath: false, stale: 10_000 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
				throw new Error("Stash file is busy in another Pi window. Please retry.");
			}
			throw error;
		}
		try {
			const previous = this.list();
			const { drafts, result } = update(previous);
			this.save(drafts);
			try {
				afterSave?.(result);
			} catch (error) {
				// Keep the draft if the editor could not accept it.
				this.save(previous);
				throw error;
			}
			return result;
		} finally {
			release();
		}
	}

	// Atomic replacement and permissions follow @fitchmultz/pi-stash.
	private save(drafts: Draft[]): void {
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			const snapshot: Snapshot = { version: 1, cwd: this.cwd, drafts };
			writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
			renameSync(temporary, this.file);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
}
