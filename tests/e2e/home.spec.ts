import { expect, test } from '@playwright/test';

test('dataset search matches name fragments and restores the full list when cleared', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Search datasets' });
    const cards = page.locator('.dataset-card');
    await expect(cards).toHaveCount(2);
    for (const query of [' SFT_E6_R30 ', 'e6r30', 'ＳＦＴ']) {
        await search.fill(query);
        await expect(cards).toHaveCount(1);
        await expect(cards).toHaveText('sft-e6.0-r30');
    }
    await search.fill('base r30');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveText('basemodel-task-r30');
    await search.fill('no-such-dataset');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No published datasets match this search.')).toBeVisible();
    await search.fill(' ');
    await expect(cards).toHaveCount(2);
    await cards.filter({ hasText: 'sft-e6.0-r30' }).click();
    await expect(page.locator('.task-gallery')).toBeVisible();
});

test('COViS returns home, clears pending sample searches and preserves browser back navigation', async ({ page }) => {
    await page.goto('/?dataset=sft-e6.0-r30&cols=refseg:sior-t:baseline:a&q=airplane-3');
    await expect(page.locator('.column-header')).toHaveCount(1);
    await expect(page.getByText('1 comparison rows · page 1 of 1')).toBeVisible();
    await page.getByLabel('Search examples').fill('pending search');
    const home = page.getByRole('link', { name: 'COViS', exact: true });
    await expect(home).toHaveAttribute('href', '/');
    await home.focus();
    await home.press('Enter');
    await expect(page.locator('.dataset-card')).toHaveCount(2);
    await expect(page.getByLabel('Search examples')).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Dataset', exact: true })).toHaveValue('');
    await expect(page.locator('.column-header,.selected-card')).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\/$/);
    await page.goBack();
    await expect(page.locator('.column-header')).toHaveCount(1);
    await expect(page.getByLabel('Search examples')).toHaveValue('airplane-3');
    await expect(page.getByText('1 comparison rows · page 1 of 1')).toBeVisible();
    await page.goForward();
    await expect(page.locator('.dataset-card')).toHaveCount(2);
});
