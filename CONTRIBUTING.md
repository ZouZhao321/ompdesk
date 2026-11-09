# Contributing

## Bug reports and feature requests

Use the GitHub issue forms — [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) and
[Feature request](.github/ISSUE_TEMPLATE/feature_request.yml). Blank issues are disabled.

An issue is a request, not a scheduling commitment. Every issue gets one of three answers:
accepted, declined, or needs more information.

Requests the maintainers accept are planned by the maintainers. When the work ships, the
result is posted back on the issue and the issue is closed. Keep planning discussion out of
issues and pull requests.

## Pull requests

Pull requests are welcome for focused changes. Before opening one:

```bash
bun install
bun test
bun run typecheck
bun run lint:changed
```

`bun run lint:changed` only checks the files this branch touched, and only fails on errors
that this branch actually introduced. The whole-repository `bun run lint` still reports 8
pre-existing errors (`components/ChatInput.tsx` and `hooks/useAgentSession.ts`, React compiler
memoization checks). Filtering by line alone is not enough: a whole-file reformat puts
untouched code into the diff, so those lines would be counted as changed and the pre-existing
errors would come back. The script therefore compares candidate errors against the base
version of the same file, by rule and message text, and subtracts the ones that were already
there. CI runs the same script against the pull request's merge base.

Queue health is one command: `bun run queue` lists open pull requests with what blocks each
one, and splits them into work a script can do (merge `origin/main` into the branch) and work
that needs a decision. `bun run queue:sync` performs the first kind; it runs the merge inside
each branch's own worktree so the pre-push verification checks the code it is about to push.

Commit titles are checked in CI: `type(scope): 中文描述` with `type` from `feat`, `fix`,
`refactor`, `test`, `docs`, `chore`, `perf`. `Merge `, `Revert `, `fixup! `, `squash! ` and
`amend! ` prefixes are skipped.

## Security

Report vulnerabilities privately to the maintainer instead of opening a public issue. GitHub
issue forms are public and indexed.

## License

Contributions are accepted under the license in [LICENSE](LICENSE).
