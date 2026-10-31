import type { MouseEvent } from "react";
import { lastSearch, rememberModeLocation, type AppMode } from "./appMode.js";

export function TopBar({ mode, homeHref = "/", onHome }: {
    mode: AppMode;
    homeHref?: string;
    onHome?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
    const entry = (target: AppMode, label: string, path: string) => {
        const active = target === mode;
        return <a href={active ? `${path}${window.location.search}` : `${path}${lastSearch(target)}`} aria-current={active ? "page" : undefined}
            onClick={active ? event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault(); } : () => rememberModeLocation(mode)}>{label}</a>;
    };
    return <header className="topbar"><h1><a href={homeHref} onClick={onHome ?? (() => rememberModeLocation(mode))} title="Back to home">COViS</a></h1>
        <nav className="mode-nav" aria-label="Modes">{entry("explorer", "T2I-Explorer", "/")}{entry("scoring", "Scoring", "/scoring")}</nav>
    </header>;
}
