import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { idPattern } from '../shared/contracts.js';
import {
    isAgentLabelSet, reviewerPattern, scoringItemSchema, scoringLabelInputSchema, scoringLabelSchema, scoringSetSchema, SCORING_ROLES,
    type ScoringItemRecord, type ScoringItemView, type ScoringLabelInput, type ScoringLabelRow, type ScoringLabelSetSummary,
    type ScoringLabelsResponse, type ScoringPresentationView, type ScoringRevealResponse, type ScoringRole, type ScoringSetManifest, type ScoringSetResponse, type ScoringSetsResponse
} from '../shared/scoring.js';
import { boundedRead } from './dataFormat.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSet = ajv.compile<ScoringSetManifest>(scoringSetSchema);
const validateItem = ajv.compile<ScoringItemRecord>(scoringItemSchema);
const validateLabel = ajv.compile<ScoringLabelRow>(scoringLabelSchema);
const validateLabelInput = ajv.compile<ScoringLabelInput>(scoringLabelInputSchema);
const ID = new RegExp(idPattern);
const REVIEWER = new RegExp(reviewerPattern);
const MAX_ITEMS_BYTES = 32 * 1024 * 1024;
const MAX_LABELS_BYTES = 64 * 1024 * 1024;

export class ScoringError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}
const notFound = (what: string) => new ScoringError(404, 'SCORING_NOT_FOUND', `The ${what} is unavailable.`);

export function requireReviewer(name: string) {
    if (!REVIEWER.test(name)) throw new ScoringError(400, 'INVALID_REVIEWER', 'Reviewer names must match [A-Za-z0-9_-]{1,32}.');
    return name;
}
function requireSetId(id: string) {
    if (!ID.test(id) || id === '.' || id === '..') throw notFound('scoring set');
    return id;
}
const mediaUrl = (setId: string, itemId: string, presentation: string, role: string) =>
    `/api/scoring/media/${encodeURIComponent(setId)}/${encodeURIComponent(itemId)}/${encodeURIComponent(presentation)}/${role}`;

type LoadedSet = { dir: string; manifest: ScoringSetManifest; items: ScoringItemRecord[] };

/**
 * Read-only access to `<root>/<set_id>/{set.json,items.jsonl}` plus append-only reviewer
 * label files under `labels/`. Files are re-read on each request; sets are small.
 */
export class ScoringStore {
    private writes = new Map<string, Promise<unknown>>();
    /** Reveals not yet followed by a label row, keyed by set/reviewer/item. */
    private pendingReveals = new Set<string>();
    constructor(private root?: string) {}

    private async loadSet(setId: string): Promise<LoadedSet> {
        requireSetId(setId);
        if (!this.root) throw notFound('scoring set');
        const dir = path.join(this.root, setId);
        try {
            if (!(await lstat(dir)).isDirectory()) throw new Error('not a directory');
        } catch { throw notFound('scoring set'); }
        let manifest: unknown;
        try { manifest = JSON.parse((await boundedRead(dir, 'set.json')).toString()); }
        catch { throw new ScoringError(422, 'SCORING_SET_INVALID', 'set.json is missing or malformed.'); }
        if (!validateSet(manifest)) throw new ScoringError(422, 'SCORING_SET_INVALID', `set.json is invalid: ${ajv.errorsText(validateSet.errors)}`);
        if (manifest.id !== setId) throw new ScoringError(422, 'SCORING_SET_INVALID', 'set.json id must equal its directory name.');
        let text: string;
        try { text = (await boundedRead(dir, 'items.jsonl', MAX_ITEMS_BYTES)).toString(); }
        catch { throw new ScoringError(422, 'SCORING_SET_INVALID', 'items.jsonl is missing or too large.'); }
        const presentationIds = new Set(manifest.presentations.map(item => item.id));
        const seen = new Set<string>();
        const items = text.split('\n').filter((line, index, lines) => line !== '' || index !== lines.length - 1).map((line, index) => {
            let row: unknown;
            try { row = JSON.parse(line); } catch { throw new ScoringError(422, 'SCORING_SET_INVALID', `items.jsonl line ${index + 1} is not JSON.`); }
            if (!validateItem(row)) throw new ScoringError(422, 'SCORING_SET_INVALID', `items.jsonl line ${index + 1}: ${ajv.errorsText(validateItem.errors)}`);
            if (seen.has(row.item_id)) throw new ScoringError(422, 'SCORING_SET_INVALID', `Duplicate item_id ${row.item_id}.`);
            if (row.blind_map.pred === row.blind_map.gt) throw new ScoringError(422, 'SCORING_SET_INVALID', `Item ${row.item_id} blind_map must assign pred and gt to different candidates.`);
            for (const key of Object.keys(row.presentations))
                if (!presentationIds.has(key)) throw new ScoringError(422, 'SCORING_SET_INVALID', `Item ${row.item_id} uses undeclared presentation ${key}.`);
            seen.add(row.item_id);
            return row;
        });
        return { dir, manifest, items };
    }

