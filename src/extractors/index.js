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
                      if (c.length && c.text().trim().length > 5) {
                        if (sel === '#ANDI508-elementDetails') {
                          // Capture HTML for Element Details to preserve styling/structure
                          // We also want to treat the ANDI Output spans as blocks for readability
                          let html = c.html();
                          // Optional: Remove IDs to prevent duplicates in the final report? 
                          // For now, raw HTML is better than text-smash.
                          extendedDetails += html + '\n';
                        } else {
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
