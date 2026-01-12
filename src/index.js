import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { launchBrowser } from './browser.js';
import { injectAndi } from './andi-inject.js';
import { extractAlerts, extractLinksList } from './extractors/index.js';
import { generateReport } from './report/render.js';
import { generateCSV } from './report/csv.js';
import ANDI_ALERTS from './andi-alerts-map.js';

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
      // Use networkidle to wait for redirects to settle
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      // Ensure DOM is fully parsed
      await page.waitForLoadState('domcontentloaded');
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

    // Wait for ANDI to be fully attached and ready
    try {
      await page.waitForSelector('#andiBar', {
        state: 'attached',
        timeout: 5000,
      });
    } catch (e) {
      console.warn(
        chalk.yellow(
          'Warning: #andiBar not detected via selector, but injection reported success.'
        )
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
    let linksListTable = null;

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

        // Capture Links List specific table if applicable
        if (modName === 'links/buttons') {
          console.log(chalk.cyan('  Extracting Links List table...'));
          linksListTable = await extractLinksList(page);
          if (linksListTable) {
            // Enrichment: Try to map alert text to help URLs using the main alerts list
            const alertUrlMap = new Map();

            // 1. Load static definitions (Source of Truth from ANDI TOC)
            ANDI_ALERTS.forEach((def) => {
              alertUrlMap.set(def.text, def.link);
            });

            // 2. Augment with alert instances found on this page (in case of dynamic variations)
            alerts.forEach((a) => {
              if (a.alertMessage && a.helpUrl) {
                alertUrlMap.set(a.alertMessage, a.helpUrl);
              }
            });

            // Helper for fuzzy matching (Jaccard Similarity)
            const tokenize = (str) =>
              str
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter((w) => w.length > 2);
            const getSimilarity = (s1, s2) => {
              const tokens1 = new Set(tokenize(s1));
              const tokens2 = new Set(tokenize(s2));
              if (tokens1.size === 0 || tokens2.size === 0) return 0;
              const intersection = new Set(
                [...tokens1].filter((x) => tokens2.has(x))
              );
              const union = new Set([...tokens1, ...tokens2]);
              return intersection.size / union.size;
            };

            // Apply to Links List
            linksListTable.forEach((row) => {
              if (row.alerts && row.alerts.length > 0) {
                row.alerts.forEach((alertItem) => {
                  if (!alertItem.url && alertItem.message) {
                    // 1. Try exact match (normalized)
                    const simpleKey = alertItem.message.trim().toLowerCase();
                    // In case the map keys are complex, we might miss this, but checking strict equality is cheap
                    // We loop for fuzzy match anyway, so we can skip strict lookup or do it inside loop.

                    let bestUrl = null;
                    let bestScore = 0;

                    for (const [msg, url] of alertUrlMap.entries()) {
                      const score = getSimilarity(alertItem.message, msg);
                      if (score > bestScore) {
                        bestScore = score;
                        bestUrl = url;
                      }
                    }

                    // Threshold: 0.3 implies about 30% word overlap.
                    // e.g. "ambiguous same name different href" (5 words)
                    // "ambiguous link same name description another link different href" (8 words)
                    // Overlap: ambiguous, same, name, different, href (5 words).
                    // Union: 8 words. 5/8 = 0.625. MATCH.
                    if (bestScore > 0.3) {
                      alertItem.url = bestUrl;
                    }
                  }
                });
              }
            });

            console.log(
              chalk.gray(
                `  Captured ${linksListTable.length} items in Links List.`
              )
            );
          }
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
                const fullScreenshotPath = path.join(
                  screenshotsDir,
                  screenshotName
                );
                // Capture screenshot to disk and get buffer for embedding
                const screenshotBuffer = await elementHandle.screenshot({
                  path: fullScreenshotPath,
                });

                // Calculate relative path for HTML link and ensure forward slashes for URL compatibility
                const relativeScreenshotPath = path
                  .relative(runDir, fullScreenshotPath)
                  .split(path.sep)
                  .join('/');

                alert.screenshotPath = relativeScreenshotPath;
                alert.screenshotData = screenshotBuffer.toString('base64');
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
      // Add browser info to individual issue
      alert.browserUsed = options.browser;
      const filename = String(issueCounter).padStart(9, '0') + '.json';

      // Create a clean copy for JSON output (exclude heavy base64 data)
      const alertForJson = { ...alert };
      delete alertForJson.screenshotData;

      await fs.writeJson(path.join(issuesDir, filename), alertForJson, {
        spaces: 2,
      });
    }

    // Write Summary
    const summary = {
      runId,
      url,
      timestamp: new Date().toISOString(),
      browserUsed: options.browser,
      totalPages: 1,
      totalAlerts: allAlerts.length,
      severityBreakdown,
      modulesScanned,
      linksListTable,
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

    // CSV Output
    if (options.csv) {
      if (options.verbose) console.log(chalk.gray('Generating CSV...'));
      await generateCSV(allAlerts, path.join(runDir, 'alerts.csv'));
    }

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
