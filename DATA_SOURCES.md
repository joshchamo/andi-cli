# ANDI CLI Data Sources & Dictionary

This document explains the data model used by the ANDI CLI tool, clarifying exactly where data is extracted from the injected ANDI instance and how it maps to the JSON output field.

## Data Extraction Overview

The CLI injects the official ANDI script (from SSA.gov) into the page context. It then orchestrates the scanning modules and extracts data from two primary sources:
1. **DOM Elements**: Modified by ANDI with specific classes (`.ANDI508-element`) and data attributes.
2. **ANDI JavaScript Objects**: Specifically `window.andiAlerter` for global page alerts and `window.AndiModule` for inspecting individual elements.

## Field Dictionary

The following fields are present in the `issues/*.json` files generated for every alert found.

### 1. `andiModule`
- **Description**: The specific ANDI module active when the alert was found.
- **Source**: Passed directly from the CLI runner loop.
- **Enum Values**: `links/buttons`, `graphics/images`, `focusable elements`, `tables`, `structures`, `color contrast`, `hidden content`, `iframes`.

### 2. `severity`
- **Description**: The classification of the accessibility issue.
- **Source**: Derived from the keys in the jQuery data object attached to the element (`$(el).data('andi508')`).
- **Mapping**:
  - `dangers` array → `"Danger"`
  - `warnings` array → `"Warning"`
  - `cautions` array → `"Caution"`

### 3. `alertMessage`
- **Description**: The text summary of the issue.
- **Source**:
  - **For Elements**: The inner text of the HTML string found in the `dangers`/`warnings`/`cautions` array inside the element's ANDI data.
  - **For Page/Global**: Extracted from `window.andiAlerter[severity]` arrays.
- **Processing**: HTML tags are stripped to provide a clean text representation for sorting and display.

### 4. `alertDetails` (The "ANDI Output")
- **Description**: The rich, visual output that ANDI typically displays in its top bar (the "Active Element" inspection area). This field contains HTML.
- **Source**: 
  - The CLI triggers `window.AndiModule.inspect(element)` to force ANDI to populate its "Active Element Inspector".
  - It then extracts the Inner HTML of the DOM element `#ANDI508-elementDetails`.
- **Filtering**:
  - **Inclusions**: Only captures if `#ANDI508-outputText` or `#ANDI508-accessibleComponentsTable` exists.
  - **Exclusions**: 
    - Removes `#ANDI508-elementNameContainer` (the tag name display) to avoid redundancy.
    - Removes empty `#ANDI508-additionalElementDetails`.
- **Styling**: The HTML classes are preserved (`ANDI508-display-danger`, etc.) and re-styled in the report using the dark theme CSS.

### 5. `elementTag`
- **Description**: The HTML tag name of the element causing the alert.
- **Source**: `element.tagName` (lowercased).
- **Special Values**: `"PAGE"` for global alerts not tied to a specific DOM node.

### 6. `elementId`
- **Description**: The DOM ID of the element.
- **Source**: `element.prop('id')` or empty string if null.

### 7. `andiElementIndex`
- **Description**: Internal index used by ANDI to reference elements on the page.
- **Source**: The `data-andi508-index` attribute injected into the DOM by ANDI.

### 8. `elementSnippet`
- **Description**: A sanitized HTML representation of the element.
- **Source**: `element.outerHTML`.
- **Sanitization**:
  - Removes all CSS classes starting with `ANDI508-` (visual highlighting artifacts).
  - Removes all attributes starting with `data-andi508` (internal ANDI data).
  - Truncated to 1000 characters to prevent massive reports for complex elements.

### 9. `tt_mapping`
- **Description**: Placeholder for Trusted Tester methodology mapping (Future Feature).
- **Current Value**: Always `""`.

## Data Extraction Logic Flow

1. **Injection**: `andi-scan.js` injects the ANDI bookmarklet scripts.
2. **Identification**: The script waits for `window.andiAlerter` and jQuery.
3. **Iteration**:
   - Finds all elements with class `.ANDI508-element`.
   - Reads the `.data('andi508')` object attached by ANDI.
4. **Inspection**:
   - For every alert found on an element, the script calls `window.AndiModule.inspect(element)`.
   - This "fakes" a user clicking the element, causing ANDI to render the detailed "ANDI Output" into the DOM (`#ANDI508`).
   - The CLI then "scrapes" that rendered HTML immediately.
5. **Global Fallback**:
   - After element scanning, checks `window.andiAlerter` for global page-level issues (e.g., "Page title is missing").

## Report HTML Generation
The `report-*.html` file is generated using Handlebars (`src/report/template.hbs`) which consumes the JSON data described above.
- **Alert Colors**: CSS classes match the `severity` field.
- **Dark Theme**: Applied via CSS in the template, overriding ANDI's default white/light styling while preserving the critical syntax highlighting colors (Green for passing, Red for danger, etc.).
