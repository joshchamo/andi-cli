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

  const html = template({
    summary: summary,
    issues: sortedAlerts,
  });

  await fs.outputFile(outputPath, html);
  return outputPath;
}
