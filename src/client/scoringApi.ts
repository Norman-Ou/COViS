import type { ScoringLabelInput, ScoringLabelRow, ScoringLabelsResponse, ScoringRevealResponse, ScoringSetResponse, ScoringSetsResponse } from "../shared/scoring.js";
import { json } from "./api.js";

const enc = encodeURIComponent;
const post = <T>(url: string, body: unknown) => json<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export const scoringApi = {
    sets: (signal?: AbortSignal) => json<ScoringSetsResponse>("/api/scoring/sets", { signal }),
    set: (setId: string, signal?: AbortSignal) => json<ScoringSetResponse>(`/api/scoring/sets/${enc(setId)}`, { signal }),
    labels: (setId: string, reviewer: string, signal?: AbortSignal) => json<ScoringLabelsResponse>(`/api/scoring/sets/${enc(setId)}/labels/${enc(reviewer)}`, { signal }),
    save: (setId: string, reviewer: string, label: ScoringLabelInput) => post<ScoringLabelRow>(`/api/scoring/sets/${enc(setId)}/labels/${enc(reviewer)}`, label),
    reveal: (setId: string, itemId: string, reviewer: string) => post<ScoringRevealResponse>(`/api/scoring/sets/${enc(setId)}/items/${enc(itemId)}/reveal`, { reviewer }),
    exportUrl: (setId: string, reviewer: string) => `/api/scoring/sets/${enc(setId)}/labels/${enc(reviewer)}/export`
};
