# Changelog

## 0.1.0

- Alt+S saves and clears the current prompt draft without conflicting with Pi's built-in Ctrl+S.
- Alt+Shift+S pops the newest draft without opening a picker.
- Pop refuses to replace a nonempty editor.
- `/stash` lists, restores, deletes, and clears drafts.
- Up to 10 drafts persist per working directory, with atomic writes and file locking.
