import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Download, Eye } from "lucide-react";
import { isAgentLabelSet, type ScoringChoice, type ScoringLabelRow, type ScoringLabelsResponse, type ScoringRevealResponse, type ScoringSetResponse, type ScoringSetsResponse } from "../shared/scoring.js";
import { Lightbox } from "./Lightbox.js";
import { MediaPanels } from "./MediaPanels.js";
import { scoringApi } from "./scoringApi.js";
import { filterItems, readRevealed, readReviewer, revealedKey, REVIEWER_KEY, scoringRecord, validReviewerName } from "./scoringModel.js";
import { parseScoringState, serializeScoringState, type ScoringViewState } from "./scoringUrlState.js";
import { TopBar } from "./TopBar.js";

const choiceLabel = (choice: ScoringChoice) => choice === "tie" ? "Tie" : `Candidate ${choice}`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function Regions({ row }: { row: ScoringLabelRow }) {
    if (!row.regions?.length) return null;
    return <table className="scoring-regions"><caption>Regions</caption><thead><tr><th scope="col">Window</th><th scope="col">Present</th><th scope="col">Note</th></tr></thead>
        <tbody>{row.regions.map((region, index) => <tr key={`${region.window_id}-${index}`}><td>{region.window_id}</td><td>{region.present}</td><td>{region.note ?? ""}</td></tr>)}</tbody></table>;
}

function ReviewerPrompt({ initial, onSubmit, onCancel }: { initial?: string; onSubmit: (name: string) => void; onCancel?: () => void }) {
    const [name, setName] = useState(initial ?? "");
    const valid = validReviewerName(name);
    const submit = (event: FormEvent) => { event.preventDefault(); if (valid) onSubmit(name); };
    return <form className="reviewer-prompt" onSubmit={submit} aria-label="Reviewer name">
        <h2>Who is reviewing?</h2>
        <p>Your labels are saved under this name. Use letters, digits, <code>_</code> or <code>-</code> (up to 32 characters); names starting with <code>agent-</code> are reserved for prefilled agent verdicts.</p>
        <label>Reviewer name<input autoFocus value={name} onChange={event => setName(event.target.value.trim())} aria-invalid={name !== "" && !valid} maxLength={32}/></label>
        <div className="reviewer-actions"><button type="submit" className="primary" disabled={!valid}>Continue</button>{onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}</div>
    </form>;
}

