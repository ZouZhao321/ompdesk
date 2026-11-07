// Opens the URL in a new browser tab. `noopener,noreferrer` keeps the opened
// page from reaching back into the panel through `window.opener`.
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
