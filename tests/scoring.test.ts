import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';

const apps: FastifyInstance[] = [], roots: string[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const host = { host: '127.0.0.1' };
const json = { ...host, 'content-type': 'application/json' };
const base = '/api/scoring/sets/pj-demo';

async function setup(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'covis-scoring-'));
    roots.push(root);
    await cp('fixtures/scoring', path.join(root, 'scoring'), { recursive: true });
    const app = await buildApp({ dataRoot: 'fixtures/datasets', scoringRoot: path.join(root, 'scoring'), serveClient: false, ...extra });
    apps.push(app);
    return { app, setDir: path.join(root, 'scoring/pj-demo') };
}
const post = (app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = json) => app.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) });

it('lists sets and serves items without blind_map or asset paths', async () => {
    const { app } = await setup();
    const sets = (await app.inject({ url: '/api/scoring/sets', headers: host })).json();
    expect(sets.sets).toEqual([expect.objectContaining({ id: 'pj-demo', item_count: 7, label_sets: [{ name: 'agent-demo', read_only: true }] })]);
    const response = await app.inject({ url: base, headers: host });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('blind_map');
    expect(response.body).not.toContain('"pred"');
    expect(response.body).not.toContain('assets/');
    const body = response.json();
    expect(body.set).not.toHaveProperty('schema_version');
    expect(body.items).toHaveLength(7);
    const first = body.items[0];
    expect(Object.keys(first.presentations)).toEqual(['overlay', 'outline', 'side_by_side']);
    expect(first.presentations.overlay).toMatchObject({ kind: 'candidates', candidate_1: { url: `/api/scoring/media/pj-demo/demo-refseg-01/overlay/candidate_1` } });
    expect(first.presentations.side_by_side).toMatchObject({ kind: 'composite', views: [{ url: '/api/scoring/media/pj-demo/demo-refseg-01/side_by_side/view_1' }] });
    const image = await app.inject({ url: first.presentations.overlay.candidate_2.url, headers: host });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect((await app.inject({ url: first.presentations.side_by_side.views[0].thumbnail_url, headers: host })).headers['content-type']).toBe('image/webp');
    for (const url of ['/api/scoring/media/pj-demo/demo-refseg-01/overlay/blind_map', '/api/scoring/media/pj-demo/demo-refseg-01/side_by_side/candidate_1', '/api/scoring/media/pj-demo/demo-refseg-01/side_by_side/view_2', '/api/scoring/media/pj-demo/nope/overlay/original', '/api/scoring/media/..%2F/x/overlay/original'])
        expect((await app.inject({ url, headers: host })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/scoring/sets/missing', headers: host })).statusCode).toBe(404);
});

it('ignores unknown set.json keys and rejects malformed composite presentations', async () => {
    const { app, setDir } = await setup();
    const manifest = JSON.parse(await readFile(path.join(setDir, 'set.json'), 'utf8'));
    await writeFile(path.join(setDir, 'set.json'), JSON.stringify({ ...manifest, prefill_gaps: [{ item_id: 'x' }], skipped_items: [], redaction_log: ['secret'] }));
    const body = (await app.inject({ url: base, headers: host })).json();
    expect(body.items).toHaveLength(7);
    expect(body.set).not.toHaveProperty('redaction_log');
    const items = (await readFile(path.join(setDir, 'items.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    items[6].presentations.side_by_side.candidate_1 = 'assets/demo-composite-01/side_by_side/original.png';
    await writeFile(path.join(setDir, 'items.jsonl'), items.map(item => JSON.stringify(item)).join('\n') + '\n');
    expect((await app.inject({ url: base, headers: host })).statusCode).toBe(422);
});

it('appends label rows, keeps the last row per item current and exports current labels', async () => {
    const { app, setDir } = await setup();
    const first = await post(app, `${base}/labels/alice`, { item_id: 'demo-refseg-01', choice: 1, reason: 'tighter', prefill: 'agent-demo' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ item_id: 'demo-refseg-01', choice: 1, source: 'human', revealed: false, prefill: 'agent-demo' });
    expect(new Date(first.json().updated_at).toISOString()).toBe(first.json().updated_at);
    await post(app, `${base}/labels/alice`, { item_id: 'demo-refseg-01', choice: 'tie', reason: 'changed my mind', regions: [{ window_id: 'w0', present: 'unsure' }] });
    await post(app, `${base}/labels/alice`, { item_id: 'demo-composite-01', choice: 2, reason: '' });
    await post(app, `${base}/labels/bob`, { item_id: 'demo-refseg-01', choice: 2, reason: 'bob' });
    const file = (await readFile(path.join(setDir, 'labels/alice.jsonl'), 'utf8')).split('\n');
    expect(file).toHaveLength(4);
    expect(file.at(-1)).toBe('');
    const labels = (await app.inject({ url: `${base}/labels/alice`, headers: host })).json();
    expect(labels).toMatchObject({ reviewer: 'alice', read_only: false, row_count: 3, invalid_rows: 0 });
    expect(labels.labels.map((row: { item_id: string; choice: unknown }) => [row.item_id, row.choice])).toEqual([['demo-refseg-01', 'tie'], ['demo-composite-01', 2]]);
    const exported = await app.inject({ url: `${base}/labels/alice/export`, headers: host });
    expect(exported.headers['content-type']).toContain('application/x-ndjson');
    expect(exported.headers['content-disposition']).toBe('attachment; filename="pj-demo__alice.jsonl"');
    const rows = exported.body.trim().split('\n').map(line => JSON.parse(line));
    expect(rows.map(row => row.choice)).toEqual(['tie', 2]);
    const validate = new Ajv2020({ strict: false }).compile(JSON.parse(await readFile('schemas/scoring-label.schema.json', 'utf8')));
    for (const row of rows) expect(validate(row)).toBe(true);
    expect((await app.inject({ url: `${base}/labels/bob`, headers: host })).json().labels[0].choice).toBe(2);
    expect((await app.inject({ url: `${base}/labels/nobody`, headers: host })).json()).toMatchObject({ labels: [], row_count: 0 });
});

it('serializes concurrent appends without losing rows', async () => {
    const { app, setDir } = await setup();
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => post(app, `${base}/labels/carol`, { item_id: 'demo-semantic-01', choice: index % 2 ? 1 : 2, reason: `r${index}` })));
    expect(responses.every(response => response.statusCode === 201)).toBe(true);
    const lines = (await readFile(path.join(setDir, 'labels/carol.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(20);
    expect(lines.every(line => JSON.parse(line).item_id === 'demo-semantic-01')).toBe(true);
});

it('validates reviewer names, rejects agent-* writes, bad bodies, unknown items and cross-origin writes', async () => {
    const { app } = await setup();
    const label = { item_id: 'demo-refseg-01', choice: 1, reason: '' };
    for (const name of ['a'.repeat(33), 'bad.name', 'sp%20ace', '..'])
        expect((await post(app, `${base}/labels/${name}`, label)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ url: `${base}/labels/bad.name`, headers: host })).statusCode).toBe(400);
    const agent = await post(app, `${base}/labels/agent-demo`, label);
    expect(agent.statusCode).toBe(403);
    expect(agent.json().error.code).toBe('LABEL_SET_READ_ONLY');
    expect((await post(app, `${base}/labels/Agent-new`, label)).statusCode).toBe(403);
    expect((await app.inject({ url: `${base}/labels/agent-demo`, headers: host })).json()).toMatchObject({ read_only: true, row_count: 7 });
    for (const body of [{ ...label, choice: 3 }, { ...label, choice: '1' }, { item_id: 'demo-refseg-01', choice: 1 }, { ...label, updated_at: 'x' }, { ...label, source: '../x' }])
        expect((await post(app, `${base}/labels/dave`, body)).statusCode).toBe(400);
    expect((await post(app, `${base}/labels/dave`, { ...label, item_id: 'not-in-set' })).statusCode).toBe(400);
    expect((await post(app, `${base}/labels/dave`, label, { ...json, origin: 'https://evil.test' })).statusCode).toBe(403);
    for (const method of ['DELETE', 'PUT', 'PATCH'] as const)
        expect((await app.inject({ method, url: `${base}/labels/dave`, headers: host })).statusCode).toBe(404);
    expect((await app.inject({ url: `${base}/labels/dave`, headers: host })).json().row_count).toBe(0);
});

it('returns blind_map only from the reveal endpoint and marks later rows revealed', async () => {
    const { app } = await setup();
    await post(app, `${base}/labels/erin`, { item_id: 'demo-refseg-02', choice: 1, reason: 'before' });
    const reveal = await post(app, `${base}/items/demo-refseg-02/reveal`, { reviewer: 'erin' });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json()).toEqual({ item_id: 'demo-refseg-02', blind_map: { pred: 2, gt: 1 } });
    expect((await post(app, `${base}/items/demo-refseg-02/reveal`, { reviewer: 'agent-demo' })).statusCode).toBe(403);
    expect((await post(app, `${base}/items/demo-refseg-02/reveal`, {})).statusCode).toBe(400);
    expect((await post(app, `${base}/items/missing/reveal`, { reviewer: 'erin' })).statusCode).toBe(404);
    // The server enforces the flag even if a client omits it, and keeps it sticky.
    expect((await post(app, `${base}/labels/erin`, { item_id: 'demo-refseg-02', choice: 2, reason: 'after' })).json().revealed).toBe(true);
    expect((await post(app, `${base}/labels/erin`, { item_id: 'demo-refseg-02', choice: 2, reason: 'again', revealed: false })).json().revealed).toBe(true);
    expect((await post(app, `${base}/labels/erin`, { item_id: 'demo-refseg-01', choice: 2, reason: 'other item' })).json().revealed).toBe(false);
    const rows = (await app.inject({ url: `${base}/labels/erin/export`, headers: host })).body;
    expect(rows).not.toContain('blind_map');
});

it('redirects configured legacy hosts to the canonical origin before the host allowlist', async () => {
    const { app } = await setup({ redirectHosts: ['dive.ouruizhe.top'], canonicalOrigin: 'https://covis.ouruizhe.top' });
    const response = await app.inject({ url: '/scoring?set=pj-demo&item=demo-refseg-01', headers: { host: 'dive.ouruizhe.top' } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://covis.ouruizhe.top/scoring?set=pj-demo&item=demo-refseg-01');
    expect((await app.inject({ url: '/api/catalog?x=1', headers: { host: 'DIVE.ouruizhe.top:443' } })).headers.location).toBe('https://covis.ouruizhe.top/api/catalog?x=1');
    expect((await app.inject({ url: '/api/health', headers: host })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/health', headers: { host: 'other.test' } })).statusCode).toBe(403);
});

it('keeps redirects off by default and rejects an invalid canonical origin', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/health', headers: { host: 'dive.ouruizhe.top' } })).statusCode).toBe(403);
    await expect(buildApp({ dataRoot: 'fixtures/datasets', serveClient: false, redirectHosts: ['dive.ouruizhe.top'] })).rejects.toThrow();
    await expect(buildApp({ dataRoot: 'fixtures/datasets', serveClient: false, redirectHosts: ['dive.ouruizhe.top'], canonicalOrigin: 'https://covis.ouruizhe.top/path' })).rejects.toThrow();
});

it('serves no sets without a scoring root', async () => {
    const app = await buildApp({ dataRoot: 'fixtures/datasets', serveClient: false });
    apps.push(app);
    expect((await app.inject({ url: '/api/scoring/sets', headers: host })).json()).toEqual({ sets: [], diagnostics: [] });
    expect((await app.inject({ url: base, headers: host })).statusCode).toBe(404);
});

it('accepts composite presentations with up to 16 views and rejects 17', async () => {
    const { app, setDir } = await setup();
    const file = path.join(setDir, 'items.jsonl');
    const items = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const composite = items[6].presentations.side_by_side;
    composite.views = Array.from({ length: 16 }, () => composite.views[0]);
    await writeFile(file, items.map(item => JSON.stringify(item)).join('\n') + '\n');
    const body = (await app.inject({ url: base, headers: host })).json();
    expect(body.items[6].presentations.side_by_side.views).toHaveLength(16);
    expect((await app.inject({ url: '/api/scoring/media/pj-demo/demo-composite-01/side_by_side/view_16', headers: host })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/scoring/media/pj-demo/demo-composite-01/side_by_side/view_17', headers: host })).statusCode).toBe(404);
    composite.views.push(composite.views[0]);
    await writeFile(file, items.map(item => JSON.stringify(item)).join('\n') + '\n');
    expect((await app.inject({ url: base, headers: host })).statusCode).toBe(422);
});

it('passes input_text and candidate_texts through unchanged and rejects malformed ones', async () => {
    const { app, setDir } = await setup();
    const file = path.join(setDir, 'items.jsonl');
    const source = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const body = (await app.inject({ url: base, headers: host })).json();
    const byId = (id: string) => body.items.find((item: { item_id: string }) => item.item_id === id);
    for (const id of ['demo-refseg-01', 'demo-semantic-01', 'demo-composite-01']) {
        const row = source.find(item => item.item_id === id);
        expect(byId(id).candidate_texts).toEqual(row.candidate_texts);
        expect(byId(id).input_text).toBe(row.input_text);
    }
    expect(byId('demo-semantic-01').candidate_texts['1'].phrases[1]).toEqual({ name: 'road', rgb: [128, 128, 128], unlisted: true });
    expect(byId('demo-refseg-02')).not.toHaveProperty('candidate_texts');
    expect(byId('demo-refseg-02')).not.toHaveProperty('input_text');
    const texts = source[0].candidate_texts;
    const phrase = texts['1'].phrases[0];
    for (const [key, value] of [
        ['candidate_texts', { ...texts, 3: texts['1'] }], ['candidate_texts', { 1: texts['1'] }],
        ['candidate_texts', { ...texts, 1: { ...texts['1'], phrases: [{ ...phrase, rgb: [256, 0, 0] }] } }],
        ['candidate_texts', { ...texts, 1: { ...texts['1'], phrases: [{ ...phrase, rgb: [0, 0] }] } }],
        ['candidate_texts', { ...texts, 1: { ...texts['1'], phrases: [{ ...phrase, unlisted: 'yes' }] } }],
        ['candidate_texts', { ...texts, 1: { ...texts['1'], extra: 1 } }],
        ['input_text', 'x'.repeat(8001)], ['input_text', 7]
    ] as const) {
        await writeFile(file, [{ ...source[0], [key]: value }, ...source.slice(1)].map(item => JSON.stringify(item)).join('\n') + '\n');
        const response = await app.inject({ url: base, headers: host });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('SCORING_SET_INVALID');
    }
});
