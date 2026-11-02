import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScoringApp } from '../src/client/ScoringApp.js';
import { scoringApi } from '../src/client/scoringApi.js';
import { filterItems, scoringRecord, validReviewerName } from '../src/client/scoringModel.js';
import { parseScoringState, serializeScoringState } from '../src/client/scoringUrlState.js';
import { TopBar } from '../src/client/TopBar.js';
import type { ScoringItemView, ScoringLabelRow, ScoringSetResponse } from '../src/shared/scoring.js';

const media = (role: string) => ({ url: `/m/${role}`, thumbnail_url: `/m/${role}?variant=thumbnail` });
const items: ScoringItemView[] = [
    { item_id: 'a', index: 1, pair: 'refseg/x', task: 'refseg', task_text: 'Segment the tank.', metadata: {}, presentations: {
        overlay: { kind: 'candidates', original: media('o'), candidate_1: media('c1'), candidate_2: media('c2') },
        side: { kind: 'composite', original: media('o'), views: [media('v1')] } } },
    { item_id: 'b', index: 2, pair: 'semantic/y', task: 'semantic', task_text: 'Classes: water.', metadata: {}, presentations: {
        side: { kind: 'composite', original: media('o'), views: [media('v1'), media('v2')] } } }
];
const row = (item_id: string, choice: ScoringLabelRow['choice'], reason = ''): ScoringLabelRow => ({ item_id, choice, reason, source: 'x', updated_at: '2026-10-31T00:00:00.000Z' });

it('round-trips scoring deep links and keeps an explicit empty prefill', () => {
    const state = parseScoringState('?set=pj-demo&item=a&prefill=agent-demo&pres=overlay&pair=refseg%2Fx&status=labelled&agree=disagree');
    expect(state).toEqual({ setId: 'pj-demo', itemId: 'a', prefill: 'agent-demo', presentation: 'overlay', pair: 'refseg/x', status: 'labelled', agreement: 'disagree' });
    expect(parseScoringState(serializeScoringState(state))).toEqual(state);
    expect(parseScoringState('?set=pj-demo&prefill=').prefill).toBe('');
    expect(serializeScoringState({ setId: 's', prefill: '', status: 'all', agreement: 'all' })).toBe('?set=s&prefill=');
    expect(parseScoringState('?set=../x&prefill=bad.name&status=x')).toEqual({ status: 'all', agreement: 'all' });
    const real = parseScoringState('?set=pj-e61-r30-v1-r02-masks&prefill=agent-r02-codex-high&real=1');
    expect(real).toEqual({ setId: 'pj-e61-r30-v1-r02-masks', prefill: 'agent-r02-codex-high', status: 'all', agreement: 'all', real: true });
    expect(serializeScoringState(real)).toBe('?set=pj-e61-r30-v1-r02-masks&prefill=agent-r02-codex-high&real=1');
    expect(parseScoringState('?set=s&real=0').real).toBeUndefined();
    expect(serializeScoringState({ setId: 's', status: 'all', agreement: 'all', real: false })).toBe('?set=s');
});

it('validates reviewer names, builds panels for both presentation kinds and filters items', () => {
    expect(validReviewerName('alice_1')).toBe(true);
    for (const name of ['', 'a'.repeat(33), 'agent-x', 'x y', 'a.b']) expect(validReviewerName(name)).toBe(false);
    expect(scoringRecord(items[0]!, 'overlay').panels.map(panel => panel.title)).toEqual(['Original', 'Candidate 1', 'Candidate 2']);
    expect(scoringRecord(items[0]!, 'overlay', 'Overlay', { pred: 2, gt: 1 }).panels.map(panel => panel.title)).toEqual(['Original', 'Candidate 1 · GT', 'Candidate 2 · Prediction']);
    expect(scoringRecord(items[0]!, 'side', 'Side by side').panels.map(panel => panel.title)).toEqual(['Original', 'Side by side']);
    expect(scoringRecord(items[1]!, 'side', 'Side').panels.map(panel => [panel.id, panel.title])).toEqual([['original', 'Original'], ['view_1', 'Side 1'], ['view_2', 'Side 2']]);
    expect(scoringRecord(items[1]!, 'overlay').panels.every(panel => panel.status === 'missing')).toBe(true);
    const current = new Map([['a', row('a', 1)]]);
    const prefill = new Map([['a', row('a', 2)], ['b', row('b', 1)]]);
    const ids = (view: Parameters<typeof filterItems>[1]) => filterItems(items, view, current, prefill).map(item => item.item_id);
    expect(ids({ status: 'all', agreement: 'all' })).toEqual(['a', 'b']);
    expect(ids({ pair: 'semantic/y', status: 'all', agreement: 'all' })).toEqual(['b']);
    expect(ids({ status: 'unlabelled', agreement: 'all' })).toEqual(['b']);
    expect(ids({ status: 'all', agreement: 'disagree' })).toEqual(['a']);
    expect(ids({ status: 'all', agreement: 'agree' })).toEqual([]);
});

