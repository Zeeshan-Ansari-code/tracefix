/**
 * Headless Chromium capture — console + network.
 */
export async function captureBrowser({
  url,
  screenshotPath,
  waitMs = 2500,
  navTimeoutMs = Number(process.env.BROWSER_NAV_TIMEOUT_MS || 15_000),
}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright missing. Run: pnpm install:browsers');
  }

  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const networkErrors = [];

  const browser = await chromium.launch({
    headless: true,
    timeout: Math.min(navTimeoutMs, 20_000),
  });
  try {
    const page = await browser.newPage();

    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        consoleMessages.push({ type, text: msg.text().slice(0, 500) });
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(String(error.message || error).slice(0, 800));
    });
    page.on('requestfailed', (request) => {
      networkErrors.push({
        url: request.url().slice(0, 300),
        method: request.method(),
        error: request.failure()?.errorText || 'requestfailed',
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url().slice(0, 300),
          status: response.status(),
          method: response.request().method(),
        });
      }
    });

    let navigationError = null;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    } catch (error) {
      navigationError = error.message;
    }

    await new Promise((r) => setTimeout(r, waitMs));

    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => null);
    }

    const title = await page.title().catch(() => '');

    return {
      ok: !navigationError,
      url,
      title,
      navigationError,
      consoleMessages: consoleMessages.slice(0, 40),
      pageErrors: pageErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 40),
      networkErrors: networkErrors.slice(0, 20),
      summary: {
        consoleErrors: consoleMessages.filter((m) => m.type === 'error').length,
        consoleWarnings: consoleMessages.filter((m) => m.type === 'warning').length,
        pageErrors: pageErrors.length,
        failedRequests: failedRequests.length,
        networkErrors: networkErrors.length,
      },
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

export function emptyCapture(url = '') {
  return {
    ok: false,
    url,
    title: '',
    navigationError: 'browser capture skipped',
    consoleMessages: [],
    pageErrors: [],
    failedRequests: [],
    networkErrors: [],
    summary: {
      consoleErrors: 0,
      consoleWarnings: 0,
      pageErrors: 0,
      failedRequests: 0,
      networkErrors: 0,
    },
    skipped: true,
  };
}
