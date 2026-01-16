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
        // --- bestSelector Generator Logic ---
        const getBestSelector = (el) => {
          // Rule: Max Length Safety Valve
          const MAX_LENGTH = 100;

          // 0. Helper: Native CSS Escaping with Polyfill Fallback
          // We prioritize CSS.escape if available for 100% accuracy.
          const escape = (str) => {
            if (window.CSS && window.CSS.escape) {
              return window.CSS.escape(str);
            }
            // Fallback for older environments
            return str.replace(/([:\[\].#])/g, '\\$1');
          };

          // 1. Gold Standard: ID
          if (el.id) {
            return `#${escape(el.id)}`;
          }

          // 2. A11y & Test Identifiers (Native Escaping)
          // We test uniqueness immediately.
          const uniqueAttrs = ['data-testid', 'aria-label', 'name'];
          for (const attr of uniqueAttrs) {
            const val = el.getAttribute(attr);
            if (val) {
              const selector = `${el.tagName.toLowerCase()}[${attr}="${escape(val)}"]`;
              if (document.querySelectorAll(selector).length === 1) {
                return selector;
              }
            }
          }

          // 3. The "Structural Fallback" (GPS Coordinate)
          // Moves up the tree until it finds a unique path.
          // Uses :nth-of-type to differentiate siblings.
          let path = '';
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE) {
            let selector = node.nodeName.toLowerCase();
            if (node.id) {
              // Found an ID anchor, use it and stop climbing
              selector += '#' + escape(node.id);
              path = selector + (path ? ' > ' + path : '');
              break;
            } else {
              // Calculate nth-of-type index
              let sibling = node;
              let nth = 1;
              while ((sibling = sibling.previousElementSibling)) {
                if (sibling.nodeName === node.nodeName) nth++;
              }
              // Add :nth-of-type only if strictly needed (not the only one of its type)
              // But to be safe and "GPS-like", if it has siblings of same type, we add it.
              // Logic check: does it have next siblings of same type?
              let hasNextSame = false;
              let nextParam = node.nextElementSibling;
              while (nextParam) {
                if (nextParam.nodeName === node.nodeName) {
                    hasNextSame = true;
                    break;
                }
                nextParam = nextParam.nextElementSibling;
              }
              
              if (nth > 1 || hasNextSame) {
                selector += `:nth-of-type(${nth})`;
              }
            }
            path = selector + (path ? ' > ' + path : '');
            
            // Verify uniqueness of the growing path
            // Because we are climbing up, the path becomes more specific.
            // If it hits exactly 1 element, we are done.
            // Optimization: checking document.querySelectorAll at every step is expensive vs just building the full path.
            // But the requirement is "Verify ... before being saved".
            // Let's check uniqueness now.
            if (document.querySelectorAll(path).length === 1) {
                break;
            }
            
            node = node.parentNode;
          }
          
          return path;
        };

        $('.ANDI508-element').each(function () {
          const el = $(this);
          const domEl = this; // Raw DOM element
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
                const helpUrl = div.querySelector('a')?.href || null;
                const groupId =
                  div.querySelector('a')?.getAttribute('data-andi-group') ||
                  null;

                const sig = `${severityMap[key]}|${alertMessage}`;
                elementAlertSignatures.add(sig);

                // SKIP capturing "extended details" via ANDI Inspector to keep JSON clean.
                // The user specifically requested removal of #ANDI508-accessibleComponentsTableContainer etc.
                const finalDetails = ''; // or alertContent if we want the redundancy

                // Calculate bestSelector
                const bestSelector = getBestSelector(domEl);

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
                  helpUrl: helpUrl, // Capture HELP URL for mapping
                  groupId: groupId,
                  alertDetails: finalDetails,
                  elementTag: el.prop('tagName').toLowerCase(),
                  elementId: el.attr('id') || '',
                  andiElementIndex: el.attr('data-andi508-index'),
                  bestSelector: bestSelector,
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
                const groupId =
                  div.querySelector('a')?.getAttribute('data-andi-group') ||
                  null;
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
                    groupId: groupId,
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

        // Alerts: Contains images with alt text + visual text (often wrapped in links)
        const alertCell = cells[1];
        const alerts = [];

        if (alertCell) {
          // 1. Try to find alert links (most common for warnings/dangers)
          const validLinks = Array.from(alertCell.querySelectorAll('a')).filter(
            (a) => a.href && (a.querySelector('img') || a.innerText.trim())
          );

          if (validLinks.length > 0) {
            validLinks.forEach((a) => {
              const img = a.querySelector('img');
              const text = a.innerText.trim();
              const alt = img ? img.title || img.alt : '';
              // Prefer Image Alt/Title, then Text
              let message = alt;
              if (text && !message) message = text;
              if (text && message && text !== message) message += ` (${text})`;
              if (!message) message = 'Alert';

              alerts.push({ message, url: a.href });
            });
          } else {
            // 2. Fallback: No links, just images or text
            const imgs = Array.from(alertCell.querySelectorAll('img'));
            if (imgs.length > 0) {
              imgs.forEach((img) => {
                const msg = img.title || img.alt || 'Alert';
                alerts.push({ message: msg, url: null });
              });
            }

            // Check for potential loose text if not covered above
            const looseText = alertCell.innerText.trim();
            if (looseText && alerts.length === 0) {
              alerts.push({ message: looseText, url: null });
            }
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
