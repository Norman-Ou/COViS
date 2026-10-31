import { idPattern, type JsonObject } from './contracts.js';

/** Scoring mode: blind pairwise review of two candidate annotations per item. */
export const SCORING_ROLES = ['original', 'candidate_1', 'candidate_2'] as const;
export type ScoringRole = typeof SCORING_ROLES[number];
export const MAX_COMPOSITE_VIEWS = 8;
/** Either per-candidate images, or a composite: candidates null plus `views` canvases that show both. */
export type ScoringPresentationAssets =
    | { original: string; candidate_1: string; candidate_2: string; views?: undefined }
    | { original: string; candidate_1: null; candidate_2: null; views: string[] };
export type ScoringChoice = 1 | 2 | 'tie';
export const reviewerPattern = '^[A-Za-z0-9_-]{1,32}$';
/** Label sets whose name starts with `agent-` are read-only prefill sources. */
export const isAgentLabelSet = (name: string) => /^agent-/i.test(name);

export type ScoringSetManifest = {
    schema_version: 1;
    id: string;
    title: string;
    description?: string;
    source: { cohort: string; round?: string | null; [key: string]: unknown };
    blind_seed: number;
    instructions: string;
    presentations: Array<{ id: string; title: string }>;
    created_at?: string;
};
export type ScoringItemRecord = {
    item_id: string;
    pair: string;
    task: string;
    task_text: string;
    presentations: Record<string, ScoringPresentationAssets>;
    blind_map: { pred: 1 | 2; gt: 1 | 2 };
    metadata?: JsonObject;
};
export type ScoringRegion = { window_id: string; present: 'yes' | 'no' | 'unsure'; note?: string };
export type ScoringLabelRow = {
    item_id: string;
    choice: ScoringChoice;
    reason: string;
    regions?: ScoringRegion[];
    source: string;
    revealed?: boolean;
    prefill?: string;
    confidence?: number;
    metadata?: JsonObject;
    updated_at: string;
};
export type ScoringLabelInput = Omit<ScoringLabelRow, 'updated_at' | 'source' | 'confidence' | 'metadata'> & { source?: string };

/** Client-facing views: never contain asset paths or the blind map. */
export type ScoringMediaView = { url: string; thumbnail_url: string };
export type ScoringPresentationView =
    | { kind: 'candidates'; original: ScoringMediaView; candidate_1: ScoringMediaView; candidate_2: ScoringMediaView }
    | { kind: 'composite'; original: ScoringMediaView; views: ScoringMediaView[] };
export type ScoringItemView = {
    item_id: string;
    index: number;
    pair: string;
    task: string;
    task_text: string;
    presentations: Record<string, ScoringPresentationView>;
    metadata: JsonObject;
};
export type ScoringLabelSetSummary = { name: string; read_only: boolean };
export type ScoringSetSummary = { id: string; title: string; description?: string; item_count: number; label_sets: ScoringLabelSetSummary[] };
export type ScoringSetsResponse = { sets: ScoringSetSummary[]; diagnostics: Array<{ set_id: string; message: string }> };
export type ScoringSetResponse = {
    /** Known set.json fields only; unknown keys (gap/skip/redaction logs) stay on the server. */
    set: Omit<ScoringSetManifest, 'schema_version'>;
    items: ScoringItemView[];
    label_sets: ScoringLabelSetSummary[];
};
export type ScoringLabelsResponse = {
    set_id: string;
    reviewer: string;
    read_only: boolean;
    /** Current label per item: the last valid row for each item_id, in item order. */
    labels: ScoringLabelRow[];
    row_count: number;
    invalid_rows: number;
};
export type ScoringRevealResponse = { item_id: string; blind_map: { pred: 1 | 2; gt: 1 | 2 } };

