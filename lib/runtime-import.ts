/**
 * Import a module at runtime without letting the bundler resolve it.
 *
 * Next compiles instrumentation and route handlers as separate webpack graphs.
 * A statically visible specifier gets bundled into that graph even when it is
 * only reached on the server: the SDK's TypeScript sources fail on their first
 * `export type`, plain CommonJS in `bin/` is rejected for `node:crypto`, and a
 * copied SDK logger would lose the transport `instrumentation.ts` configured.
 * `webpackIgnore` keeps the call a native dynamic import in both webpack and
 * Bun, so the module is loaded by the runtime that is actually executing.
 */
export function importRuntimeModule<T>(specifier: string): Promise<T> {
	return import(/* webpackIgnore: true */ specifier) as Promise<T>;
}
