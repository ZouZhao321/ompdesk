"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { WebAccessStatus } from "@/lib/api-types";
import styles from "./SettingsConfig.module.css";

/**
 * The password lock, from the settings dialog.
 *
 * ompdesk can drive a high-privilege agent, so the panel is deliberately blunt
 * about what the lock does and does not protect: it authenticates, it does not
 * encrypt, and the password itself is never readable back — which is why the
 * recovery paths are spelled out here rather than left to the documentation.
 */

type AccessAction = "set-password" | "enable" | "disable" | "clear";

const MIN_PASSWORD_LENGTH = 8;

export function AccessConfig() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<WebAccessStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/web-access", { cache: "no-store" });
      const data = await response.json() as WebAccessStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (action: AccessAction, body: { password?: string } = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/web-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json() as WebAccessStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const savePassword = useCallback(async () => {
    if (password !== confirmation) {
      setError(t("settings.access.mismatch"));
      return;
    }
    const updated = await send("set-password", { password });
    if (!updated) return;
    setPassword("");
    setConfirmation("");
    setNotice(t("settings.access.saved", { username: updated.username }));
  }, [confirmation, password, send, t]);

  const toggleEnabled = useCallback(async () => {
    if (!status) return;
    const updated = await send(status.enabled ? "disable" : "enable");
    if (!updated) return;
    setNotice(updated.enabled
      ? t("settings.access.enabled", { username: updated.username })
      : t("settings.access.disabled"));
  }, [send, status, t]);

  const clearPassword = useCallback(async () => {
    const updated = await send("clear");
    if (!updated) return;
    setNotice(t("settings.access.cleared"));
  }, [send, t]);

  if (!status) {
    return <div className={styles.empty}>{loadError ?? t("settings.access.loading")}</div>;
  }

  const stateText = status.managedByEnvironment
    ? t("settings.access.stateEnvironment")
    : status.unreadable
      ? t("settings.access.stateUnreadable")
      : !status.configured
        ? t("settings.access.stateUnset")
        : status.enabled
          ? t("settings.access.stateEnabled")
          : t("settings.access.stateDisabled");

  const readOnly = status.managedByEnvironment;
  const canSave = !busy && !readOnly && password.length >= MIN_PASSWORD_LENGTH && password === confirmation;

  return (
    <div className={styles.scrollContent}>
      <header className={styles.contentHeader}>
        <h2 className={styles.contentTitle}>{t("settings.access.title")}</h2>
        <p className={styles.contentDescription}>
          {t("settings.access.descriptionPrefix")}<code>{status.username}</code>{t("settings.access.descriptionMiddle")}<code>{status.file}</code>{t("settings.access.descriptionSuffix")}
        </p>
        {readOnly && (
          <div className={styles.readOnlyNotice}>
            {t("settings.access.readOnlyPrefix")}<code>OMPDESK_PASSWORD</code>{t("settings.access.readOnlySuffix")}
          </div>
        )}
        {notice && (
          <div className={styles.reloadNotice}><span>{notice}</span></div>
        )}
      </header>

      <div className={styles.settingsBody}>
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t("settings.access.groupPasswordAccess")}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("settings.access.requirePassword")}</div>
              <div className={styles.settingDescription}>{stateText}</div>
              {!status.configured && !readOnly && (
                <div className={styles.settingDescription}>{t("settings.access.setBeforeEnabling")}</div>
              )}
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <div className={styles.settingControl}>
              <button
                type="button"
                className={styles.switch}
                data-on={status.enabled}
                aria-pressed={status.enabled}
                aria-label={t("settings.access.requirePassword")}
                disabled={busy || readOnly || (!status.enabled && !status.stored)}
                onClick={() => void toggleEnabled()}
              />
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{status.stored ? t("settings.access.replacePassword") : t("settings.access.setPassword")}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("settings.access.newPassword")}</div>
              <div className={styles.settingDescription}>
                {t("settings.access.newPasswordHint", { count: MIN_PASSWORD_LENGTH })}
              </div>
            </div>
            <div className={styles.settingControl}>
              <input
                className={styles.textInput}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy || readOnly}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("settings.access.confirmPassword")}</div>
              <div className={styles.settingDescription}>{t("settings.access.confirmPasswordHint")}</div>
            </div>
            <div className={styles.settingControl}>
              <input
                className={styles.textInput}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy || readOnly}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && canSave) void savePassword(); }}
              />
            </div>
          </div>
          <div className={styles.editorActions}>
            <div>
              <div className={styles.saveState}>
                {status.stored && status.updatedAt
                  ? t("settings.access.lastChanged", { time: new Date(status.updatedAt).toLocaleString(locale) })
                  : t("settings.access.noPasswordStored")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {status.stored && !readOnly && (
                <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void clearPassword()}>
                  {t("settings.access.removePassword")}
                </button>
              )}
              <button type="button" className={styles.primaryButton} disabled={!canSave} onClick={() => void savePassword()}>
                {busy ? t("settings.access.saving") : t("settings.access.savePassword")}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t("settings.access.forgotTitle")}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("settings.access.recovery")}</div>
              <div className={styles.settingDescription}>
                {t("settings.access.recoveryPrefix")}<code>ompdesk --reset-password</code>{t("settings.access.recoveryMiddle")}<code>/recover</code>{t("settings.access.recoverySuffix")}
              </div>
            </div>
            <div className={styles.settingControl}>
              <a className={styles.linkButton} href="/recover" target="_blank" rel="noreferrer">{t("settings.access.openRecovery")}</a>
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("settings.access.basicAuthNote")}</div>
              <div className={styles.settingDescription}>{t("settings.access.basicAuthDetail")}</div>
            </div>
            <div className={styles.settingControl} />
          </div>
        </section>
      </div>
    </div>
  );
}
