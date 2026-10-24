/** A discovery complaint surfaced next to the resources it affected. */
export interface ResourceDiagnostic {
  type: "error" | "warning" | "info";
  message: string;
  path?: string;
}

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

/** How a model role's value is scoped when written back to config. */
export type ModelRoleScope = "global" | "project";

export interface ModelRoleModelRef {
  provider: string;
  modelId: string;
  name?: string;
  /** Thinking level pinned by a `:level` suffix on the role's selector. */
  thinkingLevel?: string;
}

/**
 * One of omp's model roles as the browser sees it.
 *
 * omp assigns a model per scope of work — `default` for ordinary turns, `smol`
 * for cheap subagent work, `slow` for deep reasoning, `plan` for plan mode,
 * `commit` for changelogs, and so on — all stored in the `modelRoles` record in
 * `~/.omp/agent/config.yml`.
 */
export interface ModelRoleAssignment {
  /** Role id, e.g. `smol`. */
  role: string;
  /** Short uppercase chip omp renders next to the model name, e.g. `SMOL`. */
  tag?: string;
  /** Human label, e.g. `Fast`. */
  name: string;
  /** omp theme color name for the role chip. */
  color?: string;
  /** Built-in roles come from omp; anything else was added in config. */
  builtin: boolean;
  /** Functional but hidden from omp's own selector UI. */
  hidden: boolean;
  /** Raw configured selector, e.g. `anthropic/claude-sonnet-4-6:high`. */
  selector?: string;
  /** Which persisted layer supplies the effective value. */
  source: ModelRoleScope | "default";
  /** Full merge provenance, including runtime and config-overlay layers. */
  provenance: "env" | "runtime" | "overlay" | "project" | "global" | "default";
  /** The model the selector currently resolves to, when it resolves at all. */
  resolved?: ModelRoleModelRef;
  /** Resolver complaint, e.g. a selector that matches nothing available. */
  warning?: string;
}
export interface OmpdeskReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
}

export interface OmpdeskPackageInfo {
  version: string;
}

export type OmpdeskInstallPlanReason =
  | "disabled"
  | "latest-package-unavailable"
  | "current-version-unknown";

export interface OmpdeskInstallPlan {
  canInstall: boolean;
  manager: "bun" | "npm";
  command: string;
  alternateCommand: string;
  packageVersion?: string;
  reason?: OmpdeskInstallPlanReason;
  restartRequired: boolean;
}

export type OmpdeskUpdateAvailability =
  | "up-to-date"
  | "installable"
  | "manual";

export interface OmpdeskUpdateResponse {
  currentAppVersion: string;
  latestRelease: OmpdeskReleaseInfo;
  latestPackage: OmpdeskPackageInfo | null;
  updateAvailable: boolean;
  availability: OmpdeskUpdateAvailability;
  install: OmpdeskInstallPlan;
  checkedAt: string;
}

/**
 * State of ompdesk's password lock, as served by `GET /api/web-access`.
 *
 * Re-exported from the credential store so the settings panel and the store
 * cannot drift; the import is type-only, so nothing from `bin/` reaches the
 * browser bundle.
 */
export type { WebAuthStatus as WebAccessStatus } from "@/bin/web-auth-store.js";

/** Severity levels omp's process logger persists. */
export type LogLevelName = "error" | "warn" | "info" | "debug";

/** One log file owned by the current server process, or one of its rotations. */
export interface LogFileInfo {
  /** Basename only, e.g. `omp.2026-10-24.1528.log.1`. */
  name: string;
  size: number;
  /** ISO timestamp of the last write. */
  modifiedAt: string;
  /** The file the SDK sink is currently appending to, when it can be identified. */
  current: boolean;
}

/** One parsed JSONL record, or an unparseable line preserved verbatim. */
export interface LogEntry {
  /** Byte offset of the line start in the file. */
  offset: number;
  /** Byte length of the line, excluding its terminator. */
  length: number;
  /** Source line without its terminator. */
  raw: string;
  level: string | null;
  timestamp: string | null;
  /** `ompdesk` for records written by this server, `sdk` when the record has no source. */
  source: string;
  subsystem: string | null;
  message: string;
  /** The whole parsed record, so the panel can show every field. */
  fields: Record<string, unknown>;
  /** Present when the line is not a JSON object. */
  parseError?: string;
}

/** `GET /api/logs` response: the process file set plus one cursor page. */
export interface LogsResponse {
  pid: number;
  files: LogFileInfo[];
  file: LogFileInfo | null;
  entries: LogEntry[];
  /** Raw byte offset to pass as `cursor` for the next page. */
  nextCursor: number;
  /** More bytes remain after `nextCursor` (either filtered out or above the page cap). */
  truncated: boolean;
}