    private async labelSets(dir: string): Promise<ScoringLabelSetSummary[]> {
        const entries = await readdir(path.join(dir, 'labels'), { withFileTypes: true }).catch(() => []);
        return entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl') && REVIEWER.test(entry.name.slice(0, -6)))
            .map(entry => entry.name.slice(0, -6)).sort((a, b) => Number(isAgentLabelSet(b)) - Number(isAgentLabelSet(a)) || a.localeCompare(b))
            .map(name => ({ name, read_only: isAgentLabelSet(name) }));
    }

    async listSets(): Promise<ScoringSetsResponse> {
        const entries = this.root ? await readdir(this.root, { withFileTypes: true }).catch(() => []) : [];
        const response: ScoringSetsResponse = { sets: [], diagnostics: [] };
        for (const entry of entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
            try {
                const set = await this.loadSet(entry.name);
                response.sets.push({ id: set.manifest.id, title: set.manifest.title, ...(set.manifest.description ? { description: set.manifest.description } : {}), item_count: set.items.length, label_sets: await this.labelSets(set.dir) });
            } catch (error) {
                response.diagnostics.push({ set_id: entry.name, message: error instanceof Error ? error.message : String(error) });
            }
        }
        return response;
    }

    async getSet(setId: string): Promise<ScoringSetResponse> {
        const { dir, manifest, items } = await this.loadSet(setId);
        const set: ScoringSetResponse['set'] = {
            id: manifest.id, title: manifest.title, ...(manifest.description ? { description: manifest.description } : {}),
            source: manifest.source, blind_seed: manifest.blind_seed, instructions: manifest.instructions,
            presentations: manifest.presentations, ...(manifest.created_at ? { created_at: manifest.created_at } : {})
        };
        // blind_map and asset paths stay on the server.
        const views: ScoringItemView[] = items.map((item, index) => ({
            item_id: item.item_id, index: index + 1, pair: item.pair, task: item.task, task_text: item.task_text, metadata: item.metadata ?? {},
            presentations: Object.fromEntries(manifest.presentations.filter(p => item.presentations[p.id]).map(p => {
                const assets = item.presentations[p.id]!;
                const media = (role: string) => { const url = mediaUrl(setId, item.item_id, p.id, role); return { url, thumbnail_url: `${url}?variant=thumbnail` }; };
                const view: ScoringPresentationView = assets.views
                    ? { kind: 'composite', original: media('original'), views: assets.views.map((_, index) => media(`view_${index + 1}`)) }
                    : { kind: 'candidates', original: media('original'), candidate_1: media('candidate_1'), candidate_2: media('candidate_2') };
                return [p.id, view];
            }))
        }));
        return { set, items: views, label_sets: await this.labelSets(dir) };
    }

    async asset(setId: string, itemId: string, presentation: string, role: string) {
        const { dir, items } = await this.loadSet(setId);
        const assets = items.find(item => item.item_id === itemId)?.presentations[presentation];
        const view = /^view_([1-9][0-9]?)$/.exec(role);
        const asset = !assets ? undefined
            : view ? assets.views?.[Number(view[1]) - 1]
            : (SCORING_ROLES as readonly string[]).includes(role) ? assets[role as ScoringRole] : undefined;
        if (!asset) throw notFound('scoring image');
        return { root: dir, asset };
    }

    private labelFile(dir: string, reviewer: string) { return path.join(dir, 'labels', `${requireReviewer(reviewer)}.jsonl`); }

