import type { SampleView } from "../shared/contracts.js";
import { isAgentLabelSet, reviewerPattern, type ScoringItemView, type ScoringLabelRow, type ScoringRevealResponse } from "../shared/scoring.js";
import type { ScoringViewState } from "./scoringUrlState.js";

export const REVIEWER_KEY = "covis.reviewer";
const REVIEWER = new RegExp(reviewerPattern);
const ROLE_TITLES = { original: "Original", candidate_1: "Candidate 1", candidate_2: "Candidate 2" } as const;
export const revealedKey = (setId: string, reviewer: string) => `covis.revealed.${setId}.${reviewer}`;

/** Human reviewer names: the server pattern, minus the reserved read-only `agent-` prefix. */
export function validReviewerName(name: string) { return REVIEWER.test(name) && !isAgentLabelSet(name); }
export function readReviewer() {
    try { const value = localStorage.getItem(REVIEWER_KEY) ?? ""; return validReviewerName(value) ? value : undefined; } catch { return undefined; }
}
export function readRevealed(setId: string, reviewer: string): Record<string, ScoringRevealResponse["blind_map"]> {
    try { return JSON.parse(localStorage.getItem(revealedKey(setId, reviewer)) ?? "{}"); } catch { return {}; }
}

/**
 * Build a SampleView so the existing media panels and lightbox are reused unchanged.
 * Composite presentations show the original plus the canvases that contain both candidates.
 */
export function scoringRecord(item: ScoringItemView, presentation: string, presentationTitle = "Composite"): SampleView {
    const media = item.presentations[presentation];
    const available = (id: string, title: string, view: { url: string; thumbnail_url: string }) => ({ id, title, status: "available" as const, url: view.url, thumbnail_url: view.thumbnail_url });
    const panels = !media
        ? (["original", "candidate_1", "candidate_2"] as const).map(role => ({ id: role, title: ROLE_TITLES[role], status: "missing" as const, unavailable_reason: "Presentation unavailable for this item" }))
        : media.kind === "composite"
            ? [available("original", ROLE_TITLES.original, media.original), ...media.views.map((view, index) => available(`view_${index + 1}`, media.views.length > 1 ? `${presentationTitle} ${index + 1}` : presentationTitle, view))]
            : (["original", "candidate_1", "candidate_2"] as const).map(role => available(role, ROLE_TITLES[role], media[role]));
    return { sample_id: item.item_id, index: item.index, input_text: item.task_text, pred_text: null, gt_text: null, metadata: {}, panels };
}

/** Pair, labelled/unlabelled and agree/disagree-with-prefill filters; agreement needs both labels. */
export function filterItems(items: ScoringItemView[], view: Pick<ScoringViewState, "pair" | "status" | "agreement">, current: Map<string, ScoringLabelRow>, prefill: Map<string, ScoringLabelRow>) {
    return items.filter(item => {
        if (view.pair && item.pair !== view.pair) return false;
        const label = current.get(item.item_id);
        if (view.status === "labelled" && !label) return false;
        if (view.status === "unlabelled" && label) return false;
        if (view.agreement !== "all") {
            const agent = prefill.get(item.item_id);
            if (!label || !agent) return false;
            if ((label.choice === agent.choice) !== (view.agreement === "agree")) return false;
        }
        return true;
    });
}
