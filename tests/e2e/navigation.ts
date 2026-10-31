import { errors, type Page } from '@playwright/test';

const baseURL = `http://127.0.0.1:${Number(process.env.T2I_E2E_PORT ?? 4182)}`;
const options = { waitUntil: 'domcontentloaded' as const, timeout: 10_000 };

async function navigate(page: Page, url: string, reload = false) {
    const expected = new URL(url, baseURL);
    expected.searchParams.sort();
    const previousDocument = await page.evaluate(() => performance.timeOrigin);
    try {
        if (reload) await page.reload(options);
        else await page.goto(url, options);
    } catch (error) {
        if (!(error instanceof errors.TimeoutError) || page.context().browser()?.browserType().name() !== 'firefox') throw error;

        // Playwright #42183 can leave a completed Firefox navigation pending.
        // Recover once only when the expected document and React shell exist;
        // network failures and unfinished or incorrect documents still fail.
        const loaded = await page.evaluate(({ target, previousDocument }) => {
            const current = new URL(window.location.href);
            current.searchParams.sort();
            return document.readyState === 'complete'
                && performance.timeOrigin !== previousDocument
                && current.href === target
                && Boolean(document.querySelector('.app-shell, .scoring-shell'));
        }, { target: expected.href, previousDocument }).catch(() => false);
        if (!loaded) throw error;

        // A superseding navigation releases Firefox's stuck navigation state.
        await page.goto(url, options);
    }
}

export async function openPage(page: Page, url: string) {
    await navigate(page, url);
}

export async function reloadPage(page: Page) {
    await navigate(page, page.url(), true);
}