    private async readRows(dir: string, reviewer: string) {
        const file = this.labelFile(dir, reviewer);
        let text = '';
        try { text = (await boundedRead(dir, path.relative(dir, file), MAX_LABELS_BYTES)).toString(); }
        catch (error) {
            const missing = await lstat(file).then(() => false, () => true);
            if (!missing) throw new ScoringError(422, 'LABELS_UNREADABLE', `Label file is unreadable: ${error instanceof Error ? error.message : String(error)}`);
        }
        const rows: ScoringLabelRow[] = [];
        let invalid = 0;
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
                const row: unknown = JSON.parse(line);
                if (validateLabel(row)) rows.push(row); else invalid++;
            } catch { invalid++; }
        }
        return { rows, invalid };
    }

    async labels(setId: string, reviewer: string): Promise<ScoringLabelsResponse> {
        requireReviewer(reviewer);
        const { dir, items } = await this.loadSet(setId);
        const { rows, invalid } = await this.readRows(dir, reviewer);
        const current = new Map<string, ScoringLabelRow>();
        for (const row of rows) current.set(row.item_id, row);
        const labels = items.flatMap(item => current.get(item.item_id) ?? []);
        return { set_id: setId, reviewer, read_only: isAgentLabelSet(reviewer), labels, row_count: rows.length, invalid_rows: invalid };
    }

    private serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
        const previous = this.writes.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(work);
        this.writes.set(key, next);
        void next.finally(() => { if (this.writes.get(key) === next) this.writes.delete(key); }).catch(() => undefined);
        return next;
    }

    async appendLabel(setId: string, reviewer: string, body: unknown): Promise<ScoringLabelRow> {
        requireReviewer(reviewer);
        if (isAgentLabelSet(reviewer)) throw new ScoringError(403, 'LABEL_SET_READ_ONLY', 'agent-* label sets are read-only prefill sources.');
        if (!validateLabelInput(body)) throw new ScoringError(400, 'INVALID_LABEL', `Invalid label: ${ajv.errorsText(validateLabelInput.errors)}`);
        const { dir, items } = await this.loadSet(setId);
        if (!items.some(item => item.item_id === body.item_id)) throw new ScoringError(400, 'UNKNOWN_ITEM', 'The label refers to an item outside this set.');
        const file = this.labelFile(dir, reviewer);
        return this.serialize(file, async () => {
            const revealKey = `${setId}/${reviewer}/${body.item_id}`;
            const previous = (await this.readRows(dir, reviewer)).rows.filter(row => row.item_id === body.item_id);
            // Reveal is sticky: once a reviewer has seen the blind map, every later row says so.
            const revealed = Boolean(body.revealed) || this.pendingReveals.has(revealKey) || previous.some(row => row.revealed);
            const row: ScoringLabelRow = {
                item_id: body.item_id, choice: body.choice, reason: body.reason,
                ...(body.regions ? { regions: body.regions } : {}),
                source: body.source ?? 'human',
                ...(body.prefill ? { prefill: body.prefill } : {}),
                revealed, updated_at: new Date().toISOString()
            };
            const labelsDir = path.join(dir, 'labels');
            await mkdir(labelsDir, { recursive: true });
            if ((await lstat(labelsDir)).isSymbolicLink()) throw new ScoringError(500, 'LABELS_UNWRITABLE', 'labels/ must not be a symbolic link.');
            // One write(2) of one complete line on an O_APPEND descriptor: concurrent
            // writers never interleave inside a row and nothing is overwritten.
            const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
            try {
                await handle.write(Buffer.from(JSON.stringify(row) + '\n'));
                await handle.datasync();
            } finally { await handle.close(); }
            this.pendingReveals.delete(revealKey);
            return row;
        });
    }

    async reveal(setId: string, itemId: string, reviewer: string): Promise<ScoringRevealResponse> {
        requireReviewer(reviewer);
        if (isAgentLabelSet(reviewer)) throw new ScoringError(403, 'LABEL_SET_READ_ONLY', 'agent-* label sets cannot reveal.');
        const { items } = await this.loadSet(setId);
        const item = items.find(entry => entry.item_id === itemId);
        if (!item) throw notFound('scoring item');
        this.pendingReveals.add(`${setId}/${reviewer}/${itemId}`);
        return { item_id: item.item_id, blind_map: { pred: item.blind_map.pred, gt: item.blind_map.gt } };
    }

    async exportLabels(setId: string, reviewer: string) {
        const { labels } = await this.labels(setId, reviewer);
        return labels.map(row => JSON.stringify(row)).join('\n') + (labels.length ? '\n' : '');
    }
}
