import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { kNoAuth, ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent";
import { getOmpRuntime } from "./omp-runtime";

export interface ModelDiscoveryAuth {
	apiKey?: string;
	headers: Record<string, string>;
}

export interface ModelDiscoveryAuthDeps {
	/**
	 * 解析凭据用的 AuthStorage。省略时取进程级 runtime 的实例（打开真实
	 * `~/.omp/agent/agent.db` 并做在线刷新）；测试注入离线实例即可脱离用户凭据。
	 */
	authStorage?: AuthStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

export async function resolveModelDiscoveryAuth(
	providerName: string,
	provider: Record<string, unknown>,
	deps: ModelDiscoveryAuthDeps = {},
): Promise<ModelDiscoveryAuth> {
	let tempDir: string | undefined;
	try {
		tempDir = mkdtempSync(join(tmpdir(), "ompdesk-model-discovery-"));
		const modelsPath = join(tempDir, "models.json");
		const discoveryModelId = "__ompdesk_model_discovery__";
		// omp rejects a custom-model provider without a key unless it declares
		// `auth: "none"`. Header-only providers (a gateway authenticated through an
		// `$ENV_VAR` header) are exactly that case, so say so explicitly.
		const needsKeylessAuth = provider.apiKey === undefined && provider.auth === undefined;
		writeFileSync(
			modelsPath,
			JSON.stringify(
				{
					providers: {
						[providerName]: {
							...provider,
							...(needsKeylessAuth ? { auth: "none" } : {}),
							models: [{ id: discoveryModelId }],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		// A throwaway registry over the submitted provider config, sharing the real
		// AuthStorage so an already-saved key for this provider still resolves.
		const authStorage = deps.authStorage ?? (await getOmpRuntime()).authStorage;
		const registry = new ModelRegistry(authStorage, modelsPath);
		await registry.refresh("offline");
		const loadError = registry.getError();
		if (loadError) throw new Error(loadError.message);
		const model = registry.find(providerName, discoveryModelId);
		if (!model) throw new Error(`Unable to load provider "${providerName}"`);

		const resolved = await registry.getApiKeyAndHeaders(model);
		if (resolved.ok) {
			// Keyless providers advertise omp's `kNoAuth` sentinel rather than a real
			// key; sending it as a bearer token would be a bogus credential.
			const apiKey = resolved.apiKey === kNoAuth ? undefined : resolved.apiKey;
			return {
				...(apiKey ? { apiKey } : {}),
				headers: stringRecord(resolved.headers),
			};
		}

		return { headers: stringRecord(registry.getProviderHeaders(providerName)) };
	} finally {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	}
}
