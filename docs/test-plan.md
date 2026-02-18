# Test Plan - CR Hotel Itemizer Extension

## 1) Installation test

- Open `chrome://extensions`
- Load unpacked `extension/`
- Verify no manifest/runtime load errors.

## 2) Mock page automation success path

1. Open `mock/mock_expense_page.html` in Chrome.
2. Open extension popup.
3. Upload `mock/mock_folio.pdf`.
4. Click **Analyze PDF**.
5. Confirm plan preview contains at least 6 grouped rows.
6. Click **Run Itemization**.
7. Observe overlay logs each step.
8. Confirm `Itemizations` list increments to 6+ entries.
9. Confirm extension stops and highlights **Done** button.
10. Confirm extension never clicks **Done** automatically.

## 3) Mismatch behavior

1. Change mock `Spent` input to a value that differs by more than tolerance.
2. Run automation again.
3. Confirm mismatch modal appears and workflow stops.

## 4) Pause/Stop behavior

1. Start automation.
2. Press **Pause** from overlay or popup.
3. Confirm steps halt.
4. Press **Resume** and verify continuation.
5. Press **Stop** and verify immediate halt.

## 5) Calibration override behavior

1. Start calibration from popup.
2. Click target input in page.
3. Save key name in prompt.
4. Verify `options` page reflects selector override JSON.
5. Re-run automation and confirm override is used.

## 6) Negative/payment handling

- Use sample PDF containing `Visa Payment` negative line.
- Confirm line excluded from plan and shown in parse preview as excluded/negative.

