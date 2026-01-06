import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { launchBrowser } from './browser.js';
import { injectAndi } from './andi-inject.js';
import { extractAlerts } from './extractors/index.js';
import { generateReport } from './report/render.js';

export async function runScan(url, options) {
  // Generate Run ID
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeUrl = url.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  const runId = `${safeUrl}_${timestamp}`;

  const outDir = path.resolve(options.out || './runs');
  const runDir = path.join(outDir, runId);
  const issuesDir = path.join(runDir, 'issues');
  const screenshotsDir = path.join(runDir, 'screenshots');

  await fs.ensureDir(issuesDir);
  if (options.screenshots) await fs.ensureDir(screenshotsDir);

  let browser, context, page;

  try {
    ({ browser, context, page } = await launchBrowser(
      options.browser,
      options.headed
    ));

    // Handle unexpected dialogs (alerts, confirms, beforeunload)
    page.on('dialog', async (dialog) => {
      if (options.verbose) {
        console.log(
          chalk.gray(`[Info] Dismissing dialog: ${dialog.message()}`)
        );
      }
      try {
        await dialog.dismiss();
      } catch (err) {
        // ignore race conditions
      }
    });

    console.log(chalk.blue('Navigating to ' + url + '...'));
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.warn(
        chalk.yellow(
          'Navigation timeout or partial load. attempting to proceed...'
        )
      );
    }

    // Auto-scroll to trigger lazy loading
    console.log(chalk.blue('Scrolling to load content...'));
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 50); // Fast scroll
      });
      // Scroll back up gently or jump? ANDI doesn't care, but for screenshots maybe top is better.
      window.scrollTo(0, 0);
    });
    // Wait for any final network settles
    await page.waitForTimeout(2000);

    console.log(chalk.blue('Injecting ANDI...'));
    const injected = await injectAndi(page);
    if (!injected) {
      throw new Error(
        'ANDI injection failed. ANDI UI did not appear. Check URL or CSP.'
      );
    }

    const modules = [
      'focusable elements',
      'graphics/images',
      'links/buttons',
      'tables',
      'structures',
      'color contrast',
      'hidden content',
      'iframes',
    ];

    // canonical mapping for class checking
    const moduleLetterMap = {
      'focusable elements': 'f',
      'graphics/images': 'g',
      'links/buttons': 'l',
      tables: 't',
      structures: 's',
      'color contrast': 'c',
      'hidden content': 'h',
      iframes: 'i',
    };

    const allAlerts = [];
    const modulesScanned = [];
    const severityBreakdown = { Danger: 0, Warning: 0, Caution: 0 };

    for (const modName of modules) {
      console.log(chalk.cyan(`Scanning module: ${modName}...`));

      try {
        if (modName !== 'focusable elements') {
          const letter = moduleLetterMap[modName];
          const buttonId = `ANDI508-moduleMenu-button-${letter}`;

          const switched = await page.evaluate(async (id) => {
            if (window.__ANDI_selectModuleById) {
              return await window.__ANDI_selectModuleById(id);
            }
            return false;
          }, buttonId);

          if (!switched) {
            console.warn(
              chalk.yellow(
                `Could not switch to module ${modName} (ID: ${buttonId}). Skipping.`
              )
            );
            continue;
          }

          // Wait for module load
          await page
            .waitForSelector(`.${letter}ANDI508-testPage`, { timeout: 10000 })
            .catch(() =>
              console.warn(`Timeout waiting for .${letter}ANDI508-testPage`)
            );

          // Wait for loading spinner to vanish
          await page
            .waitForSelector('#ANDI508-loading', {
              state: 'hidden',
              timeout: 10000,
            })
            .catch(() => {});
        }

        // Wait a beat for JS analysis to finish.
        // 2.5s to allow for heavier DOMs and async calculations.
        await page.waitForTimeout(2500);

        // Extract alerts from Main Frame AND all child frames
        let alerts = [];
        const frames = page.frames();

        if (options.verbose) {
          console.log(chalk.gray(`  Scanning ${frames.length} frame(s)...`));
        }

        for (const frame of frames) {
          // Check if frame has ANDI loaded?
          // We'll just try extracting; the extractor checks for jquery/ANDI presence.
          const frameAlerts = await extractAlerts(frame, modName);
          alerts = alerts.concat(frameAlerts);
        }

        console.log(`  Found ${alerts.length} alerts.`);
        if (options.verbose) {
          alerts.forEach((a) => {
            console.log(chalk.gray(`    - [${a.severity}] ${a.alertMessage}`));
          });
        }

        for (const alert of alerts) {
          // Screenshot logic
          if (options.screenshots && alert.andiElementIndex) {
            try {
              const elementHandle = await page
                .locator(`[data-andi508-index="${alert.andiElementIndex}"]`)
                .first();
              if (
                (await elementHandle.count()) > 0 &&
                (await elementHandle.isVisible())
              ) {
                const screenshotName = `${allAlerts.length + 1}.png`; // Simple incremental name
                const screenshotPath = path.join(
                  screenshotsDir,
                  screenshotName
                );
                await elementHandle.screenshot({ path: screenshotPath });
                alert.screenshotPath = `screenshots/${screenshotName}`;
              }
            } catch (err) {
              // console.warn("Could not take screenshot for element", alert.andiElementIndex);
            }
          }

          // Stats
          severityBreakdown[alert.severity] =
            (severityBreakdown[alert.severity] || 0) + 1;
          allAlerts.push(alert);
        }

        modulesScanned.push(modName);
      } catch (modErr) {
        console.error(
          chalk.red(`Error processing module ${modName}:`),
          modErr.message
        );
      }
    }

    // Write Issues
    let issueCounter = 0;
    for (const alert of allAlerts) {
      issueCounter++;
      const filename = String(issueCounter).padStart(9, '0') + '.json';
      await fs.writeJson(path.join(issuesDir, filename), alert, { spaces: 2 });
    }

    // Write Summary
    const summary = {
      runId,
      url,
      timestamp: new Date().toISOString(),
      totalPages: 1,
      totalAlerts: allAlerts.length,
      severityBreakdown,
      modulesScanned,
      topOffenders: {}, // TODO: calculate top offenders
    };
    await fs.writeJson(path.join(runDir, 'SUMMARY.json'), summary, {
      spaces: 2,
    });

    // Generate Report
    await generateReport(
      summary,
      allAlerts,
      path.join(runDir, `report-${runId}.html`)
    );

    console.log(chalk.green(`Scan complete. results saved to: ${runDir}`));
  } catch (error) {
    console.error(chalk.red('Fatal error during scan:'), error);
    if (context) {
      // Attempt to write error file
      const errorPath = path.join(runDir || outDir, 'ERROR.txt');
      await fs.outputFile(
        errorPath,
        `Error: ${error.message}\nStack: ${error.stack}\n\nTry running with --headed flag.`
      );
    }
  } finally {
    if (browser) await browser.close();
  }
}
