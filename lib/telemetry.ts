import type { AgentTelemetryConfig } from "@oh-my-pi/pi-agent-core";
import { getModelPricingStatus } from "@oh-my-pi/pi-catalog/models";
import type { ModelRegistry, Settings } from "@oh-my-pi/pi-coding-agent";
import {
  createTelemetryExportConfig,
  flushTelemetryExport,
  initTelemetryExport,
  isTelemetryExportEnabled,
} from "@oh-my-pi/pi-coding-agent/telemetry-export";
import { cfgTelemetryOtlpExportEnabled } from "@oh-my-pi/pi-coding-agent/telemetry-settings";

/**
 * OTLP export for ompdesk sessions.
 *
 * The `omp` CLI does this in `src/main.ts`: register the OTLP providers once,
 * then pass `createTelemetryExportConfig()` into the session options. ompdesk
 * builds its own session options, so both steps happen here instead.
 *
 * Registration is process-wide and irreversible: the first call installs
 * global trace/log/meter providers, every later call is a no-op. The
 * `telemetry.otlpExportEnabled` switch therefore comes from the process-wide
 * Settings instance, not from a project-scoped clone, and a change only takes
 * effect on the next launch.
 */
declare global {
  var __ompTelemetryStarted: Promise<void> | undefined;
  var __ompTelemetryInitTimedOut: boolean | undefined;
}

const INIT_TIMEOUT_MS = 3_000;

function startTelemetryExport(settings: Settings): Promise<boolean> {
  // Telemetry is optional observability: an init failure or a stalled module
  // load must not fail or block session creation. omp caches its own rejected
  // init promise, so a retry would replay the same error — this one attempt
  // stands for the process, and a failure keeps sessions running without export.
  globalThis.__ompTelemetryStarted ??= initTelemetryExport(
    cfgTelemetryOtlpExportEnabled.get(settings),
  ).catch((error: unknown) => {
    console.error(
      "[ompdesk] telemetry export init failed:",
      error instanceof Error ? error.message : error,
    );
  });

  // After a timeout, stop blocking new sessions but keep asking the SDK whether
  // the late init finished: caching `false` here would contradict providers that
  // registered anyway.
  if (globalThis.__ompTelemetryInitTimedOut) return Promise.resolve(isTelemetryExportEnabled());

  return settleTelemetryInit(
    globalThis.__ompTelemetryStarted,
    isTelemetryExportEnabled,
    INIT_TIMEOUT_MS,
    () => {
      globalThis.__ompTelemetryInitTimedOut = true;
      console.error("[ompdesk] telemetry export init timed out; sessions continue without export");
    },
  );
}

/**
 * Wait at most `timeoutMs` for the process-wide init, then report whether
 * export is actually active. Split out so the timeout path is exercised without
 * faking the OTel SDK.
 */
export function settleTelemetryInit(
  init: Promise<void>,
  isActive: () => boolean,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<boolean> {
  return withTimeout(init.then(() => isActive()), timeoutMs, () => {
    onTimeout();
    return false;
  });
}

/**
 * Telemetry config for one session, or `undefined` when no `OTEL_*` endpoint is
 * configured — omp then never loads its exporter module at all.
 */
export async function sessionTelemetry(
  settings: Settings,
  modelRegistry: ModelRegistry,
): Promise<AgentTelemetryConfig | undefined> {
  try {
    if (!(await startTelemetryExport(settings))) return undefined;
    // Same rule as the CLI: report the provider-computed cost only for models
    // whose rate card is known, instead of exporting a bogus $0.
    return createTelemetryExportConfig(undefined, (providerId, modelId) => {
      const model = modelRegistry.find(providerId, modelId);
      return model !== undefined && getModelPricingStatus(model) !== "unknown";
    });
  } catch (error) {
    // Optional observability again: the enable check and a broken export config
    // must not fail the session that was about to start.
    console.error(
      "[ompdesk] telemetry config failed:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

/**
 * Push buffered spans at the end of a turn. omp batches on a 30-second timer,
 * which would leave a fresh trace invisible for that long in the browser.
 * Never rejects; callers that need the flush to finish (shutdown) await it and
 * pass `timeoutMs` so an unreachable collector cannot hold the caller open for
 * the exporter's own timeout.
 */
export async function flushSessionTelemetry(timeoutMs?: number): Promise<void> {
  try {
    const flushing = flushTelemetryExport();
    await (timeoutMs === undefined ? flushing : withTimeout(flushing, timeoutMs, () => undefined));
  } catch (error) {
    console.error("[ompdesk] telemetry flush failed:", error instanceof Error ? error.message : error);
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  // A late settle after the deadline must not surface as an unhandled rejection.
  void work.catch(() => {});
  const expired = Promise.withResolvers<T>();
  const timer = setTimeout(() => expired.resolve(onTimeout()), timeoutMs);
  timer.unref?.();
  return Promise.race([work, expired.promise]).finally(() => clearTimeout(timer));
}
