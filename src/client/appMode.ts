export type AppMode = "explorer" | "scoring";
const LAST_SEARCH = { explorer: "covis.last.explorer", scoring: "covis.last.scoring" } as const;
export const isScoringPath = (pathname: string) => pathname === "/scoring" || pathname.startsWith("/scoring/");

/** Remember each mode's last query so the navigation entries return to it. */
export function rememberModeLocation(mode: AppMode) {
    try { sessionStorage.setItem(LAST_SEARCH[mode], window.location.search); } catch { /* storage unavailable */ }
}
export function lastSearch(mode: AppMode) {
    try { return sessionStorage.getItem(LAST_SEARCH[mode]) ?? ""; } catch { return ""; }
}
