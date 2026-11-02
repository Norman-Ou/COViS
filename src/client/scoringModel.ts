import type { SampleView } from "../shared/contracts.js";
import { isAgentLabelSet, reviewerPattern, type ScoringCandidateText, type ScoringItemView, type ScoringLabelRow, type ScoringRevealResponse } from "../shared/scoring.js";
import type { ScoringViewState } from "./scoringUrlState.js";

export const REVIEWER_KEY = "covis.reviewer";
const REVIEWER = new RegExp(reviewerPattern);
type BlindMap = ScoringRevealResponse["blind_map"];
/** "Candidate n", or "Candidate n · GT / Prediction" when Real mode has the item's reveal. */
export const candidateTitle = (candidate: 1 | 2, roles?: BlindMap) => `Candidate ${candidate}${roles ? ` · ${roles.gt === candidate ? "GT" : "Prediction"}` : ""}`;
export const revealedKey = (setId: string, reviewer: string) => `covis.revealed.${setId}.${reviewer}`;

type Rgb = ScoringCandidateText["phrases"][number]["rgb"];
export type CaptionSegment = { text: string; phrase?: ScoringCandidateText["phrases"][number] };
/** Split a grounded caption into text and `[phrase]` chips; brackets naming no declared phrase stay plain text. */
export function captionSegments({ caption, phrases }: ScoringCandidateText): CaptionSegment[] {
    const byName = new Map(phrases.map(phrase => [phrase.name, phrase]));
    const segments: CaptionSegment[] = [];
    let last = 0;
    for (const match of caption.matchAll(/\[([^[\]]+)\]/g)) {
        const phrase = byName.get(match[1]!);
        if (!phrase) continue;
        if (match.index > last) segments.push({ text: caption.slice(last, match.index) });
        segments.push({ text: phrase.name, phrase });
        last = match.index + match[0].length;
    }
    if (last < caption.length) segments.push({ text: caption.slice(last) });
    return segments;
}
/** CSS colours for a phrase chip: its rgb background with black or white text by relative luminance. */
export function phraseColors([r, g, b]: Rgb) {
    const linear = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: luminance > 0.179 ? "#000" : "#fff" };
}

/** Human reviewer names: the server pattern, minus the reserved read-only `agent-` prefix. */
export function validReviewerName(name: string) { return REVIEWER.test(name) && !isAgentLabelSet(name); }
export function readReviewer() {
    try { const value = localStorage.getItem(REVIEWER_KEY) ?? ""; return validReviewerName(value) ? value : undefined; } catch { return undefined; }
}
export function readRevealed(setId: string, reviewer: string): Record<string, BlindMap> {
    try { return JSON.parse(localStorage.getItem(revealedKey(setId, reviewer)) ?? "{}"); } catch { return {}; }
}

/**
 * Build a SampleView so the existing media panels and lightbox are reused unchanged.
 * Composite presentations show the original plus the canvases that contain both candidates.
 * `roles` (Real mode, revealed items only) names the candidate panels GT / Prediction.
 */
export function scoringRecord(item: ScoringItemView, presentation: string, presentationTitle = "Composite", roles?: BlindMap): SampleView {
    const roleTitle = (role: "original" | "candidate_1" | "candidate_2") => role === "original" ? "Original" : candidateTitle(role === "candidate_1" ? 1 : 2, roles);
    const media = item.presentations[presentation];
    const available = (id: string, title: string, view: { url: string; thumbnail_url: string }) => ({ id, title, status: "available" as const, url: view.url, thumbnail_url: view.thumbnail_url });
    const panels = !media
        ? (["original", "candidate_1", "candidate_2"] as const).map(role => ({ id: role, title: roleTitle(role), status: "missing" as const, unavailable_reason: "Presentation unavailable for this item" }))
        : media.kind === "composite"
            ? [available("original", "Original", media.original), ...media.views.map((view, index) => available(`view_${index + 1}`, media.views.length > 1 ? `${presentationTitle} ${index + 1}` : presentationTitle, view))]
            : (["original", "candidate_1", "candidate_2"] as const).map(role => available(role, roleTitle(role), media[role]));
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
