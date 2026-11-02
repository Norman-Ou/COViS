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
