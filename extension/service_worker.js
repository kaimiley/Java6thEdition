const DEFAULT_SETTINGS = {
  tolerance: 0.5,
  keywordMappings: {
    'HOTEL - ROOM COST': ['room rate', 'room charge', 'lodging'],
    'HOTEL - ROOM TAX': ['tax', 'occupancy tax', 'city tax', 'state tax'],
    'HOTEL - PARKING': ['parking', 'valet'],
    'HOTEL - INTERNET / TELECOM': ['internet', 'wifi', 'wi-fi', 'telecom'],
    'HOTEL - FOOD / BEVERAGE': ['restaurant', 'breakfast', 'dinner', 'bar', 'food', 'beverage'],
    'MISCELLANEOUS': ['service fee', 'resort fee', 'destination fee'],
    'HOTEL - PERSONAL EXPENSE - NON-REIMBURSABLE': ['movie', 'minibar', 'gift shop', 'spa personal']
  },
  selectorOverrides: {}
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const merged = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    merged[k] = current[k] ?? v;
  }
  await chrome.storage.sync.set(merged);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'GET_SETTINGS') {
    chrome.storage.sync
      .get(Object.keys(DEFAULT_SETTINGS))
      .then((values) => {
        sendResponse({ ok: true, settings: { ...DEFAULT_SETTINGS, ...values } });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});
