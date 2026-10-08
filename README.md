# pi-stash-io
_(pih-STASH-ee-oh)_

`git stash` but for `pi` prompts. Stash the current prompt, do something else, stash pop it later.

<p align="center">
  <img src="assets/pistachio.png" alt="A grinning pistachio strutting on gangly legs in oversized shoes" width="280">
</p>

## Install

From a local checkout:

```sh
pi install /path/to/pi-stash-io
```

After the package is published:

```sh
pi install npm:pi-stash-io
```

Run `/reload` after installing. Requires Pi 1.0.0 or later and Node.js 24 or later.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl+S** | Save the current draft and clear the editor |
| **Ctrl+Shift+S** | Pop the newest draft into the editor |

Stash A, then B. The first pop restores B; the next restores A.

Pop refuses if the editor contains any text. Send, clear, or stash that text first.
Drafts retain their whitespace and line breaks. Blank drafts are not stashed.

Your terminal must distinguish Ctrl+Shift+S from Ctrl+S. If it cannot, use
`/stash pop` to restore. The shortcuts apply in the prompt editor; Pi's own
dialogs keep their shortcuts.

## Commands

| Command | Action |
| --- | --- |
| `/stash` or `/stash list` | Open the stash picker |
| `/stash push <text>` | Stash explicit text |
| `/stash pop [n]` | Pop draft n; defaults to the newest |
| `/stash drop [n]` | Delete draft n; defaults to the newest |
| `/stash clear` | Confirm deletion of the listed drafts |
| `/stash help` | Show command help |

Numbers start at 1, newest first. In the picker, **Enter** restores,
**Ctrl+D** deletes, **Ctrl+X** clears, and **Escape** cancels.

## Storage and safety

- Up to **10 drafts per working directory**. A full stack refuses another stash;
  it never deletes a draft to make room.
- Drafts persist across restarts, reloads, forks, and sessions.
- Files live in `~/.pi/agent/pi-stash-io/<directory-hash>.json`, or under
  `PI_CODING_AGENT_DIR` when set. Symlinked paths to one directory share a stack.
- Separate Pi windows in the same directory share the stack. File locking
  prevents simultaneous changes from overwriting each other. A busy file asks
  you to retry; a crashed process's lock expires after 10 seconds.
- Writes replace the file atomically. Invalid files are reported and retained.
- Drafts are plain text on disk, with owner-only permissions. They are not
  sent to a model until you submit a restored prompt.
- Image attachments are not included; this extension stores editor text only.
- Interactive mode supports the picker. RPC mode lists drafts as a summary and
  asks before restoring because it cannot inspect the client's editor.
- Storage is separate from `@fitchmultz/pi-stash`; existing upstream stashes
  are not imported. Disable that extension before using this one, since its
  stash shortcut and command conflict.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run format
```

Tests cover storage, command behavior, and real Pi shortcut dispatch in
fullscreen and regular modes without model calls. The smoke test installs the
packed extension in an isolated Pi profile with only production dependencies.

`npm audit --omit=dev` is clean. Pi 1.0.0 pins a development-only
`brace-expansion` version with a known advisory; it is not shipped with this
extension.

## Release

1. Choose the public repository URL and add `repository`, `homepage`, and
   `bugs` to `package.json`.
2. Update the version and changelog.
3. Run `npm run check` and inspect `npm pack --dry-run`.
4. Publish with `npm publish --access public`.

The package name is not reserved until publication. This repository has not
been published.

## Credits and license

Adapted from [Mitch Fultz's pi-stash](https://github.com/fitchmultz/pi-stash),
version 0.4.0. Changes include direct last-in-first-out popping, different
shortcuts, overwrite protection, and locked storage with stable draft IDs.

MIT. The upstream copyright notice is retained in [LICENSE](LICENSE).

The mascot is AI-generated. Its model and prompt are recorded in
[assets/README.md](assets/README.md).
