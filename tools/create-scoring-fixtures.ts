// Synthetic Scoring fixture set; never imported into production data.
// Usage: pnpm exec tsx tools/create-scoring-fixtures.ts
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { ScoringCandidateTexts, ScoringItemRecord, ScoringLabelRow, ScoringSetManifest } from '../src/shared/scoring.js';

const SIZE = 128;
const setId = 'pj-demo';
const stage = 'fixtures/.new-scoring';
type Box = [number, number, number, number];
type Mask = (x: number, y: number) => boolean;
const box = ([x0, y0, x1, y1]: Box): Mask => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const disk = (cx: number, cy: number, r: number): Mask => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;

function original(seed: number) {
    const pixels = Buffer.alloc(SIZE * SIZE * 3);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const o = (y * SIZE + x) * 3;
        pixels[o] = 60 + ((x * 3 + seed * 40) % 90);
        pixels[o + 1] = 90 + ((y * 2 + seed * 25) % 80);
        pixels[o + 2] = 70 + (((x + y) + seed * 15) % 60);
    }
    return pixels;
}
function overlay(base: Buffer, mask: Mask) {
    const pixels = Buffer.from(base);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (mask(x, y)) {
        const o = (y * SIZE + x) * 3;
        // One neutral colour for both candidates: colour never identifies a candidate.
        pixels[o] = Math.round(pixels[o]! * 0.5 + 255 * 0.5);
        pixels[o + 1] = Math.round(pixels[o + 1]! * 0.5 + 200 * 0.5);
        pixels[o + 2] = Math.round(pixels[o + 2]! * 0.5);
    }
    return pixels;
}
function outline(base: Buffer, mask: Mask) {
    const pixels = Buffer.from(base);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        if (!mask(x, y)) continue;
        let edge = false;
        for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2 && !edge; dx++) edge = !mask(x + dx, y + dy);
        if (!edge) continue;
        const o = (y * SIZE + x) * 3;
        pixels[o] = 255; pixels[o + 1] = 255; pixels[o + 2] = 255;
    }
    return pixels;
}
// 5x7 bitmap glyphs: fixtures must not depend on system fonts.
const GLYPHS: Record<string, string[]> = {
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
    n: ['00000', '00000', '10110', '11001', '10001', '10001', '10001'], d: ['00001', '00001', '01101', '10011', '10001', '10011', '01101'],
    i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'], t: ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
    e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111']
};
function labelStrip(text: string) {
    const height = 18, pixels = Buffer.alloc(SIZE * height * 3);
    [...text].forEach((char, index) => GLYPHS[char]!.forEach((row, y) => [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const px = 2 + index * 11 + x * 2 + dx, py = 2 + y * 2 + dy, o = (py * SIZE + px) * 3;
            if (px < SIZE) { pixels[o] = 255; pixels[o + 1] = 255; pixels[o + 2] = 255; }
        }
    })));
    return sharp(pixels, { raw: { width: SIZE, height, channels: 3 } }).png().toBuffer();
}
// Composite canvas: both candidate overlays side by side, halves labelled "Candidate 1" / "Candidate 2".
async function sideBySide(first: Buffer, second: Buffer) {
    return sharp({ create: { width: SIZE * 2 + 4, height: SIZE + 18, channels: 3, background: '#000' } }).composite([
        { input: await png(first), left: 0, top: 18 }, { input: await png(second), left: SIZE + 4, top: 18 },
        { input: await labelStrip('Candidate 1'), left: 0, top: 0 }, { input: await labelStrip('Candidate 2'), left: SIZE + 4, top: 0 }
    ]).png({ compressionLevel: 9 }).toBuffer();
}
const png = (pixels: Buffer) => sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();

