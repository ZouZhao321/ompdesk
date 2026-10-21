# Release Checklist

This repo publishes two artifacts for each release:

- npm package: `ompdesk`
- GitHub Release: `ZouZhao321/ompdesk`

Use this checklist from a clean `main` checkout.

## Automated npm publishing

Pushing a version tag matching `v*` starts
`.github/workflows/publish-npm.yml`. The workflow:

1. Checks that the tag version matches `package.json`.
2. Installs dependencies with Bun and runs the production build.
3. Publishes `ompdesk` to npm with provenance.

Before the first release, configure npm trusted publishing for
`ZouZhao321/ompdesk`:

- workflow file: `.github/workflows/publish-npm.yml`
- GitHub environment: `npm`
- publisher: GitHub Actions

The npm package must be configured to trust this repository and workflow, and
the repository's `npm` environment must permit the release job to run. No npm
token is stored in GitHub Actions.


## 1. Preflight

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
npm whoami
bun --version   # the published .next is built with Bun; engines.bun requires 1.3.14+
node -e "const p=require('./package.json'); console.log(p.version)"
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- GitHub is authenticated as an account that can push and create releases.
- npm is authenticated as an account that can publish `ompdesk`.

## 2. Publish to npm

```bash
npm run release
```

The release script runs:

```bash
npm version patch --no-git-tag-version && npm run build && npm publish --access public
```

Notes:

- This bumps `package.json` and `package-lock.json`.
- It intentionally runs a production build. Do not run `next build` during normal development; release work is the exception.
- If `npm view ompdesk version` briefly shows the previous version, check the exact version instead:

```bash
npm view ompdesk@<version> version --registry https://registry.npmjs.org/
npm view ompdesk versions --json --registry https://registry.npmjs.org/
```

## 3. Commit the Version Bump

Replace `<version>` with the new package version, for example `0.7.5`.

```bash
git diff -- package.json package-lock.json
git add package.json package-lock.json
git commit -m "Release v<version>"
```

## 4. Tag and Push

```bash
git tag -a v<version> -m "v<version>"
git push origin main --tags
```

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo ZouZhao321/ompdesk
```

## 5. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful.

Suggested structure:

```markdown
## 中文

基于 `v<previous>..v<version>` 的提交整理。

### 新增

- ...

### 修复

- ...

### 改进

- ...

### 内部调整

- 发布 npm 包 `ompdesk@<version>`。

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- Published npm package `ompdesk@<version>`.
```

## 6. Create or Update the GitHub Release

Create a new release:

```bash
gh release create v<version> \
  --repo ZouZhao321/ompdesk \
  --verify-tag \
  --title "v<version>" \
  --notes-file release-notes.md
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo ZouZhao321/ompdesk \
  --notes-file release-notes.md
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo ZouZhao321/ompdesk --notes-file - <<'EOF'
## 中文

...

## English

...
EOF
```

## 7. Final Verification

```bash
gh release view v<version> --repo ZouZhao321/ompdesk
npm view ompdesk@<version> version --registry https://registry.npmjs.org/
git status --short --branch
git log --oneline --decorate -3
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- npm exact version resolves.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
