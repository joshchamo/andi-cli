export async function extractAlerts(page, moduleName) {
  try {
    const alerts = await page.evaluate((modName) => {
      // Basic check: if ANDI isn't here, skip this frame
      if (!window.andiAlerter && !window.jQuery && !window.$) {
        return [];
      }

      const results = [];
      const $ = window.jQuery || window.$;

      const elementAlertSignatures = new Set(); // To avoid dupes between Element and Global

      // 1. Element-Level Alerts (requires jQuery as ANDI uses it)
      if ($) {
        $('.ANDI508-element').each(function () {
          const el = $(this);
          const data = el.data('andi508');

          if (!data) return;

          const severityMap = {
            dangers: 'Danger',
            warnings: 'Warning',
            cautions: 'Caution',
          };

          Object.keys(severityMap).forEach((key) => {
            if (data[key] && data[key].length > 0) {
              data[key].forEach((alertContent) => {
                // alertContent is typically HTML.
                // We need to parse it to text.
                const div = document.createElement('div');
                div.innerHTML = alertContent;

                // Extract text, handling some common ANDI markup if needed
                const alertMessage = div.innerText.trim();

                const sig = `${severityMap[key]}|${alertMessage}`;
                elementAlertSignatures.add(sig);

                // Attempt to capture extended details via ANDI Inspector
                let extendedDetails = '';
                try {
                  if (
                    window.AndiModule &&
                    typeof window.AndiModule.inspect === 'function'
                  ) {
                    window.AndiModule.inspect(el);

                    // Dynamic search for detailed info (e.g., Contrast Ratio)
                    const container = $('#ANDI508');
                    // We look for text that changes based on inspection.
                    // For contrast, "Contrast Ratio" is a key indicator.
                    // For others, we might just grab the "Active Element" section.

                    // Strategy: Look for the 'accessible name' or 'output' container
                    const likelyContainers = [
                      '#ANDI508-additionalPage',
                      '#ANDI508-alertList',
                      '#ANDI508-elementDetails',
                    ];

                    for (const sel of likelyContainers) {
                      const c = $(sel);
                      // Strict length check can miss short but critical output like "Active Element"
                      // ANDI Output container is critical, so we check specifically for it
                      if (c.length) {
                        if (sel === '#ANDI508-elementDetails') {
                          // Capture HTML for Element Details to preserve styling/structure
                          // We ensure meaningful content by checking if it contains the Output Container or Components Table
                          if (
                            c.find('#ANDI508-outputText').length ||
                            c.find('#ANDI508-accessibleComponentsTable').length
                          ) {
                            // Clone to modify structure without affecting live page
                            const clone = c.clone();
                            // Remove redundant element name info (tag/id) as we show this in the report column
                            clone
                              .find('#ANDI508-elementNameContainer')
                              .remove();
                            // Remove empty additional details if legitimate empty
                            if (
                              clone
                                .find('#ANDI508-additionalElementDetails')
                                .text()
                                .trim().length === 0
                            ) {
                              clone
                                .find('#ANDI508-additionalElementDetails')
                                .remove();
                            }

                            let html = clone.html();
                            extendedDetails += html + '\n';
                          }
                        } else if (c.text().trim().length > 0) {
                          // For other containers, capture if there is any text
                          extendedDetails += c.text().trim() + '\n';
                        }
                      }
                    }

                    // Specific check for Contrast Ratio if not found
                    if (
                      !extendedDetails.includes('Contrast Ratio') &&
                      modName === 'color contrast'
                    ) {
                      container.find('*').each(function () {
                        const t = $(this).text();
                        if (
                          t.includes('Contrast Ratio:') &&
                          $(this).children().length === 0
                        ) {
                          // Found a leaf node or close to it
                          extendedDetails += $(this).parent().text().trim(); // Capture context
                        }
                      });
                    }
                  }
                } catch (e) {}

                const finalDetails =
                  extendedDetails &&
                  extendedDetails.length > alertMessage.length
                    ? extendedDetails
                    : alertContent;

                // Create Clean Snippet
                let cleanSnippet = el.prop('outerHTML');
                try {
                  const clone = el.clone();
                  // Strip ANDI classes
                  const currentClasses = clone.attr('class') || '';
                  const newClasses = currentClasses
                    .split(/\s+/)
                    .filter((c) => !c.startsWith('ANDI508-'))
                    .join(' ');
                  if (newClasses) clone.attr('class', newClasses);
                  else clone.removeAttr('class');

                  // Strip ANDI attributes
                  const rawNode = clone[0];
                  if (rawNode.attributes) {
                    for (let i = rawNode.attributes.length - 1; i >= 0; i--) {
                      const name = rawNode.attributes[i].name;
                      if (name.startsWith('data-andi508')) {
                        rawNode.removeAttribute(name);
                      }
                    }
                  }
                  cleanSnippet = clone.prop('outerHTML');
                } catch (e) {
                  /* fallback */
                }

                results.push({
                  andiModule: modName,
                  severity: severityMap[key],
                  alertMessage: alertMessage,
                  alertDetails: finalDetails,
                  elementTag: el.prop('tagName').toLowerCase(),
                  elementId: el.attr('id') || '',
                  andiElementIndex: el.attr('data-andi508-index'),
                  elementSnippet: cleanSnippet.substring(0, 1000),
                  tt_mapping: '',
                });
              });
            }
          });
        });
      }

      // --- Global / Page Level Alerts ---
      // Attempt to capture alerts from window.andiAlerter buffers
      if (window.andiAlerter) {
        const severityMap = {
          dangers: 'Danger',
          warnings: 'Warning',
          cautions: 'Caution',
        };

        // Helper to extract text from an ANDI alert item
        const getAlertText = (item) => {
          if (typeof item === 'string') return item;
          // Sometimes it's an object with a message property
          if (item && item.message) return item.message;
          // Sometimes it might be a jquery object or node, but usually global alerts are structured differently.
          return null;
        };

        Object.keys(severityMap).forEach((key) => {
          const list = window.andiAlerter[key];
          if (Array.isArray(list)) {
            list.forEach((item) => {
              // If it's a DOM node (Element), we likely caught it in the .ANDI508-element loop
              // UNLESS it wasn't marked with the class yet or is a special case.
              // However, we are looking for global strings.
              let msg = getAlertText(item);

              if (msg) {
                // Normalize message same as Element loop
                const div = document.createElement('div');
                div.innerHTML = msg;
                msg = div.innerText.trim();

                // Check strict element signature first
                // Use ELEMENT prefix because we want to exclude things found on elements
                // Actually, we should check if this textual message was captured on ANY element
                // So we need to store just the message+severity in the Set, not "ELEMENT|..."
                // Logic correction: The Set stores "SEVERITY|MESSAGE".

                const sig = `${severityMap[key]}|${msg}`;

                // Filter out summary lines like "Link Alerts: (4)"
                if (/Alerts:\s*\(\d+\)$/i.test(msg)) {
                  return;
                }

                if (!elementAlertSignatures.has(sig)) {
                  elementAlertSignatures.add(sig); // Prevent duplicate globals
                  results.push({
                    andiModule: modName,
                    severity: severityMap[key],
                    alertMessage: msg,
                    alertDetails: item.toString(), // Keep original for details
                    elementTag: 'PAGE',
                    elementId: '',
                    andiElementIndex: '',
                    elementSnippet: '',
                    tt_mapping: '',
                  });
                }
              }
            });
          }
        });
      }

      return results;
    }, moduleName);

    return alerts || [];
  } catch (error) {
    console.warn(`Extraction failed for ${moduleName}:`, error.message);
    return [];
  }
}

