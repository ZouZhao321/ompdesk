import { execFile } from "child_process";
import { existsSync, mkdirSync, realpathSync } from "fs";
import { basename, dirname, join, normalize, resolve } from "path";
import { promisify } from "util";
import { allowFileRoot } from "./allowed-roots";
import { createGitEnv } from "./git-env";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface BranchInfo {
  name: string;
  /** Path of the checkout that currently holds this branch, null when none does */
  worktreePath: string | null;
  /** True for the branch checked out at the cwd the list was requested for */
  current: boolean;
}

declare global {
  var __ompProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__ompProjectCache) globalThis.__ompProjectCache = new Map();
  return globalThis.__ompProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__ompProjectCache?.clear();
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    // Pin the message locale so error-text matching (e.g. the dirty-worktree
    // detection in the DELETE route) works regardless of system language.
    env: createGitEnv(),
  });
  return stdout.trim();
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  return { projectRoot: repoRoot, branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  let info: ProjectInfo;
  try {
    if (!existsSync(cwd)) {
      info = inferRemovedWorktree(cwd) ?? { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
      cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
      return info;
    }
    const out = await git(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDir, gitDir, toplevel, ref] = out.split("\n").map((l) => l.trim());
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    let realCwd = cwd;
    try { realCwd = realpathSync(cwd); } catch { /* keep as-is */ }
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users.
    const isTopLevel = toplevel === realCwd;
    const isWorktreeTopLevel = gitDir !== commonDir && isTopLevel;
    info = {
      projectRoot: isWorktreeTopLevel ? dirname(commonDir) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch {
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }

  cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(commonDir);
}

interface RawWorktree {
  path: string;
  branch: string | null;
  prunable: boolean;
}

function parseWorktreeList(out: string): RawWorktree[] {
  const parsed: RawWorktree[] = [];
  let current: RawWorktree | null = null;
  const flush = () => {
    if (current?.path) parsed.push(current);
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: normalize(line.slice("worktree ".length).trim()), branch: null, prunable: false };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return parsed;
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const raw = parseWorktreeList(await git(cwd, ["worktree", "list", "--porcelain"]));
  const mainPath = raw[0]?.path;
  // Prunable worktrees point at missing/broken gitdirs and cannot be browsed
  // or selected usefully. Also skip vanished paths even if git has not marked
  // them prunable yet.
  return raw
    .filter((wt) => !wt.prunable && existsSync(wt.path))
    .map((wt) => ({ path: wt.path, branch: wt.branch, isMain: wt.path === mainPath }));
}

export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  const [refs, worktrees] = await Promise.all([
    git(cwd, ["for-each-ref", "--format=%(refname:short)%09%(HEAD)", "refs/heads"]),
    listWorktrees(cwd),
  ]);

  const holders = new Map<string, string>();
  for (const wt of worktrees) {
    if (wt.branch) holders.set(wt.branch, wt.path);
  }

  const branches: BranchInfo[] = [];
  for (const line of refs.split("\n")) {
    const [name, head] = line.trim().split("\t");
    if (!name) continue;
    branches.push({ name, worktreePath: holders.get(name) ?? null, current: head === "*" });
  }
  branches.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return branches;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

/** First free directory under baseDir: name, then name-2, name-3… */
function pickFreeDir(baseDir: string, dirName: string): string {
  let candidate = join(baseDir, dirName);
  for (let suffix = 2; existsSync(candidate); suffix += 1) {
    if (suffix > 99) throw new Error(`No free directory name for ${dirName}`);
    candidate = join(baseDir, `${dirName}-${suffix}`);
  }
  return candidate;
}

/**
  * Guarantee a checkout for `branch` and report whether one already existed.
  * The switcher uses this for both paths: an existing checkout is reused
  * as-is, a missing one is created at the usual location.
  */
export async function ensureWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string; reused: boolean }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const repoRoot = await getRepoRoot(cwd);
  const raw = parseWorktreeList(await git(repoRoot, ["worktree", "list", "--porcelain"]));
  const usable = raw.filter((wt) => !wt.prunable && existsSync(wt.path));
  const holder = usable.find((wt) => wt.branch === trimmed);
  if (holder) return { path: holder.path, branch: trimmed, reused: true };

  // Stale registrations (missing directory, broken gitdir) still make git
  // refuse the branch. Clear them before creating a new checkout.
  if (raw.length !== usable.length) {
    await git(repoRoot, ["worktree", "prune"]).catch(() => { });
  }

  const created = await addWorktree(repoRoot, trimmed);
  return { ...created, reused: false };
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  mkdirSync(baseDir, { recursive: true });
  const worktreePath = pickFreeDir(baseDir, dirName);

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", worktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  const target = worktrees.find((w) => w.path === worktreePath);
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), worktreePath]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
