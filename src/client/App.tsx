import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, X } from "lucide-react";
import type { CatalogResponse, Task, SampleView } from "../shared/contracts.js";
import { alignRows, filterRows } from "../shared/order.js";
import { sampleIdentity } from "../shared/sampleIdentity.js";
import { matchesDatasetSearch } from "./datasetSearch.js";
import { api } from "./api.js";
import { Lightbox } from "./Lightbox.js";
import { SortableColumnHeader } from "./SortableColumnHeader.js";
import { activeParts, canonicalViewState, parseViewState, serializeViewState, tupleParts, type ViewState } from "./urlState.js";
import { SampleText, type TextDisplay } from "./SampleText.js";
import { TaskBrowser } from "./TaskBrowser.js";
import { ColumnTitle } from "./ColumnTitle.js";
import { MediaPanels } from "./MediaPanels.js";
import { buildBrowseTree, type ExperimentSelection } from "./browseTree.js";
import { SelectionMenu } from "./SelectionMenu.js";
import { useExperimentColumns } from './useExperimentColumns.js';
import { TopBar } from './TopBar.js';
type Pair = ExperimentSelection;
function RecordCell({ record, onOpen, generation, textDisplay }: {
    record?: SampleView;
    onOpen: (button: HTMLButtonElement) => void;
    generation: number;
    textDisplay: TextDisplay;
}) {
    if (!record)
        return <div className="record-cell missing"><strong>No record</strong><span>This experiment has no record for this sample.</span></div>;
    const identity = sampleIdentity(record);
    return <article className="record-cell"><div className="sample-meta"><strong title={`${identity.sourceId !== undefined ? 'Source ID' : 'Sample ID'}: ${identity.displayId}`}>{identity.displayId}</strong>{identity.sourceSplit ? <span>Split: {identity.sourceSplit}</span> : null}</div>
    <MediaPanels record={record} onOpen={onOpen} generation={generation}/>
    <SampleText record={record} textDisplay={textDisplay}/>
  </article>;
}
export function App() {
    const [view, setView] = useState<ViewState>(() => parseViewState(window.location.search));
    const [queryInput, setQueryInput] = useState(view.query);
    const [datasetSearch, setDatasetSearch] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerSearch, setPickerSearch] = useState("");
    const [catalog, setCatalog] = useState<CatalogResponse>();
    const [catalogError, setCatalogError] = useState<string>();
    const [mediaGeneration, setMediaGeneration] = useState(0);
    const [textDisplay, setTextDisplay] = useState<TextDisplay>({ expanded: true, generation: 0 });
    const [reloading, setReloading] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("t2i.sidebar.collapsed") === "true");
    const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(480, Math.max(240, Number(localStorage.getItem("t2i.sidebar.width")) || 320)));
    const focusReturn = useRef<HTMLElement | undefined>(undefined);
    const pickerRef = useRef<HTMLDivElement>(null);
    const pickerToggle = useRef<HTMLButtonElement>(null);
    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const selectedKeys = view.columns;
    const { columns, retry: retryColumn } = useExperimentColumns(catalog ? view.datasetId : undefined, selectedKeys, catalog);
    const updateView = useCallback((updater: ViewState | ((current: ViewState) => ViewState), replace = false) => {
        setView((current) => { const next = typeof updater === "function" ? updater(current) : updater; window.history[replace ? "replaceState" : "pushState"]({}, "", `${window.location.pathname}${serializeViewState(next)}`); return next; });
    }, []);
    useEffect(() => { const onPop = () => { const state = parseViewState(window.location.search); window.history.replaceState({}, "", `${window.location.pathname}${serializeViewState(state)}`); setView(state); setQueryInput(state.query); }; window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
    useEffect(() => { window.history.replaceState({}, "", `${window.location.pathname}${serializeViewState(parseViewState(window.location.search))}`); }, []);
    const loadCatalog = useCallback(async () => { try {
        setCatalog(await api.catalog());
        setCatalogError(undefined);
    }
    catch (error) {
        setCatalogError(error instanceof Error ? error.message : String(error));
    } }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Catalog state changes only after the asynchronous request settles.
    useEffect(() => { void loadCatalog(); }, [loadCatalog]);
    useEffect(() => {
        if (!pickerOpen) return;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !pickerRef.current?.contains(event.target) && !pickerToggle.current?.contains(event.target)) setPickerOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); setPickerOpen(false); pickerToggle.current?.focus(); }
        };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
    }, [pickerOpen]);
    const dataset = catalog?.collections.find((item) => item.id === view.datasetId);
    const tasks = useMemo<Task[]>(() => dataset?.tasks.map((task) => ({ ...task,
        title: task.title.split(/[_\s]+/).map((word) => /^(gcg|vgd)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    })) ?? [], [dataset]);
    const pairs = useMemo<Pair[]>(() => tasks.flatMap(task => task.datasets.flatMap(dataset => dataset.exps.map(exp => ({ task, dataset, exp })))), [tasks]);
    const browseItems = useMemo(() => buildBrowseTree(tasks, view.mode), [tasks, view.mode]);
    const pairFor = (key: string) => { const tuple = tupleParts(key); return tuple ? pairs.find(({ task, dataset, exp }) => task.id === tuple.taskId && dataset.id === tuple.datasetId && exp.id === tuple.expId) : undefined; };
    useEffect(() => {
        if (!catalog)
            return;
        const canonical = canonicalViewState(view, catalog.collections);
        if (canonical !== view) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve legacy links while normalizing collection identity.
            updateView(canonical, true);
            return;
        }
        const selected = catalog.collections.find(item => item.id === view.datasetId);
        const filtered = view.columns.filter(key => {
            const tuple = tupleParts(key);
            return tuple && selected?.tasks.find(task => task.id === tuple.taskId)?.datasets.find(source => source.id === tuple.datasetId)?.exps.some(exp => exp.id === tuple.expId);
        });
        const linkedCell = activeParts(view.active);
        const active = linkedCell && filtered.includes(linkedCell.key) ? view.active : undefined;
        if (filtered.length !== view.columns.length || Boolean(view.datasetId && !selected) || active !== view.active)
            updateView({ ...view, datasetId: selected?.id, columns: filtered, active, notice: "An unavailable dataset, experiment or record was removed from the link." }, true);
    }, [catalog, updateView, view]);
    useEffect(() => { const timer = window.setTimeout(() => { if (queryInput !== view.query)
        updateView({ ...view, query: queryInput.trim(), page: 1 }, true); }, 300); return () => window.clearTimeout(timer); }, [queryInput, updateView, view]);
    const orderedColumns = selectedKeys.map(key => ({ ...(columns.get(key) ?? { key, loading: true }), expOrder: pairFor(key)?.dataset.exps.findIndex(exp => exp.id === pairFor(key)?.exp.id) }));
    const aligned = alignRows(orderedColumns);
    const filtered = filterRows(aligned, view.query, selectedKeys.flatMap((key) => { const pair = pairFor(key); return pair ? [pair.task.id, pair.task.title, pair.dataset.title, pair.exp.title] : []; }));
    const ordered = filtered;
    const pageCount = Math.max(1, Math.ceil(ordered.length / view.pageSize));
    const rowsReady = orderedColumns.every(column => !column.loading);
    const page = rowsReady ? Math.min(view.page, pageCount) : view.page;
    const visibleRows = ordered.slice((page - 1) * view.pageSize, page * view.pageSize);
    useEffect(() => { if (view.page !== page)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- A completed experiment response may invalidate the linked page number.
        updateView({ ...view, page }, true); }, [page, updateView, view]);
    const active = activeParts(view.active);
    const activeColumn = active ? columns.get(active.key)?.data : undefined;
    const activeRecord = activeColumn?.records.find((record) => record.sample_id === active?.sampleId);
    const activePair = active ? pairFor(active.key) : undefined;
    const selection = activeRecord && activePair ? { taskTitle: activePair.task.title, sourceTitle: activePair.dataset.title, expTitle: activePair.exp.title, record: activeRecord } : undefined;
    const closeLightbox = () => { if (!view.active)
        return; updateView({ ...view, active: undefined }, true); window.setTimeout(() => focusReturn.current?.focus(), 0); };
    const reorder = (from: number, to: number) => { if (to < 0 || to >= view.columns.length || from === to)
        return; const next = [...view.columns]; const [item] = next.splice(from, 1); if (!item)
        return; next.splice(to, 0, item); updateView({ ...view, columns: next }); };
    const onDragEnd = ({ active: dragged, over }: DragEndEvent) => { if (over && dragged.id !== over.id)
        reorder(view.columns.indexOf(String(dragged.id)), view.columns.indexOf(String(over.id))); };
    const addPair = (pair: Pair) => { const token = crypto.randomUUID().slice(0, 8); updateView({ ...view, columns: [...view.columns, `${pair.task.id}:${pair.dataset.id}:${pair.exp.id}:${token}`], page: 1 }); setPickerOpen(false); };
    const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); const start = event.clientX; const initial = sidebarWidth; const move = (next: PointerEvent) => setSidebarWidth(Math.min(480, Math.max(240, initial + next.clientX - start))); const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); };
    useEffect(() => localStorage.setItem("t2i.sidebar.width", String(sidebarWidth)), [sidebarWidth]);
    useEffect(() => localStorage.setItem("t2i.sidebar.collapsed", String(sidebarCollapsed)), [sidebarCollapsed]);
    const visibleDatasets = catalog?.collections.filter((item) => matchesDatasetSearch(item, datasetSearch)) ?? [];
    const homeView: ViewState = { mode: view.mode, pageSize: view.pageSize, columns: [], query: "", page: 1 };
    const goHome = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        setQueryInput("");
        setDatasetSearch("");
        setPickerOpen(false);
        setPickerSearch("");
        updateView(homeView);
        window.scrollTo(0, 0);
    };
    const reloadData = async () => { setReloading(true); try {
        setCatalog(await api.reload());
        setMediaGeneration(value => value + 1);
        setCatalogError(undefined);
    }
    catch (error) {
        setCatalogError(error instanceof Error ? error.message : String(error));
    }
    finally {
        setReloading(false);
    } };
    return <div className={`app-shell${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`} style={{ "--sidebar-width": sidebarCollapsed ? "44px" : `${sidebarWidth}px` } as React.CSSProperties}>
    <TopBar mode="explorer" homeHref={`${window.location.pathname}${serializeViewState(homeView)}`} onHome={goHome}/>
    <aside id="explorer-sidebar" className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Explorer navigation">
      <div className="sidebar-header"><button type="button" className="sidebar-toggle icon-button" onClick={() => { setSidebarCollapsed(!sidebarCollapsed); setPickerOpen(false); }} aria-label={sidebarCollapsed ? "Show navigation" : "Hide navigation"} title={sidebarCollapsed ? "Show navigation" : "Hide navigation"} aria-expanded={!sidebarCollapsed} aria-controls="sidebar-controls">{sidebarCollapsed ? <ChevronRight size={20} aria-hidden="true"/> : <ChevronLeft size={20} aria-hidden="true"/>}</button></div>
      <div id="sidebar-controls" className="sidebar-body" hidden={sidebarCollapsed}>{!sidebarCollapsed ? <>
      <label className="dataset-selector">Dataset<select value={view.datasetId ?? ""} onChange={(event) => { setQueryInput(""); setPickerOpen(false); updateView({ ...view, datasetId: event.target.value || undefined, columns: [], query: "", page: 1, active: undefined }); }}><option value="">Select Dataset</option>{catalog?.collections.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <fieldset className="view-mode-selector"><legend>View by</legend><div className="view-mode-control">{(["task", "exp"] as const).map(mode => <button key={mode} aria-pressed={view.mode === mode} onClick={() => { setPickerOpen(false); setPickerSearch(""); updateView({ ...view, mode }); }}>{mode === "task" ? "Task" : "Exp"}</button>)}</div></fieldset>
      <label className="sample-search">Search examples<input type="search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Text, source ID, task…" disabled={!dataset}/></label>
      <div className="selected-title"><strong>Selected columns <span>{view.columns.length}</span></strong><button ref={pickerToggle} aria-label="Add column" aria-expanded={pickerOpen} disabled={!dataset} onClick={() => { setPickerOpen((open) => !open); }}>+</button></div>
      {pickerOpen && dataset ? <div ref={pickerRef} className="picker"><label>Find task, dataset or experiment<input autoFocus type="search" value={pickerSearch} onChange={event => setPickerSearch(event.target.value)}/></label>
        <SelectionMenu key={view.mode} items={browseItems} query={pickerSearch} inline onNavigate={() => setPickerSearch("")} onSelect={addPair}/>
      </div> : null}
      <div className="selected-list">{view.columns.map((key, index) => { const pair = pairFor(key); return <div className="selected-card" key={key}><ColumnTitle task={pair?.task.title ?? key} source={pair?.dataset.title ?? ""} experiment={pair?.exp.title ?? ""} origin={pair?.dataset.data_origin}/><div className="selected-actions"><button disabled={index === 0} onClick={() => reorder(index, index - 1)} aria-label={`Move selected column ${index + 1} up`}>↑</button><button disabled={index === view.columns.length - 1} onClick={() => reorder(index, index + 1)} aria-label={`Move selected column ${index + 1} down`}>↓</button><button onClick={() => updateView({ ...view, columns: view.columns.filter((item) => item !== key), active: view.active?.startsWith(`${key}:`) ? undefined : view.active })} aria-label={`Remove selected column ${index + 1}`}>×</button></div></div>; })}</div>
      <label className="page-size-control">Page size<select value={view.pageSize} onChange={(event) => updateView({ ...view, pageSize: Number(event.target.value) as ViewState["pageSize"], page: 1 })}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label>
      </> : null}</div>
      <div className="sidebar-footer"><button type="button" className={`reload-data icon-button${reloading ? " reloading" : ""}`} disabled={reloading} aria-label="Reload data" aria-busy={reloading} title={reloading ? "Reloading…" : "Reload data"} onClick={() => void reloadData()}><RefreshCw size={18} aria-hidden="true"/></button></div>
    </aside>
    {!sidebarCollapsed ? <nav aria-label="Navigation resize" className="sidebar-resizer-holder"><div className="sidebar-resizer" role="separator" aria-label="Resize navigation" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={resizeSidebar} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth((width) => Math.min(480, Math.max(240, width + (event.key === "ArrowLeft" ? -16 : 16))));
    } }}/></nav> : null}
    <main className="main-content">{view.notice ? <div className="notice" role="status">{view.notice}</div> : null}{catalogError ? <div className="error-banner" role="alert"><strong>Catalog unavailable</strong><span>{catalogError}</span><button onClick={() => void loadCatalog()}>Retry</button></div> : null}
      {!dataset ? <div className="dataset-landing"><div className="landing-heading"><h2>COViS</h2><p>Select a dataset to explore its tasks, experiments, and review examples.</p></div><div className="dataset-search"><input aria-label="Search datasets" type="search" value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} placeholder="Search by name"/></div><div className="results-summary">{visibleDatasets.length} datasets</div><div className="dataset-grid">{visibleDatasets.map((item) => <button className="dataset-card" key={item.id} onClick={() => updateView({ ...view, datasetId: item.id, columns: [], active: undefined })}><strong>{item.title}</strong></button>)}</div>{catalog && !visibleDatasets.length ? <div className="empty-state">No published datasets match this search.</div> : null}</div> : <>
        <TaskBrowser key={`${dataset.id}:${view.mode}`} items={browseItems} onSelect={addPair}/>
        {!view.columns.length ? <div className="empty-state"><h2>Build a comparison</h2><p>Choose a task, dataset and experiment, or add a column with +.</p></div> : <><div className="results-summary comparison-summary"><span aria-live="polite">{ordered.length} comparison rows · page {page} of {pageCount}</span>
          <div className="comparison-actions" role="group" aria-label="实验与文本操作">
            <button type="button" onClick={() => setTextDisplay(current => ({ expanded: !current.expanded, generation: current.generation + 1 }))}>
              {textDisplay.expanded ? <ChevronUp size={16} aria-hidden="true"/> : <ChevronDown size={16} aria-hidden="true"/>}{textDisplay.expanded ? "收起全部文本" : "展开全部文本"}
            </button>
            <button type="button" onClick={() => { setPickerOpen(false); setPickerSearch(""); updateView(current => ({ ...current, columns: [], active: undefined, page: 1 })); }}><X size={16} aria-hidden="true"/>清空实验</button>
          </div>
        </div>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}><SortableContext items={view.columns} strategy={horizontalListSortingStrategy}><div className="comparison-scroll"><div className="comparison-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, view.columns.length)}, minmax(360px, 1fr))` }}>
            {view.columns.map((key, index) => { const pair = pairFor(key); const column = columns.get(key); return <SortableColumnHeader key={key} id={key} label={pair?.task.title ?? key} sourceTitle={pair?.dataset.title ?? ""} expTitle={pair?.exp.title ?? ""} origin={pair?.dataset.data_origin} index={index} total={view.columns.length} status={column?.loading ? "loading" : column?.error ? "error" : undefined} error={column?.error} onRetry={() => retryColumn(key)} onMove={(delta) => reorder(index, index + delta)} onRemove={() => updateView({ ...view, columns: view.columns.filter((item) => item !== key), active: view.active?.startsWith(`${key}:`) ? undefined : view.active })}/>; })}
            {visibleRows.flatMap(row => view.columns.map(key => {
                    const column = columns.get(key);
                    const record = row.records.get(key);
                    if (column?.loading)
                        return <div key={`${key}-${row.sampleIndex}`} className="record-cell loading" aria-busy="true">Loading…</div>;
                    if (column?.error)
                        return <div key={`${key}-${row.sampleIndex}`} className="record-cell dataset-error"><strong>Experiment unavailable</strong><span>{column.error}</span></div>;
                    return <RecordCell key={`${key}-${row.sampleIndex}`} record={record} generation={mediaGeneration} textDisplay={textDisplay} onOpen={button => {
                            if (!record)
                                return;
                            focusReturn.current = button;
                            updateView({ ...view, active: `${key}:${record.sample_id}` }, true);
                        }}/>;
                }))}</div></div></SortableContext></DndContext>
          <nav className="pagination" aria-label="Pagination"><button disabled={page <= 1} onClick={() => updateView({ ...view, page: page - 1 })}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page >= pageCount} onClick={() => updateView({ ...view, page: page + 1 })}>Next</button></nav></>}
      </>}
      {view.active && !selection && orderedColumns.every((column) => !column.loading) ? <div className="notice" role="status">The linked record or image is unavailable. <button onClick={() => updateView({ ...view, active: undefined }, true)}>Dismiss</button></div> : null}
    </main><Lightbox selection={selection} onClose={closeLightbox} generation={mediaGeneration} textDisplay={textDisplay}/>
  </div>;
}
