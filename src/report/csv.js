import fs from 'fs-extra';

/**
 * Generates a simple CSV file from the alerts array.
 * @param {Array} alerts - The list of alert objects
 * @param {string} outputPath - Path to write the CSV file
 */
export async function generateCSV(alerts, outputPath) {
  if (!alerts || alerts.length === 0) {
    return;
  }

  const headers = [
    'Module',
    'Severity',
    'Message',
    'Tag',
    'ID',
    'Index',
    'Details',
    'Snippet',
    'Browser',
  ];

  // Helper to escape fields for CSV (handle quotes, commas, newlines)
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const stringVal = String(val);
    if (
      stringVal.includes(',') ||
      stringVal.includes('"') ||
      stringVal.includes('\n') ||
      stringVal.includes('\r')
    ) {
      // Wrap in quotes and escape internal quotes by doubling them
      return `"${stringVal.replace(/"/g, '""')}"`;
    }
    return stringVal;
  };

  const rows = alerts.map((a) => {
    return [
      escapeCsv(a.andiModule),
      escapeCsv(a.severity),
      escapeCsv(a.alertMessage),
      escapeCsv(a.elementTag),
      escapeCsv(a.elementId),
      escapeCsv(a.andiElementIndex),
      escapeCsv(a.alertDetails),
      escapeCsv(a.elementSnippet),
      escapeCsv(a.browserUsed),
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  await fs.outputFile(outputPath, csvContent);
}
