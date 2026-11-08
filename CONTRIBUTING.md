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
that sit on changed lines. The whole-repository `bun run lint` still reports 8 pre-existing
errors (`components/ChatInput.tsx` and `hooks/useAgentSession.ts`, React compiler memoization
checks); checking whole files would block unrelated changes to those two files. CI runs the
same script against the pull request's merge base.

Commit titles are checked in CI: `type(scope): 中文描述` with `type` from `feat`, `fix`,
`refactor`, `test`, `docs`, `chore`, `perf`. `Merge `, `Revert `, `fixup! `, `squash! ` and
`amend! ` prefixes are skipped.

## Security

Report vulnerabilities privately to the maintainer instead of opening a public issue. GitHub
issue forms are public and indexed.

## License

Contributions are accepted under the license in [LICENSE](LICENSE).
