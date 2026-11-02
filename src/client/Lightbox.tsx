import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SampleView } from "../shared/contracts.js";
import { sampleIdentity } from "../shared/sampleIdentity.js";
import { JsonInspector } from "./JsonInspector.js";
import { MediaPanel, MediaPanels } from "./MediaPanels.js";
import { SampleText, type TextDisplay } from "./SampleText.js";
type Selection = {
    taskTitle: string;
    sourceTitle: string;
    expTitle: string;
    record: SampleView;
};
export function Lightbox({ selection, onClose, generation = 0, textDisplay, details }: {
    selection?: Selection;
    onClose: () => void;
    generation?: number;
    textDisplay?: TextDisplay;
    /** Replaces the default text and JSON details (used by Scoring to keep candidates blind). */
    details?: ReactNode;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const startedOutside = useRef(false);
    const focusedPanel = useRef<HTMLDivElement>(null);
    const zoomTrigger = useRef<HTMLButtonElement | undefined>(undefined);
    const [zoom, setZoom] = useState<{ record: SampleView; panelId: string }>();
    const expandedPanel = zoom?.record === selection?.record ? selection?.record.panels.find(panel => panel.id === zoom?.panelId && panel.status === "available") : undefined;
    const closeZoom = () => { setZoom(undefined); window.setTimeout(() => zoomTrigger.current?.focus(), 0); };
    useEffect(() => { if (expandedPanel) focusedPanel.current?.focus(); }, [expandedPanel]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Closing or replacing the record clears its transient single-image view.
        setZoom(current => current?.record === selection?.record ? current : undefined);
    }, [selection?.record]);
    useEffect(() => { const element = dialog.current; if (!element)
        return; if (selection && !element.open)
        element.showModal(); if (!selection && element.open)
        element.close(); }, [selection]);
    if (!selection)
        return <dialog ref={dialog}/>;
    const { record, taskTitle, sourceTitle, expTitle } = selection;
    const identity = sampleIdentity(record);
    const outside = (element: HTMLElement, x: number, y: number) => { const bounds = element.getBoundingClientRect(); return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom; };
    const boundary = () => expandedPanel && focusedPanel.current ? focusedPanel.current : dialog.current;
    return <dialog ref={dialog} className="lightbox" tabIndex={-1} aria-label={`${taskTitle} · ${sourceTitle} · ${expTitle} · sample ${identity.displayId}`} onCancel={(event) => { event.preventDefault(); if (expandedPanel) closeZoom(); else onClose(); }} onClose={onClose} onPointerDownCapture={event => { const element = boundary(); startedOutside.current = Boolean(element && outside(element, event.clientX, event.clientY)); }}
    // WebKit can omit the next pointerdown after dragging a native image.
    onMouseDownCapture={event => { const element = boundary(); startedOutside.current = Boolean(element && outside(element, event.clientX, event.clientY)); }} onPointerCancel={() => { startedOutside.current = false; }} onClickCapture={event => {
        const element = boundary();
        if (startedOutside.current && element && outside(element, event.clientX, event.clientY)) {
            if (expandedPanel) { event.preventDefault(); event.stopPropagation(); closeZoom(); }
            else onClose();
        }
        startedOutside.current = false;
    }}>
    <div className="lightbox-layout"><div className="lightbox-image-wrap">
      <div className={`grouped-images${expandedPanel ? ' zoom-active' : ''}`} aria-hidden={expandedPanel ? true : undefined} inert={Boolean(expandedPanel)}><MediaPanels record={record} generation={generation} onZoom={(panel, button) => { zoomTrigger.current = button; setZoom({ record, panelId: panel.id }); }}/></div>
      {expandedPanel ? <div className="focused-image-layer"><div ref={focusedPanel} className="focused-panel" role="region" aria-label={`${expandedPanel.title} enlarged image`} tabIndex={-1}><MediaPanel key={`${generation}:${expandedPanel.id}:${expandedPanel.url}`} panel={expandedPanel} record={record} expanded/></div></div> : null}
    </div>
      <aside className="details-panel" aria-label="Record details"><div className="record-identity"><strong>{taskTitle}</strong><span>{sourceTitle}</span><span>{expTitle}</span><span>{identity.sourceId !== undefined ? 'Source ID' : 'Sample ID'} {identity.displayId}</span>{identity.sourceSplit ? <span>Split: {identity.sourceSplit}</span> : null}</div>
        {details ?? <><SampleText record={record} textDisplay={textDisplay}/>
        <p>Panels: {record.panels.map(panel => panel.title).join(" | ")}</p><JsonInspector record={record}/></>}</aside></div>
  </dialog>;
}
