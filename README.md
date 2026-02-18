# CR Hotel Itemizer Extension (MV3, no bundler)

This repository contains a Chrome Extension that can be loaded via **Load unpacked** and assists with hotel itemization workflow on Chrome River-style parent expense pages.

## Folder layout

- `extension/` - extension source (manifest, popup, options, service worker, content script, vendor parser shim files)
- `mock/mock_expense_page.html` - demo page for automation testing
- `mock/mock_folio.pdf` - sample folio PDF for parser testing
- `docs/test-plan.md` - manual test plan and acceptance checks

## Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder

## Required workflow sequence implemented

1. Open a parent expense page (or mock page).
2. Click extension icon.
3. Upload folio PDF.
4. Click **Analyze PDF** to create day/type grouped itemization plan.
5. Click **Run Itemization**.
6. Overlay displays `Run / Pause / Stop` and live step log.
7. Extension clicks **Itemize**, enters itemizations by date + type + amount, and reconciles against parent **Spent**.
8. On mismatch beyond tolerance: extension stops and shows mismatch screen.
9. On success: extension stops and highlights **Done/Save** button.
10. User must click **Done/Save manually**.

## Calibration mode

- In popup, click **Calibration Mode**.
- On page, click target element.
- Provide selector key (`transactionDate`, `amountInput`, `itemizeButton`, etc.) in prompt.
- Selector is saved to `chrome.storage.sync.selectorOverrides` and used before default locator strategies.

## Notes

- No external bundler/build step required.
- Host permissions include sample Chrome River domain patterns and localhost mock usage.
- OCR fallback is intentionally omitted.
