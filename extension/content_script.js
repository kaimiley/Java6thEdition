(() => {
  if (window.__crHotelItemizerLoaded) return;
  window.__crHotelItemizerLoaded = true;

  const state = {
    running: false,
    paused: false,
    stopped: false,
    currentStep: 0,
    plan: [],
    tolerance: 0.5,
    selectorOverrides: {},
    calibrationActive: false,
    calibrationHandler: null,
    logs: []
  };

  const overlay = buildOverlay();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg?.type) return;
    if (msg.type === 'START_AUTOMATION') {
      startAutomation(msg.payload).then(() => sendResponse({ ok: true })).catch((err) => {
        log(`Error: ${err.message}`);
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    if (msg.type === 'PAUSE_AUTOMATION') {
      state.paused = !state.paused;
      log(state.paused ? 'Paused.' : 'Resumed.');
      syncOverlayButtons();
      return;
    }
    if (msg.type === 'STOP_AUTOMATION') {
      stopAutomation('Stopped by user');
      return;
    }
    if (msg.type === 'START_CALIBRATION') {
      startCalibration();
      return;
    }
  });

  overlay.runBtn.addEventListener('click', () => {
    if (state.plan.length) {
      startAutomation({ plan: state.plan, tolerance: state.tolerance, rawLines: [], negativeLines: [] });
    } else {
      log('No plan loaded from popup yet.');
    }
  });
  overlay.pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    log(state.paused ? 'Paused.' : 'Resumed.');
    syncOverlayButtons();
  });
  overlay.stopBtn.addEventListener('click', () => stopAutomation('Stopped by overlay'));

  function buildOverlay() {
    const root = document.createElement('div');
    root.id = 'cr-itemizer-overlay';
    root.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#111;color:#fff;padding:10px;width:360px;border-radius:8px;font:12px Arial;box-shadow:0 2px 10px rgba(0,0,0,.4);';

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong>CR Itemizer</strong>
        <span id="cr-status">Idle</span>
      </div>
      <div style="display:flex;gap:6px;margin:8px 0;">
        <button id="cr-run">Run</button>
        <button id="cr-pause">Pause</button>
        <button id="cr-stop">Stop</button>
      </div>
      <div id="cr-log" style="max-height:180px;overflow:auto;background:#1f1f1f;padding:8px;border-radius:6px;"></div>
    `;

    document.documentElement.appendChild(root);
    const style = document.createElement('style');
    style.textContent = '#cr-itemizer-overlay button{cursor:pointer;border:none;padding:4px 8px;border-radius:4px;} #cr-itemizer-overlay button:hover{opacity:.9;}';
    document.documentElement.appendChild(style);

    return {
      root,
      status: root.querySelector('#cr-status'),
      log: root.querySelector('#cr-log'),
      runBtn: root.querySelector('#cr-run'),
      pauseBtn: root.querySelector('#cr-pause'),
      stopBtn: root.querySelector('#cr-stop')
    };
  }

  async function startAutomation(payload) {
    if (state.running) {
      log('Automation already running.');
      return;
    }
    const store = await chrome.storage.sync.get(['selectorOverrides']);
    state.selectorOverrides = store.selectorOverrides || {};
    state.plan = payload.plan || [];
    state.tolerance = Number(payload.tolerance || 0.5);

    state.running = true;
    state.paused = false;
    state.stopped = false;
    state.currentStep = 0;
    setStatus('Running');
    syncOverlayButtons();

    log(`Starting workflow with ${state.plan.length} grouped itemizations.`);
    const spentValue = await getParentSpentValue();
    log(`Parent Spent detected: ${spentValue.toFixed(2)}`);

    let totalEntered = 0;

    for (const row of state.plan) {
      await waitIfPausedOrStopped();
      log(`Processing ${row.posting_date} | ${row.type} | ${row.amount.toFixed(2)}`);
      await clickItemizeForDate(row.posting_date);
      await fillItemizationRow(row);
      totalEntered = round2(totalEntered + row.amount);
      log(`Running total entered: ${totalEntered.toFixed(2)}`);
      state.currentStep += 1;
    }

    const diff = Math.abs(round2(spentValue - totalEntered));
    log(`Reconciliation => spent=${spentValue.toFixed(2)} entered=${totalEntered.toFixed(2)} diff=${diff.toFixed(2)}`);

    if (diff > state.tolerance) {
      setStatus('Mismatch - Stopped');
      highlightMismatch(diff, spentValue, totalEntered);
      stopAutomation(`Mismatch exceeds tolerance (${state.tolerance}).`);
      return;
    }

    highlightDoneButton();
    stopAutomation('Success. Please click Done/Save manually.');
  }

  function stopAutomation(reason) {
    state.running = false;
    state.stopped = true;
    state.paused = false;
    setStatus('Stopped');
    syncOverlayButtons();
    log(reason);
  }

  function setStatus(text) {
    overlay.status.textContent = text;
  }

  function log(message) {
    const stamp = new Date().toISOString().slice(11, 19);
    state.logs.push(`[${stamp}] ${message}`);
    overlay.log.textContent = state.logs.slice(-200).join('\n');
    overlay.log.scrollTop = overlay.log.scrollHeight;
  }

  function syncOverlayButtons() {
    overlay.runBtn.disabled = state.running;
    overlay.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  }

  async function waitIfPausedOrStopped() {
    while (state.paused) {
      await sleep(250);
    }
    if (state.stopped) {
      throw new Error('Stopped');
    }
  }

  async function getParentSpentValue() {
    const spentInput = await findElementWithBackoff({
      key: 'spentInput',
      testIds: ['spent', 'parent-spent'],
      ariaLabels: ['Spent'],
      labels: ['Spent'],
      buttonTexts: []
    });
    const raw = spentInput?.value || spentInput?.textContent || '0';
    return parseMoney(raw);
  }

  async function clickItemizeForDate(dateStr) {
    const btn = await findElementWithBackoff({
      key: 'itemizeButton',
      testIds: ['itemize', 'itemize-button'],
      ariaLabels: ['Itemize'],
      labels: [],
      buttonTexts: ['Itemize']
    });
    btn.click();
    log(`Clicked Itemize for ${dateStr}`);
  }

  async function fillItemizationRow(row) {
    const dateInput = await findElementWithBackoff({
      key: 'transactionDate',
      testIds: ['transaction-date', 'itemization-date'],
      ariaLabels: ['Transaction Date'],
      labels: ['Transaction Date'],
      buttonTexts: []
    });
    setInputValue(dateInput, row.posting_date);

    const typeInput = await findElementWithBackoff({
      key: 'expenseType',
      testIds: ['expense-type', 'itemization-type'],
      ariaLabels: ['Expense Type', 'Type'],
      labels: ['Type', 'Expense Type'],
      buttonTexts: []
    });
    setInputValue(typeInput, row.type);

    const amountInput = await findElementWithBackoff({
      key: 'amountInput',
      testIds: ['amount', 'itemization-amount'],
      ariaLabels: ['Amount'],
      labels: ['Amount'],
      buttonTexts: []
    });
    setInputValue(amountInput, row.amount.toFixed(2));

    const addBtn = findButtonByText(['Add Itemization', 'Add', 'Apply']);
    if (addBtn) {
      addBtn.click();
      log('Clicked Add Itemization.');
    } else {
      log('No Add button found; values were entered only.');
    }
  }

  async function findElementWithBackoff(strategy) {
    if (state.selectorOverrides[strategy.key]) {
      const overrideMatch = document.querySelector(state.selectorOverrides[strategy.key]);
      if (overrideMatch) return overrideMatch;
    }

    const attempts = 6;
    for (let i = 0; i < attempts; i += 1) {
      const found =
        findByTestIdOrAria(strategy.testIds, strategy.ariaLabels) ||
        findByLabel(strategy.labels) ||
        findButtonByText(strategy.buttonTexts);

      if (found) return found;
      const delay = 200 * 2 ** i;
      log(`Waiting for ${strategy.key} (attempt ${i + 1}/${attempts})...`);
      await sleep(delay);
    }
    throw new Error(`Unable to find ${strategy.key}`);
  }

  function findByTestIdOrAria(testIds = [], ariaLabels = []) {
    for (const id of testIds) {
      const el = document.querySelector(`[data-testid="${cssEscape(id)}"]`);
      if (el) return el;
    }
    for (const a of ariaLabels) {
      const el = document.querySelector(`[aria-label="${cssEscape(a)}"]`);
      if (el) return el;
    }
    return null;
  }

  function findByLabel(labels = []) {
    for (const labelText of labels) {
      const labelsEls = Array.from(document.querySelectorAll('label'));
      const label = labelsEls.find((el) => el.textContent.trim().toLowerCase() === labelText.toLowerCase());
      if (!label) continue;
      const forId = label.getAttribute('for');
      if (forId) {
        const target = document.getElementById(forId);
        if (target) return target;
      }
      const nested = label.querySelector('input,textarea,select');
      if (nested) return nested;
    }
    return null;
  }

  function findButtonByText(texts = []) {
    if (!texts.length) return null;
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'));
    for (const t of texts) {
      const found = candidates.find((c) => ((c.innerText || c.value || '').trim().toLowerCase() === t.toLowerCase()));
      if (found) return found;
    }
    return null;
  }

  function setInputValue(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function highlightDoneButton() {
    const done = findButtonByText(['Done', 'Save']);
    if (done) {
      done.style.outline = '3px solid #16a34a';
      done.style.boxShadow = '0 0 0 4px rgba(22,163,74,.35)';
      done.scrollIntoView({ behavior: 'smooth', block: 'center' });
      log('Done/Save button highlighted. Manual click required.');
    } else {
      log('Done/Save button not found to highlight.');
    }
  }

  function highlightMismatch(diff, spent, entered) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    panel.innerHTML = `<div style="background:#fff;padding:20px;border-radius:10px;font:14px Arial;max-width:460px;">
      <h2 style="margin-top:0;color:#b91c1c;">Mismatch Detected</h2>
      <p>Spent: <b>${spent.toFixed(2)}</b></p>
      <p>Entered: <b>${entered.toFixed(2)}</b></p>
      <p>Difference: <b>${diff.toFixed(2)}</b> (tolerance: ${state.tolerance})</p>
      <p>Review data and manually continue when resolved.</p>
      <button id="cr-mismatch-close">Close</button>
    </div>`;
    panel.querySelector('#cr-mismatch-close').addEventListener('click', () => panel.remove());
    document.documentElement.appendChild(panel);
  }

  async function startCalibration() {
    if (state.calibrationActive) return;
    state.calibrationActive = true;
    log('Calibration mode ON: click an element to capture selector.');

    state.calibrationHandler = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const selector = getUniqueSelector(event.target);
      const key = prompt('Selector key name (e.g., transactionDate, amountInput, itemizeButton):');
      if (key) {
        const store = await chrome.storage.sync.get(['selectorOverrides']);
        const selectorOverrides = store.selectorOverrides || {};
        selectorOverrides[key] = selector;
        await chrome.storage.sync.set({ selectorOverrides });
        state.selectorOverrides = selectorOverrides;
        log(`Captured override ${key} => ${selector}`);
      }
      stopCalibration();
    };

    document.addEventListener('click', state.calibrationHandler, true);
  }

  function stopCalibration() {
    if (!state.calibrationActive) return;
    document.removeEventListener('click', state.calibrationHandler, true);
    state.calibrationActive = false;
    state.calibrationHandler = null;
    log('Calibration mode OFF.');
  }

  function getUniqueSelector(el) {
    if (el.id) return `#${cssEscape(el.id)}`;
    if (el.getAttribute('data-testid')) return `[data-testid="${cssEscape(el.getAttribute('data-testid'))}"]`;
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.nodeName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const firstClass = node.className.trim().split(/\s+/)[0];
        if (firstClass) part += `.${cssEscape(firstClass)}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.nodeName === node.nodeName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      path.unshift(part);
      node = parent;
    }
    return path.join(' > ');
  }

  function parseMoney(raw) {
    const num = Number(String(raw).replace(/[$,\s]/g, ''));
    return Number.isFinite(num) ? num : 0;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }
})();