const presentations = [{ id: 'overlay', title: 'Overlay' }, { id: 'outline', title: 'Outline' }, { id: 'side_by_side', title: 'Side by side' }];
// Grounded captions keyed by blind candidate number; `[phrase]` chips use each phrase's mask colour.
const texts: Record<string, ScoringCandidateTexts> = {
    'demo-refseg-01': {
        1: { caption: 'A [large storage tank] sits in the upper left beside [bare ground].', phrases: [{ name: 'large storage tank', rgb: [255, 200, 0] }, { name: 'bare ground', rgb: [86, 180, 233] }] },
        2: { caption: 'The round [storage tank] in the upper left.', phrases: [{ name: 'storage tank', rgb: [255, 200, 0] }] }
    },
    'demo-composite-01': {
        1: { caption: 'A [vehicle] is parked beside a [building].', phrases: [{ name: 'vehicle', rgb: [230, 159, 0] }, { name: 'building', rgb: [0, 114, 178] }] },
        2: { caption: 'A [vehicle] is parked next to the building [roof].', phrases: [{ name: 'vehicle', rgb: [230, 159, 0] }, { name: 'parking lot', rgb: [0, 158, 115] }] }
    },
    // Class tasks: the declared class list; `unlisted` classes are outside the task legend and drawn grey.
    'demo-semantic-01': {
        1: { caption: '[building], [road]', phrases: [{ name: 'building', rgb: [255, 200, 0] }, { name: 'road', rgb: [128, 128, 128], unlisted: true }] },
        2: { caption: '[building]', phrases: [{ name: 'building', rgb: [255, 200, 0] }] }
    }
};
// Raw instruction given to both candidates.
const inputs: Record<string, string> = {
    'demo-refseg-01': 'Please segment the large storage tank in the upper left of this remote sensing image and output its mask.',
    'demo-semantic-01': 'Segment every building in this image. Output a mask where each class uses its legend colour.',
    'demo-composite-01': 'Describe the image and ground each mentioned object with a mask.'
};
const specs: Array<{ id: string; pair: string; task: string; text: string; pred: Mask; gt: Mask; predIs: 1 | 2; presentations: string[] }> = [
    { id: 'demo-refseg-01', pair: 'refseg/sior-t', task: 'refseg', text: 'Segment the large storage tank in the upper left.', pred: disk(40, 40, 22), gt: disk(42, 38, 18), predIs: 1, presentations: ['overlay', 'outline', 'side_by_side'] },
    { id: 'demo-refseg-02', pair: 'refseg/sior-t', task: 'refseg', text: 'Segment the bridge crossing the river.', pred: box([10, 56, 118, 74]), gt: box([10, 58, 100, 72]), predIs: 2, presentations: ['overlay', 'outline'] },
    { id: 'demo-semantic-01', pair: 'semantic/loveda', task: 'semantic', text: 'Classes: building (shown in the overlay colour).', pred: box([20, 20, 70, 90]), gt: box([24, 24, 66, 60]), predIs: 2, presentations: ['overlay', 'outline'] },
    { id: 'demo-semantic-02', pair: 'semantic/loveda', task: 'semantic', text: 'Classes: water (shown in the overlay colour).', pred: disk(80, 80, 30), gt: disk(80, 80, 30), predIs: 1, presentations: ['overlay'] },
    { id: 'demo-interactive-01', pair: 'interactive/isaid', task: 'interactive', text: 'Segment the target indicated by the drawn point.', pred: box([50, 30, 90, 60]), gt: box([52, 32, 104, 64]), predIs: 1, presentations: ['overlay', 'outline'] },
    { id: 'demo-interactive-02', pair: 'interactive/isaid', task: 'interactive', text: 'Segment the target indicated by the drawn box.', pred: () => false, gt: disk(64, 64, 16), predIs: 2, presentations: ['overlay', 'outline'] },
    { id: 'demo-composite-01', pair: 'grounding/dior-rsvg', task: 'grounding', text: 'Locate the vehicle parked next to the building.', pred: box([30, 70, 60, 96]), gt: box([34, 72, 58, 92]), predIs: 1, presentations: ['side_by_side'] }
];

