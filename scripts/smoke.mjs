import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hostRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const host = JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8"));
const cli = join(hostRoot, host.bin.pi);
const temporary = mkdtempSync(join(tmpdir(), "pi-stash-io-smoke-"));
const run = (command, args, options = {}) =>
	execFileSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});

try {
	const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temporary], { cwd: root }))[0];
	run("tar", ["-xzf", join(temporary, packed.filename), "-C", temporary]);
	const packageDir = join(temporary, "package");
	run(
		"npm",
		["install", "--omit=dev", "--omit=peer", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund"],
		{ cwd: packageDir },
	);
	assert.equal(JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).name, "pi-stash-io");
	const agentDir = join(temporary, "agent");
	mkdirSync(agentDir);
	const environment = { ...process.env, HOME: temporary, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
	const qa = join(temporary, "qa.ts");
	const marker = join(temporary, "loaded.txt");
	writeFileSync(
		qa,
		`import { writeFileSync } from "node:fs";
		export default function (pi) {
		pi.registerCommand("qa-stash-io", { handler: async () => {
			if (!pi.getCommands().some(command => command.name === "stash")) {
				throw new Error("The packaged stash command did not load");
			}
			writeFileSync(${JSON.stringify(marker)}, "stash-io-loaded");
		} });
	}`,
	);
	run(process.execPath, [cli, "install", packageDir], { cwd: temporary, env: environment });
	run(process.execPath, [cli, "--offline", "--print", "--extension", qa, "/qa-stash-io"], {
		cwd: temporary,
		env: environment,
		stdio: ["ignore", "pipe", "inherit"],
	});
	assert.equal(readFileSync(marker, "utf8"), "stash-io-loaded");
	console.log("Packed extension loads through Pi CLI with only production dependencies.");
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
