import { chromium, firefox, webkit } from 'playwright';

export async function launchBrowser(browserName = 'chromium', headed = false) {
  const launchOptions = { headless: !headed };
  let browserType = chromium;

  if (browserName === 'firefox') browserType = firefox;
  else if (browserName === 'webkit') browserType = webkit;

  if (browserName === 'chrome') {
    browserType = chromium;
    launchOptions.channel = 'chrome';
  }

  const browser = await browserType.launch(launchOptions);

  const context = await browser.newContext({
    bypassCSP: true, // Crucial for injecting ANDI script on secured sites
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  return { browser, context, page };
}
