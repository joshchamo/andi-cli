import Handlebars from 'handlebars';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateReport(summary, alerts, outputPath) {
  const templateSource = await fs.readFile(
    path.join(__dirname, 'template.hbs'),
    'utf8'
  );

  // Load CSS
  const css = await fs.readFile(path.join(__dirname, 'report.css'), 'utf8');

  // Load and encode the ANDI Output icon
  let andiOutputIconBase64 = '';
  try {
    const iconPath = path.join(__dirname, '../icons/output.png');
    const iconBuffer = await fs.readFile(iconPath);
    andiOutputIconBase64 = `data:image/png;base64,${iconBuffer.toString(
      'base64'
    )}`;
  } catch (e) {
    console.warn('Warning: Could not load ANDI output icon:', e.message);
  }

  const template = Handlebars.compile(templateSource);

  // Register 'eq' helper
  Handlebars.registerHelper('eq', function (a, b) {
    return a === b;
  });

  // Sort alerts by severity (Danger first)
  const severityOrder = { Danger: 0, Warning: 1, Caution: 2 };
  const sortedAlerts = [...alerts].sort((a, b) => {
    return (
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
    );
  });

  // Inject the ANDI Output icon into the HTML content of alerts if available.
  // We place it strictly inside #ANDI508-outputText to match the "darker area".
  if (andiOutputIconBase64) {
    const iconHtml = `<img src="${andiOutputIconBase64}" class="andi-output-icon" alt="" />`;
    sortedAlerts.forEach((alert) => {
      if (
        alert.alertDetails &&
        alert.alertDetails.includes('id="ANDI508-outputText"')
      ) {
        // Regex to find the opening tag of the output text container
        // It typically looks like: <div id="ANDI508-outputText" ... >
        alert.alertDetails = alert.alertDetails.replace(
          /(<div[^>]*id=["']ANDI508-outputText["'][^>]*>)/i,
          `$1${iconHtml}`
        );
      }
    });
  }

  const html = template({
    summary: summary,
    issues: sortedAlerts,
    css: css,
    // We no longer pass the icon separately as it is embedded in the alertDetails content
  });

  await fs.outputFile(outputPath, html);
  return outputPath;
}
