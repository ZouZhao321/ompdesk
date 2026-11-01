"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { AccessConfig } from "./AccessConfig";
import { LogsPanel } from "./LogsPanel";
import { SearchableSelect } from "./SearchableSelect";
import { refreshOmpTheme, useTheme } from "@/hooks/useTheme";
import { refreshDisplaySettings } from "@/hooks/useDisplaySettings";
import { useI18n } from "@/hooks/useI18n";
import {
  settingFieldDescriptionKey,
  settingFieldLabelKey,
  settingGroupKey,
  settingTabKey,
} from "@/lib/i18n/settings";
import { sendAgentCommand, type RuntimeSessionBinding } from "@/lib/agent-client";
import type {
  McpConfigResponse,
  McpScopeConfig,
  McpServerConfig,
  McpServerEntry,
  SettingsField,
  SettingsResponse,
  SettingsValue,
  WebThemePalette,
} from "@/lib/settings-api";
import styles from "./SettingsConfig.module.css";

type SettingsSection = "models" | "themes" | "skills" | "plugins" | "mcp" | "access" | "logs" | `settings:${string}`;

interface SettingsConfigProps {
  cwd?: string | null;
  sessionId: string | null;
  runtimeId?: string;
  onRuntimeIdentity?: RuntimeSessionBinding["onIdentity"];
  initialSection?: SettingsSection;
  onClose: () => void;
  onModelsChanged?: () => void;
  onReloaded?: (runtimeId: string | null) => void;
}

const CORE_SECTIONS: Array<{ id: SettingsSection; label: string; icon: string; requiresCwd?: boolean }> = [
  { id: "models", label: "Models", icon: "model" },
  { id: "themes", label: "Themes", icon: "theme" },
  { id: "skills", label: "Skills", icon: "skill", requiresCwd: true },
  { id: "plugins", label: "Plugins", icon: "plugin", requiresCwd: true },
  { id: "mcp", label: "MCP", icon: "mcp" },
  { id: "access", label: "Access", icon: "access" },
  { id: "logs", label: "Logs", icon: "logs" },
];

const ICON_PATHS: Record<string, React.ReactNode> = {
  model: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m16 0h3M1 15h3m16 0h3"/></>,
  theme: <><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z"/></>,
  skill: <><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
  plugin: <><path d="M8 3v5m8-5v5M6 8h12v5a6 6 0 0 1-12 0V8Zm6 11v3"/></>,
  mcp: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7.5 11 16m5-8.5L13 16M8 6h8"/></>,
  access: <><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/></>,
  logs: <><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/></>,
  appearance: <><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></>,
  interaction: <><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8m-8 3h5"/></>,
  context: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8m-8 4h8"/></>,
  memory: <><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5v1a3 3 0 0 0 3 3h1m6-13a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5v1a3 3 0 0 1-3 3h-1M9 4v16m6-16v16"/></>,
  files: <><path d="M3 6h7l2 2h9v11H3z"/></>,
  shell: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></>,
  tools: <><path d="m14 6 4-4 4 4-4 4M3 18l8-8m-6 4 5 5-3 3-5-5 3-3Z"/></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/></>,
  providers: <><path d="M7 4h10v5H7zM4 15h6v5H4zm10 0h6v5h-6zM12 9v3m-5 0h10M7 12v3m10-3v3"/></>,
};

function SettingsIcon({ kind }: { kind: string }) {
  return <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[kind] ?? ICON_PATHS.tools}</svg>;
}

function conditionVisible(field: SettingsField, values: Map<string, SettingsValue>): boolean {
  switch (field.condition) {
    case undefined: return true;
    case "hasImageProtocol": return false;
    case "advisorEnabled": return values.get("advisor.enabled") === true;
    case "hindsightActive": return values.get("memory.backend") === "hindsight";
    case "mnemopiActive": return values.get("memory.backend") === "mnemopi";
    case "autolearnActive": return values.get("autolearn.enabled") === true;
    case "autoThinkingActive": return values.get("defaultThinkingLevel") === "auto";
    case "usageAwareFallbackEnabled": return values.get("retry.usageAwareFallback") === true;
    case "planModeEnabled": return values.get("plan.enabled") === true;
    case "unexpectedStopDetection": return values.get("features.unexpectedStopDetection") === true;
    default: return true;
  }
}

