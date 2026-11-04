# Worktrees in ompdesk

ompdesk can show all Git worktrees for one project in the sidebar. Use this when you want to keep separate checkouts for different branches, while keeping the project's sessions grouped together.

## When the Worktree Control Appears

The worktree switcher appears below the project picker when the selected directory is a Git repository root.

It is hidden when:

- The selected directory is not a Git repository.
- The selected directory is inside a repository, but not the repository root.
- Git cannot read the repository's worktree list.

If you are inside a repo subdirectory, open the repository root from the project picker to manage worktrees.

## Switching Branches

The worktree switcher lists the repository's local branches, not its checkout directories. Each row says whether that branch already has a checkout:

- A branch with a checkout switches to that checkout. Nothing is created.
- A branch without a checkout creates one under `<repo>-worktrees/<branch>` and switches to it.

Checkouts that no local branch points at (for example a detached HEAD left by another tool) get their own row, labelled `Detached`; that row is the only place they can be removed from.

If the branch list cannot be read, the switcher falls back to listing the checkouts themselves; the remove buttons keep working as in the normal list.

A branch can only be held by one checkout at a time, which is why the list is keyed by branch.

Switching affects:

- New sessions started from the sidebar.
- The file Explorer.
- File mentions inserted from the Explorer.

Existing sessions stay grouped under the same project. Opening an existing session moves the effective working directory back to that session's checkout.

## Creating a Worktree

Choose `New worktree...` from the worktree menu and enter a branch name.

ompdesk creates the checkout at:

```text
<repo>-worktrees/<branch>
```

For example, if the main checkout is:

```text
/Users/alex/Documents/Workspace/ompdesk
```

and you create branch `codex/worktree-help`, the worktree is created under:

```text
/Users/alex/Documents/Workspace/ompdesk-worktrees/codex-worktree-help
```

If the branch already has a checkout, ompdesk reuses it. If the branch exists without a checkout, ompdesk adds one for it. If the branch does not exist, ompdesk creates the branch from the current `HEAD`.

Two branch names can flatten to the same directory name: `feat/a-b` and `feat/a/b` both become `feat-a-b`. The second checkout gets a numeric suffix (`feat-a-b-2`) instead of overwriting the first.

## Removing a Worktree

The remove button sits on every row whose checkout is not the main checkout, including `Detached` rows; it deletes that checkout directory.

Removing a worktree does not delete:

- The Git branch.
- ompdesk session history.
- The main checkout.

If the worktree has uncommitted or untracked files, Git refuses the removal. ompdesk then offers a force remove action. Force removal discards the uncommitted files in that checkout, so use it only when you no longer need those changes.

## Sessions and Worktrees

ompdesk groups sessions by project root, so sessions from the main checkout and linked worktrees appear together.

Each session still remembers the working directory it was created with. That means:

- A session started in a worktree continues to use that worktree path.
- A session started in the main checkout continues to use the main checkout.
- If a worktree has been removed, old sessions from it stay visible under the project so you can still find the history.

## Troubleshooting

**I do not see the worktree switcher.**
Select a Git repository root. Non-Git directories and repo subdirectories show a small hint instead of the switcher.

**A branch cannot be added as a worktree.**
Git allows a branch to be checked out in only one worktree at a time. Switch to the existing worktree for that branch, or remove it first.

**A removed worktree still shows up in Git.**
Git can keep prunable worktree records after a checkout disappears. ompdesk hides those records. Switching to the branch again clears that branch's stale record before creating a fresh checkout, but only when the record points inside `<repo>-worktrees`; records elsewhere are left alone.

**Switching reports that a checkout is locked, broken, or unreachable.**
- `Checkout is locked` — run `git worktree unlock <path>`, then switch again.
- `Checkout registration is broken` — the directory still holds work but its `.git` link is damaged. Remove that directory by hand, or rebuild the link with `git worktree repair`.
- `Checkout is unreachable` — the record points outside `<repo>-worktrees`, either a hand-made checkout or a drive that is not mounted. Restore the drive and switch again; if the checkout is really gone, remove its record deliberately with `git worktree prune`.

**The Explorer shows a different branch than the open chat.**
The Explorer follows the selected worktree. The chat follows the opened session. Click the session again to move the sidebar back to that session's checkout.
