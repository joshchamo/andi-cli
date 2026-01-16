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
        const getBestSelector = (el, $el) => {
          // Tier 0: The Absolute Unique (ID)
          const id = $el.attr('id');
          if (id && id.trim().length > 0) {
            return `#${id.trim()}`;
          }

          // Tier 1: Testing & Unique Attributes (data-testid / name)
          const testId = $el.attr('data-testid');
          if (testId && testId.trim().length > 0) {
            return `[data-testid="${testId.trim()}"]`;
          }
          const nameAttr = $el.attr('name');
          if (
            nameAttr &&
            nameAttr.trim().length > 0 &&
            !/viewport|generator|robots/i.test(nameAttr)
          ) {
            const tagName = el.tagName.toLowerCase();
            return `${tagName}[name="${nameAttr.trim()}"]`;
          }

          // Shared Logic: Clean Class List
          // Filter out: >3 digits, auto-generated (hash-like), utility classes
          const rawClass = $el.attr('class') || '';
          const classes = rawClass
            .split(/\s+/)
            .filter((c) => !c.startsWith('ANDI508-') && c.trim().length > 0)
            .filter((c) => {
              // 1. More than 3 digits?
              const digitCount = (c.match(/\d/g) || []).length;
              if (digitCount > 3) return false;
              // 2. Auto-generated hashes (heuristic: >30 chars)
              if (c.length > 30) return false;

              // 3. Modifiers and arbitrary values (colon, brackets, negatives)
              // Common in Tailwind: dark:, hover:, text-[#123], -translate-x
              if (c.includes(':') || c.includes('[') || c.startsWith('-'))
                return false;

              // 4. Utility-only check (common list)
              const utilityPrefixes = [
                'flex',
                'grid',
                'block',
                'inline',
                'hidden',
                'visible',
                'invisible',
                'text-',
                'bg-',
                'p-',
                'm-',
                'w-',
                'h-',
                'min-w-',
                'min-h-',
                'max-w-',
                'max-h-',
                'items-',
                'justify-',
                'content-',
                'self-',
                'order-',
                'gap-',
                'border',
                'rounded',
                'obj-',
                'overflow-',
                'absolute',
                'relative',
                'fixed',
                'sticky',
                'static',
                'top-',
                'left-',
                'right-',
                'bottom-',
                'z-',
                'translate',
                'transform',
                'transition',
                'duration',
                'ease',
                'delay',
                'rotate',
                'scale',
                'origin',
                'cursor',
                'pointer',
                'select',
                'resize',
                'shadow',
                'ring',
                'outline',
                'font-',
                'leading-',
                'tracking-',
                'align-',
                'whitespace-',
                'opacity',
                'list-',
                'table',
                'isolate',
              ];
              // Check strict prefix or exact match
              if (utilityPrefixes.some((p) => c.toLowerCase().startsWith(p)))
                return false;
              if (
                [
                  'container',
                  'wrapper',
                  'fluid',
                  'clearfix',
                  'row',
                  'col',
                ].includes(c.toLowerCase())
              )
                return false;
              return true;
            });

          // Tier 2: The "Label Combo" (High Specificity)
          // Rule: <tag>.<class>[<attribute>="<value>"]
          // Attributes: aria-label, title, placeholder
          if (classes.length > 0) {
            const bestClass = classes[0]; // First valid class
            const labelAttrs = ['aria-label', 'title', 'placeholder'];
            for (const attr of labelAttrs) {
              const val = $el.attr(attr);
              if (val && val.trim().length > 0) {
                if (/track|analytics|_sp|metric/i.test(val)) continue;
                // Escape double quotes in value
                const safeVal = val.replace(/"/g, '\\"');
                const tagName = el.tagName.toLowerCase();
                // User Example uses *= (contains)
                return `${tagName}.${bestClass}[${attr}*="${safeVal}"]`;
              }
            }
          }

          // Tier 3: The "Nested Content" (Pseudo-selectors)
          // Use :has() if top-level is generic but contains unique child
          // 1. Child with ID
          const childWithId = $el.find('[id]:not([id^="ANDI508-"])').first();
          if (childWithId.length > 0) {
            const cId = childWithId.attr('id');
            let baseSelector =
              classes.length > 0 ? `.${classes[0]}` : el.tagName.toLowerCase();
            return `${baseSelector}:has(#${cId})`;
          }
          // 2. Child with unique aria-label
          const childWithLabel = $el.find('[aria-label]').first();
          if (childWithLabel.length > 0) {
            const label = childWithLabel.attr('aria-label');
            if (
              label &&
              label.length < 50 &&
              !/track|analytics|_sp|metric/i.test(label)
            ) {
              let baseSelector =
                classes.length > 0
                  ? `.${classes[0]}`
                  : el.tagName.toLowerCase();
              const cTag = childWithLabel[0].tagName.toLowerCase();
              const safeLabel = label.replace(/"/g, '\\"');
              return `${baseSelector}:has(${cTag}[aria-label="${safeLabel}"])`;
            }
          }

          // Tier 4: Refined Class Filtering
          // Rule: Combine up to 3 descriptive classes.
          if (classes.length > 0) {
            const tag = el.tagName.toLowerCase();
            return `${tag}.${classes.slice(0, 3).join('.')}`;
          }

          // Tier 5: Attribute Only (Fall-back)
          const fallbackAttrs = ['aria-label', 'role', 'type', 'value'];
          for (const attr of fallbackAttrs) {
            const val = $el.attr(attr);
            if (val && val.trim().length > 0) {
              if (
                /track|analytics|_sp|metric/i.test(attr) ||
                /track|analytics|_sp|metric/i.test(val)
              ) {
                continue;
              }
              const tagName = el.tagName.toLowerCase();
              // Escape double quotes in value
              const safeVal = val.replace(/"/g, '\\"');
              return `${tagName}[${attr}="${safeVal}"]`;
            }
          }

          // Absolute Fallback
          return el.tagName.toLowerCase();
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
                const bestSelector = getBestSelector(domEl, el);

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