const id = { type: 'string', pattern: idPattern };
const asset = { type: 'string', pattern: '^assets/[A-Za-z0-9._/-]+$', maxLength: 512 };
const nullableAsset = { type: ['string', 'null'], pattern: asset.pattern, maxLength: asset.maxLength };
const choice = { enum: [1, 2, 'tie'] };
const reason = { type: 'string', maxLength: 4000 };
const source = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$' };
const regions = {
    type: 'array', maxItems: 64,
    items: { type: 'object', additionalProperties: false, required: ['window_id', 'present'], properties: { window_id: { type: 'string', minLength: 1, maxLength: 128 }, present: { enum: ['yes', 'no', 'unsure'] }, note: { type: 'string', maxLength: 2000 } } }
};
export const scoringSetSchema = {
    $id: 'covis/scoring-set', type: 'object', additionalProperties: true,
    required: ['schema_version', 'id', 'title', 'source', 'blind_seed', 'instructions', 'presentations'],
    properties: {
        schema_version: { const: 1 }, id, title: { type: 'string', minLength: 1, maxLength: 160 }, description: { type: 'string', maxLength: 4000 },
        source: { type: 'object', required: ['cohort'], properties: { cohort: { type: 'string', minLength: 1, maxLength: 256 }, round: { type: ['string', 'null'], maxLength: 256 } } },
        blind_seed: { type: 'integer' }, instructions: { type: 'string', maxLength: 20000 },
        presentations: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['id', 'title'], properties: { id, title: { type: 'string', minLength: 1, maxLength: 80 } } } },
        created_at: { type: 'string', maxLength: 64 }
    }
} as const;
export const scoringItemSchema = {
    $id: 'covis/scoring-item', type: 'object', additionalProperties: false,
    required: ['item_id', 'pair', 'task', 'task_text', 'presentations', 'blind_map'],
    properties: {
        item_id: id, pair: { type: 'string', minLength: 1, maxLength: 256 }, task: { type: 'string', minLength: 1, maxLength: 128 }, task_text: { type: 'string', maxLength: 8000 },
        presentations: {
            type: 'object', minProperties: 1, maxProperties: 16, propertyNames: { pattern: idPattern },
            additionalProperties: {
                type: 'object', additionalProperties: false, required: [...SCORING_ROLES],
                properties: { original: asset, candidate_1: nullableAsset, candidate_2: nullableAsset, views: { type: 'array', minItems: 1, maxItems: MAX_COMPOSITE_VIEWS, items: asset } },
                oneOf: [
                    { properties: { candidate_1: asset, candidate_2: asset }, not: { required: ['views'] } },
                    { properties: { candidate_1: { type: 'null' }, candidate_2: { type: 'null' } }, required: ['views'] }
                ]
            }
        },
        blind_map: { type: 'object', additionalProperties: false, required: ['pred', 'gt'], properties: { pred: { enum: [1, 2] }, gt: { enum: [1, 2] } } },
        metadata: { type: 'object' }
    }
} as const;
export const scoringLabelSchema = {
    $id: 'covis/scoring-label', type: 'object', additionalProperties: true,
    required: ['item_id', 'choice', 'reason', 'source', 'updated_at'],
    properties: {
        item_id: id, choice, reason, regions, source, revealed: { type: 'boolean' }, prefill: { type: 'string', pattern: reviewerPattern },
        confidence: { type: 'number', minimum: 0, maximum: 1 }, metadata: { type: 'object' },
        updated_at: { type: 'string', minLength: 1, maxLength: 64 }
    }
} as const;
/** Body of `POST .../labels/:reviewer`; the server adds `updated_at` and defaults `source` to `human`. */
export const scoringLabelInputSchema = {
    $id: 'covis/scoring-label-input', type: 'object', additionalProperties: false,
    required: ['item_id', 'choice', 'reason'],
    properties: { item_id: id, choice, reason, regions, source, revealed: { type: 'boolean' }, prefill: { type: 'string', pattern: reviewerPattern } }
} as const;
