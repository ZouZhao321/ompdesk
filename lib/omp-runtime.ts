import {
  discoverAuthStorage,
  getAgentDir,
  ModelRegistry,
  Settings,
} from "@oh-my-pi/pi-coding-agent";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent";

/**
 * Process-wide omp services.
 *
 * The `omp` CLI builds `Settings` + `AuthStorage` + `ModelRegistry` once per
 * process and hands them to every session. ompdesk serves many requests from
 * one process, so it builds them once too and re-scopes `Settings` per project
 * instead of re-opening SQLite for every route.
 *
 * Stored on `globalThis` so Next.js hot-reload does not leak a second SQLite
 * handle onto `~/.omp/agent/agent.db`.
 */

declare global {
  var __ompRuntimePromise: Promise<OmpRuntime> | undefined;
  var __ompSettingsPromise: Promise<Settings> | undefined;
}

export interface OmpRuntime {
  agentDir: string;
  settings: Settings;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

/**
 * Settings alone, without the model catalog.
 *
 * `createRuntime` refreshes the model registry over the network on a cold start,
 * which costs seconds. Routes that only read or write a setting (the settings
 * panel, the transcript collapse flag) start here instead, so a settings edit
 * does not wait on that refresh. Both halves await this same promise, so exactly
 * one `Settings` — and one SQLite handle on `agent.db` — is open per process.
 */
export function getOmpSettings(): Promise<Settings> {
  globalThis.__ompSettingsPromise ??= Settings.init({ agentDir: getAgentDir() }).catch((error) => {
    globalThis.__ompSettingsPromise = undefined;
    throw error;
  });
  return globalThis.__ompSettingsPromise;
}

async function createRuntime(): Promise<OmpRuntime> {
  const agentDir = getAgentDir();
  const settings = await getOmpSettings();
  const authStorage = await discoverAuthStorage(agentDir);
  // Pinning the registry to this exact AuthStorage keeps credential_disabled
  // events flowing to the same instance the routes read from.
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh("online-if-uncached");
  return { agentDir, settings, authStorage, modelRegistry };
}

export function getOmpRuntime(): Promise<OmpRuntime> {
  globalThis.__ompRuntimePromise ??= createRuntime().catch((error) => {
    globalThis.__ompRuntimePromise = undefined;
    throw error;
  });
  return globalThis.__ompRuntimePromise;
}

/**
 * Settings scoped to `cwd`, so project-level `.omp/config.yml` overrides apply.
 *
 * Returns the shared instance when `cwd` is already the active scope; omp's
 * `cloneForCwd` reloads only the project layer, leaving global settings and
 * runtime overrides intact.
 */
export async function getSettingsForCwd(cwd: string | undefined): Promise<Settings> {
  const settings = await getOmpSettings();
  if (!cwd || settings.getCwd() === cwd) return settings;
  return settings.cloneForCwd(cwd);
}

/** Drop the cached runtime so the next request rebuilds it (config/auth edits). */
export function invalidateOmpRuntime(): void {
  globalThis.__ompRuntimePromise = undefined;
  globalThis.__ompSettingsPromise = undefined;
}
