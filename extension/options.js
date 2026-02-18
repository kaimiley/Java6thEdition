const toleranceEl = document.getElementById('tolerance');
const keywordMappingsEl = document.getElementById('keywordMappings');
const selectorOverridesEl = document.getElementById('selectorOverrides');
const statusEl = document.getElementById('status');

document.getElementById('saveBtn').addEventListener('click', save);

init();

async function init() {
  const values = await chrome.storage.sync.get(['tolerance', 'keywordMappings', 'selectorOverrides']);
  toleranceEl.value = values.tolerance ?? 0.5;
  keywordMappingsEl.value = JSON.stringify(values.keywordMappings || {}, null, 2);
  selectorOverridesEl.value = JSON.stringify(values.selectorOverrides || {}, null, 2);
}

async function save() {
  try {
    const parsed = JSON.parse(keywordMappingsEl.value || '{}');
    await chrome.storage.sync.set({
      tolerance: Number(toleranceEl.value || 0.5),
      keywordMappings: parsed
    });
    statusEl.textContent = 'Saved';
    setTimeout(() => (statusEl.textContent = ''), 1500);
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
}
