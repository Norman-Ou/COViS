import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openPage, reloadPage } from './navigation.js';

test('navigates between modes, scores an item blind and exports the label', async ({ page }) => {
    const reviewer = `e2e-${test.info().project.name}`;
    await openPage(page, '/');
    await expect(page).toHaveTitle('COViS');
    await page.getByRole('link', { name: 'Scoring', exact: true }).click();
    await expect(page).toHaveURL(/\/scoring$/);
    await expect(page.getByRole('link', { name: 'Scoring', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('textbox', { name: 'Reviewer name' }).fill(reviewer);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Pairwise judge demo/ }).click();
    await expect(page).toHaveURL(/set=pj-demo.*prefill=agent-demo|prefill=agent-demo.*set=pj-demo/);
    await expect(page.getByRole('heading', { name: 'demo-refseg-01' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Prefilled verdict' })).toContainText('Candidate 2');
    await expect(page.locator('.scoring-item .media-panel[data-media-state="ready"]')).toHaveCount(3);
    await expect(page.getByText('0 / 7')).toBeVisible();

    await page.keyboard.press('1');
    await page.getByRole('textbox', { name: 'Reason' }).fill('Candidate 1 matches the rim.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('1 / 7')).toBeVisible();

    await page.getByRole('button', { name: 'Side by side' }).click();
    await expect(page.locator('.scoring-item figcaption')).toHaveText(['Original', 'Side by side']);
    await page.locator('.scoring-item .panel-button').last().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reveal' }).click();
    await expect(page.getByText('Candidate 1 is the prediction; candidate 2 is the ground truth.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved/)).toBeVisible();

    const exported = await page.request.get(`/api/scoring/sets/pj-demo/labels/${reviewer}/export`);
    const rows = (await exported.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toEqual([expect.objectContaining({ item_id: 'demo-refseg-01', choice: 1, revealed: true, prefill: 'agent-demo', source: 'human' })]);

    await reloadPage(page);
    await expect(page.getByText('1 / 7')).toBeVisible();
    await page.getByLabel('Status').selectOption('unlabelled');
    await expect(page.locator('.scoring-items li')).toHaveCount(6);
    expect((await new AxeBuilder({ page }).include('.scoring-layout').analyze()).violations.filter(v => v.impact === 'critical')).toEqual([]);
    await page.getByRole('link', { name: 'T2I-Explorer' }).click();
    await expect(page.locator('.dataset-card')).toHaveCount(2);
});

test('switches to Real names after confirming and keeps the mode across reload', async ({ page }) => {
    await openPage(page, '/scoring?set=pj-demo&prefill=agent-demo');
    await page.getByRole('textbox', { name: 'Reviewer name' }).fill(`e2e-real-${test.info().project.name}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'demo-refseg-01' })).toBeVisible();
    await expect(page.locator('.scoring-item figcaption')).toHaveText(['Original', 'Candidate 1', 'Candidate 2']);

    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Real', exact: true }).click();
    await expect(page.locator('.scoring-item figcaption').filter({ hasText: 'GT' })).toHaveText(['Candidate 2 · GT']);
    await expect(page.getByRole('button', { name: 'Candidate 1 · Prediction', exact: true })).toBeVisible();
    await expect(page.getByText('Candidate 1 is the prediction; candidate 2 is the ground truth.')).toBeVisible();
    await expect(page).toHaveURL(/real=1/);

    await reloadPage(page);
    await expect(page.getByRole('button', { name: 'Real', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.scoring-item figcaption')).toHaveText(['Original', 'Candidate 1 · Prediction', 'Candidate 2 · GT']);
    await page.getByRole('button', { name: 'Anonymous' }).click();
    await expect(page.locator('.scoring-item figcaption')).toHaveText(['Original', 'Candidate 1', 'Candidate 2']);
    await expect(page.getByRole('button', { name: 'Revealed' })).toBeVisible();
});

test('shows the instruction and each candidate text with coloured phrase chips', async ({ page }) => {
    await openPage(page, '/scoring?set=pj-demo&prefill=agent-demo&item=demo-refseg-01');
    await page.getByRole('textbox', { name: 'Reviewer name' }).fill(`e2e-texts-${test.info().project.name}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'demo-refseg-01' })).toBeVisible();
    const instruction = page.locator('.scoring-input-text');
    await expect(instruction).not.toHaveAttribute('open');
    await instruction.getByText('Instruction').click();
    await expect(instruction).toContainText('Please segment the large storage tank');
    const blocks = page.locator('.scoring-candidate-texts .scoring-candidate-text');
    await expect(blocks.locator('h3')).toHaveText(['Candidate 1', 'Candidate 2']);
    await expect(blocks.first().locator('.scoring-caption')).toHaveText('A large storage tank sits in the upper left beside bare ground.');
    await expect(blocks.first().locator('mark.scoring-phrase').first()).toHaveCSS('background-color', 'rgb(255, 200, 0)');
    await expect(blocks.first().locator('.scoring-phrase-legend li')).toHaveText(['large storage tank', 'bare ground']);

    await page.locator('.scoring-items button', { hasText: 'demo-semantic-01' }).click();
    await expect(page.locator('.scoring-candidate-texts .scoring-phrase-legend li.unlisted')).toHaveText(['road (not in legend)']);
    await page.locator('.scoring-items button', { hasText: 'demo-refseg-02' }).click();
    await expect(page.getByRole('heading', { name: 'demo-refseg-02' })).toBeVisible();
    await expect(page.locator('.scoring-candidate-texts')).toHaveCount(0);
    await expect(page.locator('.scoring-input-text')).toHaveCount(0);
});