/**
 * Extracts the "Links List" table from ANDI if available (only for Links module).
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{index: string, alerts: string, name: string, href: string}>>}
 */
export async function extractLinksList(page) {
  try {
    const linksData = await page.evaluate(async () => {
      // Find 'view links list' button
      const buttons = Array.from(
        document.querySelectorAll(
          '#andiBar button, #ANDI508-additionalPageResults button'
        )
      );
      const listBtn = buttons.find((b) =>
        b.innerText.toLowerCase().includes('view links list')
      );

      if (!listBtn) return null;

      // Click it to reveal the table if not already expanded
      // The button class changes or aria-expanded changes?
      // "ANDI508-viewOtherResults-button-expanded" class means it is open.
      if (
        !listBtn.classList.contains('ANDI508-viewOtherResults-button-expanded')
      ) {
        listBtn.click();
        // Wait for table to appear
        const waitFor = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 30; i++) {
          // wait up to 3s
          const table = document.getElementById('ANDI508-viewList-table');
          if (table && table.offsetWidth > 0) break;
          await waitFor(100);
        }
      }

      const table = document.getElementById('ANDI508-viewList-table');
      if (!table) return null;

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      return rows.map((tr) => {
        const cells = tr.querySelectorAll('td, th');
        // Structure: 0:Index, 1:Alerts, 2:Name, 3:Href

        const index = cells[0]?.innerText?.trim() || '';

        // Alerts: Contains images with alt text + visual text
        const alertCell = cells[1];
        let alerts = '';
        if (alertCell) {
          const imgs = Array.from(alertCell.querySelectorAll('img'));
          const text = alertCell.innerText.trim();
          const titles = imgs
            .map((img) => img.title || img.alt)
            .filter(Boolean);
          // If titles exist, combine them.
          if (titles.length > 0) {
            alerts = titles.join('; ') + (text ? ' (' + text + ')' : '');
          } else {
            alerts = text;
          }
        }

        const name = cells[2]?.innerText?.trim() || '';

        // Href Cell: Extract displayed text (could be relative) AND resolved full URL
        const hrefCell = cells[3];
        const href = hrefCell?.innerText?.trim() || '';
        const anchor = hrefCell?.querySelector('a');
        let resolvedUrl = href; // fallback to text

        if (anchor && anchor.href) {
          // anchor.href returns the resolved absolute URL in browsers
          resolvedUrl = anchor.href;
        } else if (
          href &&
          !href.startsWith('http') &&
          !href.startsWith('//') &&
          !href.startsWith('mailto:')
        ) {
          // Attempt manual resolution just in case, though anchor.href is safer
          try {
            resolvedUrl = new URL(href, document.baseURI).href;
          } catch (e) {}
        }

        return { index, alerts, name, href, resolvedUrl };
      });
    });

    return linksData;
  } catch (e) {
    console.warn('Error extracting Links List table:', e.message);
    return null;
  }
}