await rm(stage, { recursive: true, force: true });
const setDir = path.join(stage, setId);
await mkdir(path.join(setDir, 'labels'), { recursive: true });
const manifest: ScoringSetManifest = {
    schema_version: 1, id: setId, title: 'Pairwise judge demo', description: 'Synthetic fixture set for the COViS Scoring mode.',
    source: { cohort: 'pj-demo-cohort', round: 'demo-round' }, blind_seed: 42,
    instructions: 'Two anonymous candidate annotations are shown for each item. Choose the one that better annotates the target described by the task text, or tie, and give a short reason.',
    presentations, created_at: '2026-10-31T00:00:00Z'
};
const items: ScoringItemRecord[] = [];
for (const [index, spec] of specs.entries()) {
    const base = original(index);
    const candidates = spec.predIs === 1 ? [spec.pred, spec.gt] : [spec.gt, spec.pred];
    const record: ScoringItemRecord['presentations'] = {};
    for (const presentation of spec.presentations) {
        const dir = path.join(setDir, 'assets', spec.id, presentation);
        await mkdir(dir, { recursive: true });
        const rel = `assets/${spec.id}/${presentation}`;
        await writeFile(path.join(dir, 'original.png'), await png(base));
        if (presentation === 'side_by_side') {
            // Composite shape emitted by the GeoBanana exporter: candidates null plus `views`.
            await writeFile(path.join(dir, 'view_1.png'), await sideBySide(overlay(base, candidates[0]!), overlay(base, candidates[1]!)));
            record[presentation] = { original: `${rel}/original.png`, candidate_1: null, candidate_2: null, views: [`${rel}/view_1.png`] };
            continue;
        }
        const draw = presentation === 'outline' ? outline : overlay;
        await writeFile(path.join(dir, 'candidate_1.png'), await png(draw(base, candidates[0]!)));
        await writeFile(path.join(dir, 'candidate_2.png'), await png(draw(base, candidates[1]!)));
        record[presentation] = { original: `${rel}/original.png`, candidate_1: `${rel}/candidate_1.png`, candidate_2: `${rel}/candidate_2.png` };
    }
    items.push({ item_id: spec.id, pair: spec.pair, task: spec.task, task_text: spec.text, ...(inputs[spec.id] ? { input_text: inputs[spec.id] } : {}), presentations: record, blind_map: { pred: spec.predIs, gt: spec.predIs === 1 ? 2 : 1 }, metadata: { fixture: true }, ...(texts[spec.id] ? { candidate_texts: texts[spec.id] } : {}) });
}
const prefill: ScoringLabelRow[] = [
    { item_id: 'demo-refseg-01', choice: 2, reason: 'Candidate 2 follows the tank rim; candidate 1 spills onto the ground.', confidence: 0.7 },
    { item_id: 'demo-refseg-02', choice: 2, reason: 'Candidate 2 covers the full span of the bridge.', confidence: 0.8 },
    { item_id: 'demo-semantic-01', choice: 1, reason: 'Candidate 1 misses the lower half of the building.', confidence: 0.55 },
    { item_id: 'demo-semantic-02', choice: 'tie', reason: 'Both candidates are identical.', confidence: 0.95 },
    { item_id: 'demo-interactive-01', choice: 2, reason: 'Candidate 2 includes the whole roof under the point.', confidence: 0.6 },
    { item_id: 'demo-interactive-02', choice: 2, reason: 'Candidate 1 is empty; candidate 2 marks the target.', confidence: 0.9,
        regions: [{ window_id: 'w0', present: 'yes', note: 'Only candidate 2 marks this disk; the target is visible here.' }] },
    { item_id: 'demo-composite-01', choice: 'tie', reason: 'Both boxes cover the vehicle.' }
].map(row => ({ ...row, source: 'agent:demo-round/demo-judge/medium', revealed: false, updated_at: '2026-10-31T00:00:00.000Z' }) as ScoringLabelRow);
await writeFile(path.join(setDir, 'set.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(setDir, 'items.jsonl'), items.map(item => JSON.stringify(item)).join('\n') + '\n');
await writeFile(path.join(setDir, 'labels', 'agent-demo.jsonl'), prefill.map(row => JSON.stringify(row)).join('\n') + '\n');
await rm('fixtures/scoring', { recursive: true, force: true });
await rename(stage, 'fixtures/scoring');