function TextSetting({ field, busy, onSave }: { field: SettingsField; busy: boolean; onSave: (value: SettingsValue) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(field.type === "secret" ? "" : String(field.value ?? ""));
  useEffect(() => {
    setValue(field.type === "secret" ? "" : String(field.value ?? ""));
  }, [field.path, field.type, field.value]);
  const persisted = field.type === "secret" ? "" : String(field.value ?? "");
  return (
    <input
      className={styles.textInput}
      type={field.type === "secret" ? "password" : "text"}
      value={value}
      disabled={busy}
      placeholder={field.type === "secret" && field.configured ? t("settings.secretPlaceholder") : undefined}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => { if (value !== persisted && (field.type !== "secret" || value.length > 0)) onSave(value); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

function ProviderLimitsSetting({ field, busy, onSave }: { field: SettingsField; busy: boolean; onSave: (value: SettingsValue) => void }) {
  const serialized = JSON.stringify(field.value ?? {}, null, 2);
  const [value, setValue] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(serialized); setError(null); }, [serialized]);
  return (
    <div style={{ width: "100%" }}>
      <textarea
        className={styles.jsonEditor}
        style={{ minHeight: 92 }}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value === serialized) return;
          try {
            onSave(JSON.parse(value) as Record<string, number>);
            setError(null);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
      />
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function MultiSelectSetting({ field, busy, onSave }: { field: SettingsField; busy: boolean; onSave: (value: SettingsValue) => void }) {
  const selected = Array.isArray(field.value) ? field.value : [];
  const toggle = (value: string) => onSave(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onSave(next);
  };
  return (
    <div className={styles.multiSelect}>
      {field.options?.map((option) => {
        const index = selected.indexOf(option.value);
        return (
          <span key={option.value} className={styles.choice} data-selected={index >= 0} title={option.description}>
            <button type="button" className={styles.choiceToggle} disabled={busy} onClick={() => toggle(option.value)}>{option.label}</button>
            {field.ordered && index >= 0 && <span className={styles.reorder}><button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)}>←</button><button type="button" disabled={busy || index === selected.length - 1} onClick={() => move(index, 1)}>→</button></span>}
          </span>
        );
      })}
    </div>
  );
}

function SettingControl({ field, label, busy, onSave }: { field: SettingsField; label: string; busy: boolean; onSave: (value: SettingsValue) => void }) {
  if (field.type === "boolean") return <button type="button" className={styles.switch} data-on={field.value === true} disabled={busy} aria-pressed={field.value === true} onClick={() => onSave(field.value !== true)} />;
  if (field.type === "select") {
    return <SearchableSelect value={String(field.value ?? "")} disabled={busy} ariaLabel={label} options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label, description: option.description }))} onChange={(value) => onSave(typeof field.value === "number" || typeof field.defaultValue === "number" ? Number(value) : value)} />;
  }
  if (field.type === "multiselect") return <MultiSelectSetting field={field} busy={busy} onSave={onSave} />;
  if (field.type === "providerLimits") return <ProviderLimitsSetting field={field} busy={busy} onSave={onSave} />;
  return <TextSetting field={field} busy={busy} onSave={onSave} />;
}

function SettingRow({ field, label, description, busy, error, onSave }: { field: SettingsField; label: string; description: string; busy: boolean; error?: string; onSave: (value: SettingsValue) => void }) {
  return (
    <div className={styles.settingRow}>
      <div><div className={styles.settingLabel}>{label}</div><div className={styles.settingDescription}>{description}</div>{error && <div className={styles.error}>{error}</div>}</div>
      <div className={styles.settingControl}><SettingControl field={field} label={label} busy={busy} onSave={onSave} /></div>
    </div>
  );
}

function ThemePreview({ palette }: { palette: WebThemePalette }) {
  const vars = palette.variables;
  return (
    <div className={styles.themePreview} style={{ background: vars["--bg"] }}>
      <div className={styles.themePreviewBar} style={{ background: vars["--accent"] }} />
      <div className={styles.themePreviewPanel} style={{ background: vars["--bg-panel"], borderColor: vars["--border"] }}>
        <div className={styles.themePreviewLine} style={{ background: vars["--text"] }} />
        <div className={styles.themePreviewLine} style={{ background: vars["--text-muted"] }} />
      </div>
    </div>
  );
}

/** Settings the web client applies itself, without reloading the agent. */
const DISPLAY_SETTING_PATHS = new Set(["hideThinkingBlock"]);

