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
bunx eslint <changed files and directories>
```

`bun run lint` still reports pre-existing errors in `components/` and `hooks/` (React compiler
memoization checks), so it is not part of `bun run ci` or the CI job — reproduce with
`bun run lint`, and judge the eslint result of the files you touched.

Match the surrounding code, keep one logical change per commit, and write commit titles as
`type(scope): 中文描述` with `type` from `feat`, `fix`, `refactor`, `test`, `docs`, `chore`,
`perf`.

## Security

Report vulnerabilities privately to the maintainer instead of opening a public issue. GitHub
issue forms are public and indexed.

## License

Contributions are accepted under the license in [LICENSE](LICENSE).
