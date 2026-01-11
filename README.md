# ANDI Scan CLI

ANDI Scan is a Node.js CLI tool that automates the [ANDI](https://github.com/SSAgov/ANDI) accessibility testing tool using Playwright. It injects ANDI into a target webpage, cycles through all analysis modules, and generates a comprehensive report of accessibility alerts.

## Features

- **Automated Injection**: Injects the official ANDI bookmarklet script.
- **Full Coverage**: Scans all 8 ANDI modules (Focusable Elements, Graphics, Links, Tables, Structures, Color Contrast, Hidden Content, Iframes).
- **Links List**: Automatically captures the "Links List" table from the Links/Buttons module, including accessibility properties and clickable resolved URLs.
- **Report Generation**: 
  - **Polished HTML**: Uses Handlebars templating with sortable columns, copyable code snippets, and collapsible details.
  - **CSV Output**: Optional CSV export for data analysis.
  - **JSON**: Full raw data export.
- **Cross-Browser**: Supports Chromium, Firefox, and WebKit.
- **Screenshots**: Optionally captures screenshots of failing elements and provides direct links in the report.

## Installation

1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Install Playwright browsers:
   ```bash
   npx playwright install
   ```

## Usage

**Quick Start via NPM:**

```bash
npm start -- https://example.com
```

**Using NPX (No installation required):**

```bash
npx . https://example.com
```

**Running from source:**

```bash
node ./bin/andi-scan.js https://example.com
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-b, --browser <name>` | Browser to use: `chromium`, `firefox`, `webkit`. | `chromium` |
| `-o, --out <path>` | Output directory for reports. | `./runs` |
| `--csv` | Generate a CSV summary report. | `false` |
| `-s, --screenshots` | Enable taking screenshots of alerted elements. | `false` |
| `--headed` | Run the browser in headed mode (visible UI). | `false` |

### Examples

**Basic Scan:**
```bash
node ./bin/andi-scan.js https://broken-workshop.dequelabs.com/
```

**Generate CSV and use Firefox:**
```bash
node ./bin/andi-scan.js https://broken-workshop.dequelabs.com/ --browser firefox --csv
```

**Run with screenshots and store in custom folder:**
```bash
node ./bin/andi-scan.js https://jsonlint.com --screenshots --out ./my-reports
```

**Debug Mode (Headed):**
```bash
node ./bin/andi-scan.js https://example.com --headed
```

## Output Structure

The tool creates a timestamped folder for each run in the output directory:

```
runs/
  example-com_2026-01-06T12-00-00/
    SUMMARY.json           # Run metadata and stats
    report-....html        # Human-readable HTML report
    issues/                # Individual JSON files for each alert
      000000001.json
      ...
    screenshots/           # Screenshots (if enabled)
      1.png
      ...
```

## Development

- **Source Structure**:
  - `bin/andi-scan.js`: CLI entry point.
  - `src/index.js`: Main orchestration logic.
  - `src/browser.js`: Playwright configuration.
  - `src/andi-inject.js`: Script injection and helper utilities.
  - `src/extractors/`: Logic to extract alerts from the ANDI UI/DOM.
  - `src/andi-alerts-map.js`: Static dictionary of ANDI Alert messages mapped to their official SSA help documentation URLs. Used to ensure consistently clickable links in reports.
  - `src/report/`: Handlebars templates and rendering logic.
    - `src/report/report.css`: The main stylesheet for the HTML report. Users can customize this file to change the report's appearance.
  - `thirdparty/`: Contains the `andi.js` script.

- **Tuning Selectors**:
  If ANDI module selection fails, check `src/andi-inject.js` `injectHelpers` function where the `window.__ANDI_selectModuleByName` function is defined. This uses text matching on the ANDI menu buttons.

## Troubleshooting

- **CSP Errors**: If the site blocks script injection, `andi-scan` will log an error. Try running with `--headed` to see if the browser console provides more info. The tool attempts to bypass CSP using Playwright's `bypassCSP: true`.
- **Timeouts**: If a module takes too long to load, the tool will skip it and proceed to the next one.
