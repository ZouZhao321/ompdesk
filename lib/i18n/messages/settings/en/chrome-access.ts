/** 访问页的英文文案。 */
export const chromeAccess: Record<string, string> = {
  "settings.access.title": "Access",
  "settings.access.descriptionPrefix":
    "A password locks the web interface and every API endpoint behind HTTP Basic Auth, with the fixed username ",
  "settings.access.descriptionMiddle": ". It is stored as a scrypt hash in ",
  "settings.access.descriptionSuffix":
    " — ompdesk never keeps the password itself, which is why forgetting it means recovering rather than reading it back.",
  "settings.access.readOnlyPrefix": "Read-only · ",
  "settings.access.readOnlySuffix":
    " is set and overrides the stored credential. Unset it and restart ompdesk to manage the password here.",
  "settings.access.loading": "Loading password access…",
  "settings.access.groupPasswordAccess": "Password access",
  "settings.access.requirePassword": "Require a password",
  "settings.access.setBeforeEnabling": "Set a password below before turning this on.",
  "settings.access.stateEnvironment": "Every request needs the password from OMPDESK_PASSWORD.",
  "settings.access.stateUnreadable":
    "The credential file exists but could not be read, so every request is being refused.",
  "settings.access.stateUnset": "No password is set. Anyone who can reach this server can use it.",
  "settings.access.stateEnabled": "Every request needs the username and password.",
  "settings.access.stateDisabled": "A password is stored but the lock is off.",
  "settings.access.replacePassword": "Replace the password",
  "settings.access.setPassword": "Set a password",
  "settings.access.newPassword": "New password",
  "settings.access.newPasswordHint": "At least {count} characters. Saving a password also turns password access on.",
  "settings.access.confirmPassword": "Confirm password",
  "settings.access.confirmPasswordHint": "Both entries have to match before it can be saved.",
  "settings.access.lastChanged": "Last changed {time}",
  "settings.access.noPasswordStored": "No password stored yet",
  "settings.access.removePassword": "Remove password",
  "settings.access.saving": "Saving…",
  "settings.access.savePassword": "Save password",
  "settings.access.forgotTitle": "If you forget it",
  "settings.access.recovery": "Recovery",
  "settings.access.recoveryPrefix": "Run ",
  "settings.access.recoveryMiddle": " on this machine to set a new one, or open ",
  "settings.access.recoverySuffix":
    " in the browser: ompdesk prints a one-time code on its own console, and entering that code sets a new password. Both paths require access to the machine running the server — nothing can hand the password back.",
  "settings.access.openRecovery": "Open /recover",
  "settings.access.basicAuthNote": "Basic Auth is not encryption",
  "settings.access.basicAuthDetail":
    "The password crosses the network in a reversible encoding. Over plain HTTP on an untrusted network it can be read in transit, so put ompdesk behind HTTPS or a trusted VPN before exposing it beyond loopback.",
  "settings.access.mismatch": "The two passwords do not match.",
  "settings.access.saved":
    'Password saved and password access turned on. The browser will ask for the username "{username}" and this password on the next request.',
  "settings.access.enabled":
    'Password access is on. The browser will ask for the username "{username}" and your password on the next request.',
  "settings.access.disabled": "Password access is off. The stored password is kept and can be switched back on here.",
  "settings.access.cleared": "The stored password was removed and password access is off.",
};