export function ScoringApp() {
    const [view, setView] = useState<ScoringViewState>(() => parseScoringState(window.location.search));
    const [reviewer, setReviewer] = useState<string | undefined>(readReviewer);
    const [editingReviewer, setEditingReviewer] = useState(false);
    const [sets, setSets] = useState<ScoringSetsResponse>();
    const [setData, setSetData] = useState<ScoringSetResponse>();
    const [labels, setLabels] = useState<ScoringLabelsResponse>();
    const [prefill, setPrefill] = useState<ScoringLabelsResponse>();
    const [error, setError] = useState<string>();
    const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>({ status: "idle" });
    const [edits, setEdits] = useState<{ key: string; choice?: ScoringChoice; reason: string }>();
    const [revealedState, setRevealed] = useState<{ key: string; map: Record<string, ScoringRevealResponse["blind_map"]> }>();
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const focusReturn = useRef<HTMLElement | undefined>(undefined);
    const reasonRef = useRef<HTMLTextAreaElement>(null);

    const updateView = useCallback((updater: (current: ScoringViewState) => ScoringViewState, replace = false) => {
        setView(current => { const next = updater(current); window.history[replace ? "replaceState" : "pushState"]({}, "", `${window.location.pathname}${serializeScoringState(next)}`); return next; });
    }, []);
    useEffect(() => { const onPop = () => setView(parseScoringState(window.location.search)); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
    useEffect(() => { window.history.replaceState({}, "", `${window.location.pathname}${serializeScoringState(parseScoringState(window.location.search))}`); }, []);

    useEffect(() => { const controller = new AbortController(); scoringApi.sets(controller.signal).then(setSets, e => { if (!controller.signal.aborted) setError(message(e)); }); return () => controller.abort(); }, []);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Switching sets clears the previous set before its replacement arrives.
        setSetData(undefined);
        if (!view.setId) return;
        const controller = new AbortController();
        scoringApi.set(view.setId, controller.signal).then(data => {
            setSetData(data);
            setError(undefined);
            // Default to the first agent prefill unless the link chose one (or `prefill=` for none).
            const first = data.label_sets.find(entry => entry.read_only)?.name;
            if (first) updateView(state => state.prefill === undefined ? { ...state, prefill: first } : state, true);
        }, e => { if (!controller.signal.aborted) setError(message(e)); });
        return () => controller.abort();
    }, [view.setId, updateView]);
    const loadLabels = useCallback(async (signal?: AbortSignal) => {
        if (!view.setId || !reviewer) return;
        try { setLabels(await scoringApi.labels(view.setId, reviewer, signal)); }
        catch (e) { if (!signal?.aborted) setError(message(e)); }
    }, [view.setId, reviewer]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Reviewer or set changes invalidate the loaded labels.
        setLabels(undefined);
        const controller = new AbortController(); void loadLabels(controller.signal); return () => controller.abort();
    }, [loadLabels]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- A new prefill selection replaces the previous rows.
        setPrefill(undefined);
        if (!view.setId || !view.prefill || !isAgentLabelSet(view.prefill)) return;
        const controller = new AbortController();
        scoringApi.labels(view.setId, view.prefill, controller.signal).then(setPrefill, e => { if (!controller.signal.aborted) setError(message(e)); });
        return () => controller.abort();
    }, [view.setId, view.prefill]);

    const revealScope = view.setId && reviewer ? `${view.setId}/${reviewer}` : "";
    const revealed = revealedState?.key === revealScope ? revealedState.map : (view.setId && reviewer ? readRevealed(view.setId, reviewer) : {});
    const agentNames = setData?.label_sets.filter(entry => entry.read_only).map(entry => entry.name) ?? [];
    // Unknown prefill names from a link behave as "none" without rewriting the link.
    const prefillName = view.prefill && agentNames.includes(view.prefill) ? view.prefill : undefined;
    const items = setData?.items ?? [];
    const current = new Map((labels?.labels ?? []).map(row => [row.item_id, row]));
    const prefillRows = new Map(prefillName ? (prefill?.labels ?? []).map(row => [row.item_id, row]) : []);
    const pairs = [...new Set(items.map(entry => entry.pair))];
    const filtered = filterItems(items, view, current, prefillRows);
    const item = items.find(entry => entry.item_id === view.itemId) ?? filtered[0];
    const presentations = setData?.set.presentations.filter(p => item?.presentations[p.id]) ?? [];
    const presentation = presentations.find(p => p.id === view.presentation)?.id ?? presentations[0]?.id;
    const label = item ? current.get(item.item_id) : undefined;
    const agent = item ? prefillRows.get(item.item_id) : undefined;
    // The editable draft starts from the reviewer's current label, else from the selected prefill.
    const draftKey = `${item?.item_id}|${label?.updated_at ?? `prefill:${prefillName ?? ""}:${agent ? "y" : "n"}`}`;
    const base = { key: draftKey, choice: label?.choice ?? agent?.choice, reason: label?.reason ?? agent?.reason ?? "" };
    const draft = edits?.key === draftKey ? edits : base;
    const dirty = draft.choice !== base.choice || draft.reason !== base.reason || !label;
    const itemRevealed = item ? revealed[item.item_id] : undefined;
    const wasRevealed = Boolean(itemRevealed || label?.revealed);
    const position = item ? filtered.findIndex(entry => entry.item_id === item.item_id) : -1;

    const go = (delta: number) => {
        const next = filtered[Math.min(filtered.length - 1, Math.max(0, position < 0 ? 0 : position + delta))];
        if (next && next.item_id !== item?.item_id) { setSaveState({ status: "idle" }); updateView(state => ({ ...state, itemId: next.item_id })); }
    };
    const setChoice = (choice: ScoringChoice) => setEdits({ key: draftKey, choice, reason: draft.reason });
    const save = async () => {
        if (!item || !view.setId || !reviewer || draft.choice === undefined) return;
        setSaveState({ status: "saving" });
        try {
            const row = await scoringApi.save(view.setId, reviewer, { item_id: item.item_id, choice: draft.choice, reason: draft.reason, source: "human", revealed: wasRevealed, ...(prefillName ? { prefill: prefillName } : {}) });
            setLabels(currentLabels => currentLabels ? { ...currentLabels, row_count: currentLabels.row_count + 1, labels: [...currentLabels.labels.filter(entry => entry.item_id !== row.item_id), row] } : currentLabels);
            setEdits(undefined);
            setSaveState({ status: "saved", message: `Saved ${new Date(row.updated_at).toLocaleTimeString()}` });
        } catch (e) { setSaveState({ status: "error", message: message(e) }); }
    };
    const reveal = async () => {
        if (!item || !view.setId || !reviewer) return;
        if (!wasRevealed && !window.confirm("Reveal which candidate is the prediction? This is recorded on your next saved label for this item (revealed: true).")) return;
        try {
            const result = await scoringApi.reveal(view.setId, item.item_id, reviewer);
            const next = { ...readRevealed(view.setId, reviewer), [item.item_id]: result.blind_map };
            localStorage.setItem(revealedKey(view.setId, reviewer), JSON.stringify(next));
            setRevealed({ key: `${view.setId}/${reviewer}`, map: next });
        } catch (e) { setError(message(e)); }
    };

    // Shortcuts 1 / 2 / t choose, n / p move; ignored while typing or in the lightbox.
    const shortcuts: Record<string, () => void> = { "1": () => setChoice(1), "2": () => setChoice(2), t: () => setChoice("tie"), n: () => go(1), p: () => go(-1) };
    const shortcutRef = useRef(shortcuts);
    useEffect(() => { shortcutRef.current = item && !lightboxOpen ? shortcuts : {}; });
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("input, textarea, select, [contenteditable='true'], dialog")) return;
            const action = shortcutRef.current[event.key.toLowerCase()];
            if (action) { event.preventDefault(); action(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const chooseReviewer = (name: string) => { localStorage.setItem(REVIEWER_KEY, name); setReviewer(name); setEditingReviewer(false); };
    const presentationTitle = setData?.set.presentations.find(p => p.id === presentation)?.title ?? "";
    const record = item && presentation ? scoringRecord(item, presentation, presentationTitle) : undefined;
    const composite = Boolean(item && presentation && item.presentations[presentation]?.kind === "composite");
    const labelledCount = items.filter(entry => current.has(entry.item_id)).length;
    const blindText = (map: ScoringRevealResponse["blind_map"]) => `Candidate ${map.pred} is the prediction; candidate ${map.gt} is the ground truth.`;

    const shell = (body: React.ReactNode) => <div className="scoring-shell"><TopBar mode="scoring" homeHref="/"/>{body}</div>;
    if (!reviewer || editingReviewer)
        return shell(<main className="scoring-main centered"><ReviewerPrompt initial={reviewer} onSubmit={chooseReviewer} onCancel={reviewer ? () => setEditingReviewer(false) : undefined}/></main>);
    if (!view.setId)
        return shell(<main className="scoring-main"><div className="dataset-landing"><div className="landing-heading"><h2>Scoring</h2><p>Choose a scoring set. Reviewing as <strong>{reviewer}</strong> · <button type="button" className="link-button" onClick={() => setEditingReviewer(true)}>change</button></p></div>
            {error ? <div className="error-banner" role="alert"><strong>Scoring unavailable</strong><span>{error}</span></div> : null}
            <div className="results-summary">{sets ? `${sets.sets.length} scoring sets` : "Loading…"}</div>
            <div className="dataset-grid">{sets?.sets.map(set => <button key={set.id} className="dataset-card" onClick={() => updateView(state => ({ ...state, setId: set.id, itemId: undefined, prefill: undefined, pair: undefined, agreement: "all", status: "all" }))}><strong>{set.title}</strong><span>{set.item_count} items · {set.id}</span></button>)}</div>
            {sets && !sets.sets.length ? <div className="empty-state">No scoring sets are published.</div> : null}
            {sets?.diagnostics.length ? <div className="diagnostic-banner warning" role="status">{sets.diagnostics.map(d => <div key={d.set_id}>{d.set_id}: {d.message}</div>)}</div> : null}
        </div></main>);

    const agentSets = setData?.label_sets.filter(entry => entry.read_only) ?? [];
    return shell(<div className="scoring-layout">
        <aside className="scoring-sidebar" aria-label="Scoring items">
            <label>Set<select value={view.setId} onChange={event => updateView(state => ({ ...state, setId: event.target.value || undefined, itemId: undefined, prefill: undefined, pair: undefined, agreement: "all", status: "all" }))}>
                <option value="">Select set</option>{sets?.sets.map(set => <option key={set.id} value={set.id}>{set.title}</option>)}{sets && !sets.sets.some(set => set.id === view.setId) ? <option value={view.setId}>{view.setId}</option> : null}
            </select></label>
            <div className="scoring-reviewer">Reviewer <strong>{reviewer}</strong><button type="button" className="link-button" onClick={() => setEditingReviewer(true)}>change</button></div>
            <label>Prefill<select value={prefillName ?? ""} onChange={event => updateView(state => ({ ...state, prefill: event.target.value, agreement: event.target.value ? state.agreement : "all" }), true)}>
                <option value="">None</option>{agentSets.map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
            </select></label>
            <label>Pair<select value={view.pair ?? ""} onChange={event => updateView(state => ({ ...state, pair: event.target.value || undefined }), true)}><option value="">All pairs</option>{pairs.map(pair => <option key={pair}>{pair}</option>)}</select></label>
            <label>Status<select value={view.status} onChange={event => updateView(state => ({ ...state, status: event.target.value as ScoringViewState["status"] }), true)}><option value="all">All</option><option value="labelled">Labelled</option><option value="unlabelled">Unlabelled</option></select></label>
            <label>Agreement with prefill<select value={view.agreement} disabled={!prefillName} onChange={event => updateView(state => ({ ...state, agreement: event.target.value as ScoringViewState["agreement"] }), true)}><option value="all">All</option><option value="agree">Agrees</option><option value="disagree">Disagrees</option></select></label>
            <div className="scoring-progress" aria-live="polite"><strong>{labelledCount} / {items.length}</strong> labelled{filtered.length !== items.length ? ` · ${filtered.length} shown` : ""}</div>
            <a className="button-link" href={scoringApi.exportUrl(view.setId, reviewer)} download><Download size={16} aria-hidden="true"/>Export my labels</a>
            {labels?.invalid_rows ? <div className="diagnostic-banner warning" role="status">{labels.invalid_rows} unreadable label rows were skipped.</div> : null}
            <ol className="scoring-items">{filtered.map(entry => { const row = current.get(entry.item_id); const agentRow = prefillRows.get(entry.item_id); return <li key={entry.item_id}>
                <button type="button" aria-current={entry.item_id === item?.item_id ? "true" : undefined} onClick={() => { setSaveState({ status: "idle" }); updateView(state => ({ ...state, itemId: entry.item_id })); }}>
                    <span className="scoring-item-id">{entry.item_id}</span><small>{entry.pair}</small>
                    <span className={`scoring-badge${row ? " labelled" : ""}`}>{row ? choiceLabel(row.choice) : "—"}{row && agentRow ? (row.choice === agentRow.choice ? " ✓" : " ≠") : ""}</span>
                </button></li>; })}</ol>
            {setData && !filtered.length ? <p className="muted">No items match these filters.</p> : null}
        </aside>
        <main className="scoring-main">
            {error ? <div className="error-banner" role="alert"><strong>Scoring unavailable</strong><span>{error}</span><button onClick={() => { setError(undefined); void loadLabels(); }}>Retry</button></div> : null}
            {!setData && !error ? <div className="empty-state">Loading…</div> : null}
            {setData && !item ? <div className="empty-state"><h2>No item selected</h2><p>Adjust the filters to show items.</p></div> : null}
            {setData && item && record ? <article className="scoring-item" aria-label={`Item ${item.item_id}`}>
                <div className="scoring-item-header">
                    <div><h2>{item.item_id}</h2><span>{item.pair} · {item.task} · item {item.index} of {items.length}</span></div>
                    <div className="scoring-nav"><button type="button" onClick={() => go(-1)} disabled={position <= 0} aria-label="Previous item" title="Previous item (p)"><ChevronLeft size={16} aria-hidden="true"/></button><button type="button" onClick={() => go(1)} disabled={position < 0 || position >= filtered.length - 1} aria-label="Next item" title="Next item (n)"><ChevronRight size={16} aria-hidden="true"/></button></div>
                </div>
                {setData.set.instructions ? <details className="scoring-instructions"><summary>Instructions</summary><p>{setData.set.instructions}</p></details> : null}
                <section className="scoring-task"><h3>Task</h3><p className="exact-text">{item.task_text}</p></section>
                {presentations.length > 1 ? <div className="view-mode-control scoring-presentations" role="group" aria-label="Presentation">{presentations.map(p => <button key={p.id} type="button" aria-pressed={p.id === presentation} onClick={() => updateView(state => ({ ...state, presentation: p.id }), true)}>{p.title}</button>)}</div> : null}
                {composite ? <p className="muted scoring-composite-note">The composite canvas labels its halves Candidate 1 and Candidate 2.</p> : null}
                <MediaPanels record={record} onOpen={button => { focusReturn.current = button; setLightboxOpen(true); }}/>
                <div className="scoring-columns">
                    <section className="scoring-prefill" aria-label="Prefilled verdict"><h3>Prefill{prefillName ? ` · ${prefillName}` : ""}</h3>
                        {!prefillName ? <p className="muted">No prefill selected.</p> : agent ? <><p><strong>{choiceLabel(agent.choice)}</strong>{agent.confidence !== undefined ? <span className="muted"> · confidence {agent.confidence.toFixed(2)}</span> : null}</p><p className="exact-text">{agent.reason || <span className="muted">(no reason)</span>}</p><Regions row={agent}/></> : <p className="muted">{prefill ? "No prefilled verdict for this item." : "Loading…"}</p>}
                    </section>
                    <form className="scoring-form" aria-label="Your label" onSubmit={event => { event.preventDefault(); void save(); }}>
                        <h3>Your label</h3>
                        <fieldset><legend>Which candidate better annotates the target?</legend><div className="view-mode-control scoring-choice">
                            {([1, 2, "tie"] as const).map(choice => <button key={String(choice)} type="button" aria-pressed={draft.choice === choice} onClick={() => setChoice(choice)} title={`Shortcut ${choice === "tie" ? "t" : choice}`}>{choiceLabel(choice)}</button>)}
                        </div></fieldset>
                        <label>Reason<textarea ref={reasonRef} rows={4} maxLength={4000} value={draft.reason} onChange={event => setEdits({ key: draftKey, choice: draft.choice, reason: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); } }}/></label>
                        <div className="scoring-save"><button type="submit" className="primary" disabled={draft.choice === undefined || saveState.status === "saving"}>Save</button>
                            <span className="muted" role="status">{saveState.status === "saving" ? "Saving…" : saveState.status === "error" ? <span className="error-text">{saveState.message}</span> : saveState.status === "saved" && !dirty ? saveState.message : label ? (dirty ? "Unsaved changes" : `Saved ${new Date(label.updated_at).toLocaleString()}`) : agent ? "Prefilled — not saved yet" : "Not labelled"}</span></div>
                    </form>
                </div>
                <section className="scoring-reveal"><button type="button" onClick={() => void reveal()}><Eye size={16} aria-hidden="true"/>{itemRevealed ? "Revealed" : wasRevealed ? "Show reveal again" : "Reveal"}</button>
                    {itemRevealed ? <span>{blindText(itemRevealed)}</span> : wasRevealed ? <span className="muted">Revealed earlier.</span> : <span className="muted">Shows which candidate is the prediction; recorded on your label.</span>}</section>
            </article> : null}
        </main>
        <Lightbox selection={lightboxOpen && record && item ? { taskTitle: item.pair, sourceTitle: item.task, expTitle: presentationTitle, record } : undefined}
            onClose={() => { setLightboxOpen(false); window.setTimeout(() => focusReturn.current?.focus(), 0); }}
            details={item ? <div className="scoring-lightbox-details"><h3>Task</h3><p className="exact-text">{item.task_text}</p>{agent ? <><h3>Prefill · {prefillName}</h3><p><strong>{choiceLabel(agent.choice)}</strong></p><p className="exact-text">{agent.reason}</p><Regions row={agent}/></> : null}{draft.choice !== undefined ? <><h3>Your choice</h3><p>{choiceLabel(draft.choice)}</p></> : null}</div> : null}/>
    </div>);
}