export function SettingsConfig({ cwd, sessionId, runtimeId, onRuntimeIdentity, initialSection = "models", onClose, onModelsChanged, onReloaded }: SettingsConfigProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [needsReload, setNeedsReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { t, tOr } = useI18n();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/settings${suffix}`, { cache: "no-store" });
      const data = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const saveSetting = useCallback(async (field: SettingsField, value: SettingsValue) => {
    setSaving((current) => new Set(current).add(field.path));
    setSaveErrors((current) => { const next = { ...current }; delete next[field.path]; return next; });
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: field.path, value }) });
      const result = await response.json() as { value?: SettingsValue; error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
      setSettings((current) => current ? { ...current, fields: current.fields.map((item) => item.path === field.path ? { ...item, value: result.value ?? value, configured: true } : item) } : current);
      if (field.path === "theme.dark" || field.path === "theme.light") {
        await refreshOmpTheme(cwd);
        await loadSettings();
      } else if (DISPLAY_SETTING_PATHS.has(field.path)) {
        // Render-only settings take effect in the open transcript right away,
        // so the toggle is not a dead control until the next reload.
        await refreshDisplaySettings(cwd);
      } else {
        setNeedsReload(true);
      }
    } catch (error) {
      setSaveErrors((current) => ({ ...current, [field.path]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving((current) => { const next = new Set(current); next.delete(field.path); return next; });
    }
  }, [cwd, loadSettings]);

  const values = useMemo(() => new Map(settings?.fields.map((field) => [field.path, field.value]) ?? []), [settings?.fields]);
  const visibleFields = useMemo(() => settings?.fields.filter((field) => conditionVisible(field, values)) ?? [], [settings?.fields, values]);
  const activeTab = section.startsWith("settings:") ? section.slice("settings:".length) : null;
  const filteredFields = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      return visibleFields.filter((field) => {
        const label = tOr(settingFieldLabelKey(field.path), field.label);
        const description = tOr(settingFieldDescriptionKey(field.path), field.description);
        const group = field.group ? tOr(settingGroupKey(field.tab, field.group), field.group) : t("settings.groupUnspecified");
        return `${label} ${description} ${field.path} ${group}`.toLowerCase().includes(normalized);
      });
    }
    if (!activeTab) return [];
    return visibleFields.filter((field) => field.tab === activeTab && !(activeTab === "appearance" && field.group === "Theme"));
  }, [activeTab, query, t, tOr, visibleFields]);

  const close = useCallback(() => { onModelsChanged?.(); onClose(); }, [onClose, onModelsChanged]);
  const reloadActiveSession = useCallback(async () => {
    if (!sessionId) return;
    setReloading(true);
    try {
      const binding = { current: runtimeId ?? null, onIdentity: onRuntimeIdentity };
      await sendAgentCommand(sessionId, { type: "reload" }, binding);
      setNeedsReload(false);
      onReloaded?.(binding.current);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReloading(false);
    }
  }, [onReloaded, onRuntimeIdentity, runtimeId, sessionId]);
  const selectedTab = settings?.tabs.find((tab) => tab.id === activeTab);
  const pageTitle = query.trim()
    ? t("settings.searchResults", { count: filteredFields.length })
    : selectedTab ? tOr(settingTabKey(selectedTab.id), selectedTab.label) : t("common.settings");

  const renderFields = (fields: SettingsField[], groups: string[], tab = "") => {
    const unspecified = "General";
    const orderedGroups = [...groups, ...fields.map((field) => field.group ?? unspecified).filter((group) => !groups.includes(group))];
    return [...new Set(orderedGroups)].map((group) => {
      const groupFields = fields.filter((field) => (field.group ?? unspecified) === group);
      if (!groupFields.length) return null;
      const groupTab = tab || groupFields[0]?.tab || "";
      const title = group === unspecified ? t("settings.groupUnspecified") : tOr(settingGroupKey(groupTab, group), group);
      return (
        <section className={styles.group} key={group}>
          <h3 className={styles.groupTitle}>{title}</h3>
          {groupFields.map((field) => (
            <SettingRow
              key={field.path}
              field={field}
              label={tOr(settingFieldLabelKey(field.path), field.label)}
              description={tOr(settingFieldDescriptionKey(field.path), field.description)}
              busy={saving.has(field.path)}
              error={saveErrors[field.path]}
              onSave={(value) => void saveSetting(field, value)}
            />
          ))}
        </section>
      );
    });
  };

  const renderThemeSection = () => {
    if (!settings) return <div className={styles.empty}>{loading ? t("settings.themes.loading") : loadError ?? t("settings.themes.unavailable")}</div>;
    return (
      <div className={styles.scrollContent}>
        <header className={styles.contentHeader}><h2 className={styles.contentTitle}>{t("settings.themes.title")}</h2><p className={styles.contentDescription}>{t("settings.themes.descriptionPrefix")}<code>~/.omp/agent/config.yml</code>{t("settings.themes.descriptionSuffix")}</p></header>
        <div className={styles.settingsBody}>
          <div className={styles.themeGrid}>{(["dark", "light"] as const).map((mode) => {
            const field = settings.fields.find((item) => item.path === `theme.${mode}`)!;
            const palette = settings.theme.palettes[mode];
            return <div className={styles.themeCard} key={mode}><ThemePreview palette={palette} /><div className={styles.themeCardBody}><div className={styles.themeCardHeader}><span className={styles.themeSlot}>{t("settings.themes.mapping", { mode })}</span>{theme === mode && <span className={styles.themeActive}>{t("settings.themes.activeOnWeb")}</span>}</div><SearchableSelect value={String(field.value)} disabled={saving.has(field.path)} ariaLabel={t("settings.themes.pickerLabel", { mode })} options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label, description: option.description }))} onChange={(value) => void saveSetting(field, value)} />{theme !== mode && <button type="button" className={styles.closeButton} style={{ marginTop: 8 }} onClick={() => toggleTheme()}>{t("settings.themes.preview", { mode })}</button>}</div></div>;
          })}</div>
          {renderFields(settings.fields.filter((field) => field.tab === "appearance" && field.group === "Theme" && !field.path.startsWith("theme.")), ["Theme"], "appearance")}
        </div>
      </div>
    );
  };

  const renderGenericSettings = () => {
    if (loading) return <div className={styles.empty}>{t("settings.loading")}</div>;
    if (loadError || !settings) return <div className={styles.empty}>{loadError ?? t("settings.unavailable")}</div>;
    return (
      <div className={styles.scrollContent}>
        <header className={styles.contentHeader}>
          <h2 className={styles.contentTitle}>{pageTitle}</h2>
          <p className={styles.contentDescription}>
            {query.trim() ? t("settings.searchDescription") : t("settings.description")}
          </p>
          {needsReload && sessionId && (
            <div className={styles.reloadNotice}>
              <span>{t("settings.savedReload")}</span>
              <button type="button" onClick={() => void reloadActiveSession()} disabled={reloading}>
                {reloading ? t("settings.reloading") : t("settings.reloadSession")}
              </button>
            </div>
          )}
        </header>
        <div className={styles.settingsBody}>
          {filteredFields.length
            ? renderFields(filteredFields, selectedTab?.groups ?? [])
            : <div className={styles.empty}>{t("settings.noMatches")}</div>}
        </div>
      </div>
    );
  };

  const renderSection = () => {
    if (query.trim()) return renderGenericSettings();
    switch (section) {
      case "models":
        return <ModelsConfig cwd={cwd} embedded onClose={close} onModelsChanged={onModelsChanged} />;
      case "themes":
        return renderThemeSection();
      case "skills":
        return cwd ? <SkillsConfig cwd={cwd} embedded onClose={close} /> : renderGenericSettings();
      case "plugins":
        return cwd
          ? (
            <PluginsConfig
              cwd={cwd}
              sessionId={sessionId}
              runtimeId={runtimeId}
              onRuntimeIdentity={onRuntimeIdentity}
              embedded
              onClose={close}
              onReloaded={onReloaded}
            />
          )
          : renderGenericSettings();
      case "mcp":
        return (
          <McpSettings
            cwd={cwd}
            sessionId={sessionId}
            runtimeId={runtimeId}
            onRuntimeIdentity={onRuntimeIdentity}
            onReloaded={onReloaded}
          />
        );
      case "access":
        return <AccessConfig />;
      case "logs":
        return <LogsPanel />;
      default:
        return renderGenericSettings();
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.window} role="dialog" aria-modal="true" aria-label={t("common.settings")}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}><div className={styles.eyebrow}>omp /settings</div><h1 className={styles.title}>{t("common.settings")}</h1><code className={styles.context} title={cwd ?? t("settings.globalConfiguration")}>{cwd ?? t("settings.globalConfiguration")}</code></div>
          <div className={styles.searchWrap}><svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input className={styles.search} value={query} placeholder={t("settings.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></div>
          <nav className={styles.nav}>
            <div className={styles.navLabel}>{t("settings.nav.configuration")}</div>
            {CORE_SECTIONS.map((item) => {
              const label = tOr(`settings.nav.${item.id}`, item.label);
              return <button key={item.id} type="button" className={styles.navButton} data-active={!query && section === item.id} disabled={item.requiresCwd && !cwd} title={item.requiresCwd && !cwd ? t("settings.requiresProject", { label }) : label} onClick={() => { setQuery(""); setSection(item.id); }}><SettingsIcon kind={item.icon}/><span>{label}</span></button>;
            })}
            <div className={styles.navLabel}>{t("settings.nav.ompSettings")}</div>
            {settings?.tabs.map((tab) => {
              const label = tOr(settingTabKey(tab.id), tab.label);
              return <button key={tab.id} type="button" className={styles.navButton} data-active={!query && activeTab === tab.id} onClick={() => { setQuery(""); setSection(`settings:${tab.id}`); }}><SettingsIcon kind={tab.id}/><span>{label}</span></button>;
            })}
          </nav>
          <div className={styles.closeRail}><button type="button" className={styles.closeButton} onClick={close}><span>{t("settings.close")}</span><span aria-hidden="true">×</span></button></div>
        </aside>
        <main className={styles.content}>
          {renderSection()}
        </main>
      </div>
    </div>
  );
}

function McpSettings({ cwd, sessionId, runtimeId, onRuntimeIdentity, onReloaded }: { cwd?: string | null; sessionId?: string | null; runtimeId?: string;
  onRuntimeIdentity?: RuntimeSessionBinding["onIdentity"]; onReloaded?: (runtimeId: string | null) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<McpConfigResponse | null>(null);
  const [scope, setScope] = useState<"user" | "project">("user");
  const [selected, setSelected] = useState(0);
  const [json, setJson] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/mcp${suffix}`, { cache: "no-store" });
      const result = await response.json() as McpConfigResponse & { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [cwd]);

  useEffect(() => { void load(); }, [load]);
  const currentScope: McpScopeConfig | null = data ? (scope === "user" ? data.user : data.project) : null;
  const server = currentScope?.servers[selected] ?? null;
  useEffect(() => { setName(server?.name ?? ""); setJson(server ? JSON.stringify(server.config, null, 2) : ""); }, [server]);

  const updateServers = (servers: McpScopeConfig["servers"]) => {
    setData((current) => {
      if (!current) return current;
      const updated = { ...(scope === "user" ? current.user : current.project!), servers };
      return scope === "user" ? { ...current, user: updated } : { ...current, project: updated };
    });
  };
  const commitDraft = (): Array<Pick<McpServerEntry, "name" | "config">> => {
    const servers = currentScope?.servers ?? [];
    const updated = server?.editable === false
      ? servers
      : servers.map((item, index) => index === selected
        ? { ...item, name, config: JSON.parse(json) as McpServerConfig }
        : item);
    return updated.filter((item) => item.editable !== false).map(({ name: serverName, config }) => ({ name: serverName, config }));
  };
  const save = async () => {
    if (!currentScope) return;
    setSaving(true);
    setError(null);
    try {
      const servers = commitDraft();
      const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/mcp${suffix}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, servers }) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };
  const toggleServer = async (entry: McpServerEntry) => {
    const key = `${scope}:${entry.name}`;
    setToggling(key);
    setError(null);
    try {
      const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/mcp${suffix}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, name: entry.name, enabled: !entry.enabled }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
      await load();
      if (sessionId) {
        const binding = { current: runtimeId ?? null, onIdentity: onRuntimeIdentity };
        await sendAgentCommand(sessionId, { type: "reload" }, binding);
        onReloaded?.(binding.current);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setToggling(null);
    }
  };
  const addServer = () => {
    if (!currentScope) return;
    let candidate = "new-server";
    let suffix = 2;
    while (currentScope.servers.some((item) => item.name === candidate)) candidate = `new-server-${suffix++}`;
    const next = [...currentScope.servers, { name: candidate, config: { type: "stdio" as const, command: "" }, enabled: true, editable: true }];
    updateServers(next);
    setSelected(next.length - 1);
  };
  const removeServer = () => {
    if (!currentScope || !server || server.editable === false) return;
    updateServers(currentScope.servers.filter((_, index) => index !== selected));
    setSelected(Math.max(0, selected - 1));
  };

  return (
    <div className={styles.scrollContent}>
      <header className={styles.contentHeader}>
        <h2 className={styles.contentTitle}>{t("settings.mcp.title")}</h2>
        <p className={styles.contentDescription}>{t("settings.mcp.description")}</p>
      </header>
      <div className={styles.settingsBody}>
        {!data ? <div className={styles.empty}>{error ?? t("settings.mcp.loading")}</div> : (
          <div className={styles.mcpLayout}>
            <aside className={styles.mcpList}>
              <div className={styles.scopeTabs}>
                <button type="button" className={styles.scopeButton} data-active={scope === "user"} onClick={() => { setScope("user"); setSelected(0); }}>{t("settings.mcp.scopeUser", { count: data.user.servers.length })}</button>
                <button type="button" className={styles.scopeButton} data-active={scope === "project"} disabled={!data.project} onClick={() => { setScope("project"); setSelected(0); }}>{t("settings.mcp.scopeProject", { count: data.project?.servers.length ?? 0 })}</button>
              </div>
              {currentScope?.error ? <div className={styles.error} style={{ padding: 12 }}>{currentScope.error}</div> : (
                <div className={styles.serverRows}>
                  {currentScope?.servers.length ? currentScope.servers.map((item, index) => {
                    const toggleKey = `${scope}:${item.name}`;
                    return (
                      <div key={`${item.name}-${item.source?.path ?? index}`} className={styles.serverRow} data-active={selected === index}>
                        <button type="button" className={styles.serverSelect} title={item.source?.path} onClick={() => setSelected(index)}>
                          <span className={styles.statusDot} data-off={!item.enabled} />
                          <span className={styles.serverName}>{item.name}</span>
                          {item.editable === false && <span className={styles.sourceBadge}>{item.source?.provider ?? t("settings.mcp.externalSource")}</span>}
                        </button>
                        <button
                          type="button"
                          className={styles.serverToggle}
                          data-on={item.enabled}
                          disabled={toggling === toggleKey}
                          aria-pressed={item.enabled}
                          aria-label={t(item.enabled ? "settings.mcp.disableServer" : "settings.mcp.enableServer", { name: item.name })}
                          title={t(item.enabled ? "settings.mcp.disableServer" : "settings.mcp.enableServer", { name: item.name })}
                          onClick={() => void toggleServer(item)}
                        >
                          {toggling === toggleKey ? "…" : item.enabled ? t("settings.mcp.enabled") : t("settings.mcp.disabled")}
                        </button>
                      </div>
                    );
                  }) : <div className={styles.serverListEmpty}>{t("settings.mcp.noServers")}</div>}
                </div>
              )}
              <button type="button" className={styles.addServer} disabled={Boolean(currentScope?.error)} onClick={addServer}>{t("settings.mcp.addServer")}</button>
            </aside>
            <section className={styles.mcpEditor}>
              {server ? (
                <>
                  <div className={styles.editorHeader}>
                    <input className={styles.textInput} value={name} readOnly={server.editable === false} onChange={(event) => setName(event.target.value)} placeholder={t("settings.mcp.namePlaceholder")} />
                    {server.editable !== false && <button type="button" className={styles.dangerButton} onClick={removeServer}>{t("settings.mcp.delete")}</button>}
                  </div>
                  {server.editable === false && <div className={styles.readOnlyNotice}>{t("settings.mcp.readOnlyNotice", { provider: server.source?.provider ?? t("settings.mcp.externalProvider") })}</div>}
                  <textarea className={styles.jsonEditor} value={json} readOnly={server.editable === false} spellCheck={false} onChange={(event) => setJson(event.target.value)} />
                  <div className={styles.editorActions}>
                    <div>
                      {error && <div className={styles.error}>{error}</div>}
                      <div className={styles.saveState}>{server.source?.path ?? currentScope?.path}</div>
                    </div>
                    {server.editable !== false && <button type="button" className={styles.primaryButton} disabled={saving} onClick={() => void save()}>{saving ? t("settings.mcp.saving") : t("settings.mcp.save")}</button>}
                  </div>
                </>
              ) : <div className={styles.empty}>{t("settings.mcp.emptyEditor")}</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