it('shows COViS with both mode entries and highlights the active one', () => {
    render(<TopBar mode="scoring"/>);
    expect(screen.getByRole('link', { name: 'COViS' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Scoring' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'T2I-Explorer' })).not.toHaveAttribute('aria-current');
    cleanup();
});

describe('ScoringApp', () => {
    const set: ScoringSetResponse = {
        set: { id: 'pj-demo', title: 'Demo', source: { cohort: 'c' }, blind_seed: 42, instructions: 'Pick one.', presentations: [{ id: 'overlay', title: 'Overlay' }, { id: 'side', title: 'Side by side' }] },
        items, label_sets: [{ name: 'agent-demo', read_only: true }, { name: 'alice', read_only: false }]
    };
    let posts: Array<{ url: string; body: unknown }>;
    beforeEach(() => {
        posts = [];
        localStorage.clear();
        window.history.replaceState({}, '', '/scoring?set=pj-demo');
        vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:image'; static revokeObjectURL = vi.fn(); });
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
            if (init?.method === 'POST') {
                const body = JSON.parse(String(init.body));
                posts.push({ url, body });
                if (url.endsWith('/reveal')) return reply({ item_id: 'a', blind_map: { pred: 2, gt: 1 } });
                return reply({ ...body, source: body.source ?? 'human', revealed: Boolean(body.revealed), updated_at: '2026-10-31T01:00:00.000Z' });
            }
            if (url === '/api/scoring/sets') return reply({ sets: [{ id: 'pj-demo', title: 'Demo', item_count: 2, label_sets: set.label_sets }], diagnostics: [] });
            if (url === '/api/scoring/sets/pj-demo') return reply(set);
            if (url.endsWith('/labels/agent-demo')) return reply({ set_id: 'pj-demo', reviewer: 'agent-demo', read_only: true, labels: [{ ...row('a', 2, 'Candidate 2 is tighter.'), regions: [{ window_id: 'w0', present: 'yes', note: 'tank edge' }] }], row_count: 1, invalid_rows: 0 });
            if (url.includes('/labels/')) return reply({ set_id: 'pj-demo', reviewer: 'alice', read_only: false, labels: [], row_count: 0, invalid_rows: 0 });
            return new Response('image');
        }));
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('asks for a reviewer name once and stores it locally', async () => {
        render(<ScoringApp/>);
        const input = screen.getByRole('textbox', { name: 'Reviewer name' });
        fireEvent.change(input, { target: { value: 'agent-x' } });
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
        fireEvent.change(input, { target: { value: 'alice' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(localStorage.getItem('covis.reviewer')).toBe('alice');
        expect(await screen.findByRole('heading', { name: 'a' })).toBeInTheDocument();
    });

    it('prefills from the default agent set, saves, switches to a composite view and records reveals', async () => {
        localStorage.setItem('covis.reviewer', 'alice');
        render(<ScoringApp/>);
        const prefillBox = await screen.findByRole('region', { name: 'Prefilled verdict' });
        expect(await within(prefillBox).findByText('Candidate 2 is tighter.')).toBeInTheDocument();
        await waitFor(() => expect(window.location.search).toContain('prefill=agent-demo'));
        expect(screen.getByRole('table', { name: 'Regions' })).toHaveTextContent('tank edge');
        expect(screen.getByText('0 / 2')).toBeInTheDocument();
        const form = screen.getByRole('form', { name: 'Your label' });
        expect(within(form).getByRole('button', { name: 'Candidate 2' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(form).getByRole('textbox', { name: 'Reason' })).toHaveValue('Candidate 2 is tighter.');
        fireEvent.keyDown(window, { key: 't' });
        expect(within(form).getByRole('button', { name: 'Tie' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Both fine.' } });
        fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({ url: '/api/scoring/sets/pj-demo/labels/alice', body: { item_id: 'a', choice: 'tie', reason: 'Both fine.', source: 'human', revealed: false, prefill: 'agent-demo' } });
        expect(await screen.findByText('1 / 2')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
        expect(screen.getByText('The composite canvas labels its halves Candidate 1 and Candidate 2.')).toBeInTheDocument();
        expect(screen.getAllByRole('figure').map(figure => figure.querySelector('figcaption')?.textContent)).toEqual(['Original', 'Side by side']);
        expect(window.location.search).toContain('pres=side');

        vi.stubGlobal('confirm', vi.fn(() => true));
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        expect(await screen.findByText('Candidate 2 is the prediction; candidate 1 is the ground truth.')).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('covis.revealed.pj-demo.alice')!)).toEqual({ a: { pred: 2, gt: 1 } });
        fireEvent.click(within(form).getByRole('button', { name: 'Candidate 1' }));
        fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(posts.filter(post => post.url.includes('/labels/'))).toHaveLength(2));
        expect(posts.at(-1)!.body).toMatchObject({ choice: 1, revealed: true });

        fireEvent.keyDown(window, { key: 'n' });
        expect(await screen.findByRole('heading', { name: 'b' })).toBeInTheDocument();
    });

    it('switches between Anonymous and Real names, auto-revealing the viewed item once', async () => {
        localStorage.setItem('covis.reviewer', 'alice');
        const reveal = vi.spyOn(scoringApi, 'reveal');
        render(<ScoringApp/>);
        const form = await screen.findByRole('form', { name: 'Your label' });
        const prefillBox = screen.getByRole('region', { name: 'Prefilled verdict' });
        await within(prefillBox).findByText('Candidate 2 is tighter.');
        const titles = () => screen.getAllByRole('figure').map(figure => figure.querySelector('figcaption')?.textContent);
        const choices = () => within(form).getAllByRole('button').filter(button => button.textContent !== 'Save').map(button => button.textContent);
        expect(screen.getByRole('button', { name: 'Anonymous' })).toHaveAttribute('aria-pressed', 'true');
        expect(titles()).toEqual(['Original', 'Candidate 1', 'Candidate 2']);
        expect(choices()).toEqual(['Candidate 1', 'Candidate 2', 'Tie']);

        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        fireEvent.click(screen.getByRole('button', { name: 'Real' }));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Anonymous' })).toHaveAttribute('aria-pressed', 'true');
        expect(reveal).not.toHaveBeenCalled();

        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByRole('button', { name: 'Real' }));
        expect(await screen.findByRole('button', { name: 'Candidate 1 · GT' })).toBeInTheDocument();
        expect(reveal).toHaveBeenCalledTimes(1);
        expect(reveal).toHaveBeenCalledWith('pj-demo', 'a', 'alice');
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(window.location.search).toContain('real=1');
        expect(screen.getByRole('button', { name: 'Real' })).toHaveAttribute('aria-pressed', 'true');
        expect(titles()).toEqual(['Original', 'Candidate 1 · GT', 'Candidate 2 · Prediction']);
        expect(choices()).toEqual(['Candidate 1 · GT', 'Candidate 2 · Prediction', 'Tie']);
        expect(within(prefillBox).getByText('Candidate 2 · Prediction')).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('covis.revealed.pj-demo.alice')!)).toEqual({ a: { pred: 2, gt: 1 } });
        fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
        expect(screen.getByText('The composite canvas labels its halves Candidate 1 and Candidate 2. Candidate 1 = GT, Candidate 2 = Prediction.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Anonymous' }));
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(window.location.search).not.toContain('real=');
        expect(choices()).toEqual(['Candidate 1', 'Candidate 2', 'Tie']);
        expect(screen.getByText('The composite canvas labels its halves Candidate 1 and Candidate 2.')).toBeInTheDocument();
        expect(screen.getByText('Candidate 2 is the prediction; candidate 1 is the ground truth.')).toBeInTheDocument();
        fireEvent.click(within(form).getByRole('button', { name: 'Candidate 1' }));
        fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(posts.filter(post => post.url.includes('/labels/'))).toHaveLength(1));
        expect(posts.at(-1)!.body).toMatchObject({ item_id: 'a', choice: 1, revealed: true });
        expect(reveal).toHaveBeenCalledTimes(1);
    });
});
