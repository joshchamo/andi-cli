import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function injectAndi(page) {
  const andiPath = path.resolve(__dirname, '../thirdparty/andi.js');

  try {
    await page.addScriptTag({ path: andiPath });

    // Wait for ANDI to initialize (the bar appearing)
    await page.waitForSelector('#ANDI508', {
      state: 'attached',
      timeout: 15000,
    });

    // Wait for the initial loading to finish (for the default module)
    await page.waitForSelector('#ANDI508-loading', {
      state: 'hidden',
      timeout: 15000,
    });

    // Inject helper functions
    await injectHelpers(page);

    return true;
  } catch (error) {
    console.error('Error injecting ANDI:', error.message);
    return false;
  }
}

async function injectHelpers(page) {
  await page.evaluate(() => {
    window.__ANDI_selectModuleById = (id) => {
      const targetBtn = document.getElementById(id);
      if (targetBtn) {
        // ANDI uses mousedown for some handlers to avoid conflicts
        const mouseDownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        targetBtn.dispatchEvent(mouseDownEvent);

        // Also click just in case
        targetBtn.click();
        return true;
      }
      return false;
    };

    window.__ANDI_selectModuleByName = async (name) => {
      // Normalize name for comparison
      const targetName = name.toLowerCase().trim();

      // 1. Ensure menu is open if needed
      // Logic from ANDI source: hovering or focusing #ANDI508-moduleMenu shows it.
      // We can also click a specific button if we know the ID, but we want to be generic.
      // But we can try to find the button by text.

      const menuContainer = document.querySelector('#ANDI508-moduleMenu');
      if (!menuContainer) throw new Error('ANDI Menu not found');

      // Force menu open style just in case (though we might not need to if we click hidden buttons? Playwright can click hidden? No, needs force:true)
      menuContainer.classList.add('ANDI508-moduleMenu-expanded');

      // 2. Find the button
      const buttons = Array.from(menuContainer.querySelectorAll('button'));
      let targetBtn = buttons.find((b) =>
        b.textContent.toLowerCase().includes(targetName)
      );

      if (!targetBtn) {
        // Try alternate mapping or strategies
        if (targetName.includes('link'))
          targetBtn = buttons.find((b) =>
            b.textContent.toLowerCase().includes('links')
          );
        if (targetName.includes('structure'))
          targetBtn = buttons.find((b) =>
            b.textContent.toLowerCase().includes('structures')
          );
        if (targetName.includes('image'))
          targetBtn = buttons.find((b) =>
            b.textContent.toLowerCase().includes('graphics')
          );
        if (targetName.includes('color'))
          targetBtn = buttons.find((b) =>
            b.textContent.toLowerCase().includes('contrast')
          );
      }

      if (targetBtn) {
        targetBtn.click();
        return true;
      }

      console.warn(`Could not find module button for: ${name}`);
      return false;
    };
  });
}
