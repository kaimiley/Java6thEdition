/* global pdfjsLib */

const state = {
  plan: null,
  rawLines: [],
  negativeLines: [],
  excludedLines: []
};

const els = {
  file: document.getElementById('folioFile'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  runBtn: document.getElementById('runBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  calibrateBtn: document.getElementById('calibrateBtn'),
  openOptionsBtn: document.getElementById('openOptionsBtn'),
  summary: document.getElementById('summary'),
  preview: document.getElementById('preview')
};

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.js');

els.analyzeBtn.addEventListener('click', analyzePdf);
els.runBtn.addEventListener('click', runPlan);
els.pauseBtn.addEventListener('click', () => sendCommand({ type: 'PAUSE_AUTOMATION' }));
els.stopBtn.addEventListener('click', () => sendCommand({ type: 'STOP_AUTOMATION' }));
els.calibrateBtn.addEventListener('click', () => sendCommand({ type: 'START_CALIBRATION' }));
els.openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

async function analyzePdf() {
  const file = els.file.files?.[0];
  if (!file) {
    setSummary('Select a PDF first.');
    return;
  }

  const settings = await getSettings();
  const arrayBuffer = await file.arrayBuffer();
  const pagesText = await readPdfText(arrayBuffer);
  const lines = extractLineItems(pagesText);
  const classified = classifyAndGroup(lines, settings.keywordMappings);

  state.rawLines = lines;
  state.plan = classified.plan;
  state.negativeLines = classified.negativeLines;
  state.excludedLines = classified.excludedLines;
  els.runBtn.disabled = state.plan.length === 0;

  setSummary(
    `Parsed ${lines.length} lines. Plan rows: ${state.plan.length}. ` +
      `Negative flagged: ${state.negativeLines.length}. Excluded: ${state.excludedLines.length}.`
  );
  els.preview.textContent = JSON.stringify(
    {
      plan: state.plan,
      negativeLines: state.negativeLines,
      excludedLines: state.excludedLines.slice(0, 20)
    },
    null,
    2
  );
}

async function runPlan() {
  if (!state.plan?.length) {
    setSummary('No plan available. Analyze a PDF first.');
    return;
  }
  const settings = await getSettings();
  await sendCommand({
    type: 'START_AUTOMATION',
    payload: {
      plan: state.plan,
      tolerance: Number(settings.tolerance || 0.5),
      rawLines: state.rawLines,
      negativeLines: state.negativeLines
    }
  });
  setSummary('Automation command sent. Use on-page overlay for live log.');
}

function setSummary(text) {
  els.summary.textContent = text;
}

async function sendCommand(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, message);
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
      resolve(res?.settings || {});
    });
  });
}

async function readPdfText(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => item.str).join(' ');
    pages.push(strings);
  }
  return pages.join('\n');
}

function extractLineItems(text) {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const joined = normalized.join('\n');
  const pattern = /((?:\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})|(?:\d{4}[-\/]\d{2}[-\/]\d{2}))\s+(.+?)\s+([A-Z]{3})?\s*([-+]?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})|[-+]?\$?\d+(?:\.\d{2}))/g;

  const lines = [];
  let match;
  while ((match = pattern.exec(joined))) {
    const postingDate = normalizeDate(match[1]);
    const description = match[2].trim();
    const currency = (match[3] || 'USD').trim();
    const amount = parseMoney(match[4]);
    lines.push({ posting_date: postingDate, description, amount, currency });
  }
  return lines;
}

function classifyAndGroup(lines, keywordMappings) {
  const grouped = new Map();
  const negativeLines = [];
  const excludedLines = [];

  for (const line of lines) {
    const lower = line.description.toLowerCase();
    const isPayment = /(visa payment|payment|deposit applied|deposit|credit card payment|balance forward)/i.test(lower);
    if (line.amount < 0) {
      negativeLines.push(line);
    }
    if (isPayment) {
      excludedLines.push({ ...line, reason: 'payment/adjustment exclusion' });
      continue;
    }

    const type = classify(lower, keywordMappings);
    const key = `${line.posting_date}__${type}`;
    const current = grouped.get(key) || {
      posting_date: line.posting_date,
      type,
      amount: 0,
      currency: line.currency,
      source_descriptions: []
    };
    current.amount += line.amount;
    current.source_descriptions.push(line.description);
    grouped.set(key, current);
  }

  const plan = Array.from(grouped.values())
    .map((row) => ({ ...row, amount: round2(row.amount) }))
    .filter((row) => row.amount !== 0)
    .sort((a, b) => (a.posting_date < b.posting_date ? -1 : 1));

  return { plan, negativeLines, excludedLines };
}

function classify(lowerDesc, keywordMappings) {
  const ordered = [
    'HOTEL - PERSONAL EXPENSE - NON-REIMBURSABLE',
    'HOTEL - ROOM COST',
    'HOTEL - ROOM TAX',
    'HOTEL - PARKING',
    'HOTEL - INTERNET / TELECOM',
    'HOTEL - FOOD / BEVERAGE',
    'MISCELLANEOUS'
  ];
  for (const category of ordered) {
    const words = keywordMappings?.[category] || [];
    if (words.some((w) => lowerDesc.includes(String(w).toLowerCase()))) {
      return category;
    }
  }
  if (/minibar|movie|personal|gift shop|spa/i.test(lowerDesc)) {
    return 'HOTEL - PERSONAL EXPENSE - NON-REIMBURSABLE';
  }
  return 'MISCELLANEOUS';
}

function normalizeDate(raw) {
  const clean = raw.replace(/\./g, '/').replace(/-/g, '/');
  const parts = clean.split('/').map((x) => x.trim());
  if (parts[0].length === 4) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  return `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
}

function parseMoney(raw) {
  return Number(String(raw).replace(/[$,\s]/g, ''));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
