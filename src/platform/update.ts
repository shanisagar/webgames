/** Reloads the page to pick up a newer deploy, at most once per 15 s (so a real outage shows the error screen). */
export function reloadForUpdate() {
  let last = 0;
  try { last = Number(sessionStorage.getItem("reloaded-for-update") ?? 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 15000) return false;
  try { sessionStorage.setItem("reloaded-for-update", String(Date.now())); } catch { /* ignore */ }
  location.reload();
  return true;
}
