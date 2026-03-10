const translateBtn = document.getElementById('translateBtn');
const toggleBtn = document.getElementById('toggleBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const progressDiv = document.getElementById('progress');
const errorText = document.getElementById('errorText');
const modeBtns = document.querySelectorAll('.segment[data-mode]');
const selectBtns = document.querySelectorAll('.segment[data-select]');

let ollamaConnected = false;
let isTranslating = false;
let isPaused = false;

// Check Ollama status on popup open
checkOllamaStatus();
checkTranslationStatus();
loadDisplayMode();
loadSelectionMode();

translateBtn.addEventListener('click', async () => {
  if (!ollamaConnected) return;

  const btnText = translateBtn.querySelector('.btn-text');
  const btnIcon = translateBtn.querySelector('.btn-icon');

  if (isPaused) {
    // Resume translation
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'resumeTranslate' });
      isPaused = false;
      isTranslating = true;
      if (btnText) btnText.textContent = '暂停翻译';
      if (btnIcon) btnIcon.textContent = '⏸';
    } catch {
      showError('无法连接到页面，请刷新后重试');
    }
    return;
  }

  if (isTranslating) {
    // Pause translation
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'pauseTranslate' });
      isPaused = true;
      isTranslating = false;
      if (btnText) btnText.textContent = '继续翻译';
      if (btnIcon) btnIcon.textContent = '▶';
    } catch {
      showError('无法连接到页面，请刷新后重试');
    }
    return;
  }

  // Start translation
  errorText.style.display = 'none';
  if (btnText) btnText.textContent = '暂停翻译';
  if (btnIcon) btnIcon.textContent = '⏸';

  isTranslating = true;
  progressDiv.style.display = 'block';
  progressDiv.textContent = '准备翻译中...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'startTranslate' });
    pollProgress();
  } catch (err) {
    showError('无法连接到页面，请刷新后重试');
    if (btnText) btnText.textContent = '翻译此页面';
    if (btnIcon) btnIcon.textContent = '⚡';
    isTranslating = false;
  }
});

toggleBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation' });
    const btnText = toggleBtn.querySelector('.btn-text');
    if (btnText) btnText.textContent = res.visible ? '隐藏译文' : '显示译文';
  } catch {
    showError('无法连接到页面，请刷新后重试');
  }
});

// Display mode switching
modeBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    modeBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'setDisplayMode', mode });
    } catch {
      // Content script not ready
    }
    await chrome.storage.local.set({ displayMode: mode });
  });
});

// Selection mode switching
selectBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.select;
    selectBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    await chrome.storage.local.set({ selectionMode: mode });

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'setSelectionMode', mode });
    } catch {
      // Content script not ready
    }
  });
});

async function loadSelectionMode() {
  const { selectionMode } = await chrome.storage.local.get('selectionMode');
  const mode = selectionMode || 'menu';
  selectBtns.forEach((b) => {
    b.classList.toggle('active', b.dataset.select === mode);
  });
}

async function loadDisplayMode() {
  const { displayMode } = await chrome.storage.local.get('displayMode');
  const mode = displayMode || 'bilingual';
  modeBtns.forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

async function checkOllamaStatus() {
  try {
    const port = chrome.runtime.connect({ name: 'translate' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'ollama-status') {
        port.disconnect();
        if (msg.connected) {
          ollamaConnected = true;
          statusDot.classList.add('connected');
          statusText.textContent = 'Ollama 已就绪';
          if (!isTranslating && !isPaused) {
            translateBtn.disabled = false;
          }
        } else {
          statusDot.classList.add('error');
          statusText.textContent = '未连接';
          showError('请启动 Ollama');
        }
      }
    });

    port.postMessage({ type: 'check-ollama' });
  } catch {
    statusDot.classList.add('error');
    statusText.textContent = '连接失败';
  }
}

async function checkTranslationStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
    const btnText = translateBtn.querySelector('.btn-text');
    const btnIcon = translateBtn.querySelector('.btn-icon');
    const toggleBtnText = toggleBtn.querySelector('.btn-text');

    if (status.paused) {
      isPaused = true;
      isTranslating = false;
      translateBtn.disabled = false;
      if (btnText) btnText.textContent = '继续翻译';
      if (btnIcon) btnIcon.textContent = '▶';
      progressDiv.style.display = 'block';
      const pct = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
      progressDiv.textContent = `已暂停 ${pct}% (${status.done}/${status.total})`;
    } else if (status.translating) {
      isTranslating = true;
      translateBtn.disabled = false;
      if (btnText) btnText.textContent = '暂停翻译';
      if (btnIcon) btnIcon.textContent = '⏸';
      progressDiv.style.display = 'block';
      progressDiv.textContent = `进度: ${status.done}/${status.total}`;
      pollProgress();
    }
    if (toggleBtnText) toggleBtnText.textContent = status.visible ? '隐藏译文' : '显示译文';
  } catch {
    // Content script not loaded
  }
}

function pollProgress() {
  const interval = setInterval(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
      const btnText = translateBtn.querySelector('.btn-text');
      const btnIcon = translateBtn.querySelector('.btn-icon');

      if (status.total > 0) {
        const pct = Math.round((status.done / status.total) * 100);
        if (status.paused) {
          progressDiv.textContent = `已暂停 ${pct}% (${status.done}/${status.total})`;
        } else {
          progressDiv.textContent = `已翻译 ${pct}% (${status.done}/${status.total})`;
        }
      }

      if (status.paused) {
        clearInterval(interval);
        isPaused = true;
        isTranslating = false;
        translateBtn.disabled = false;
        if (btnText) btnText.textContent = '继续翻译';
        if (btnIcon) btnIcon.textContent = '▶';
      } else if (!status.translating) {
        clearInterval(interval);
        isTranslating = false;
        isPaused = false;
        if (btnText) btnText.textContent = '重新翻译';
        if (btnIcon) btnIcon.textContent = '⚡';
        translateBtn.disabled = false;
        progressDiv.textContent = '翻译完成 ✓';
        setTimeout(() => { progressDiv.style.display = 'none'; }, 3000);
      }
    } catch {
      clearInterval(interval);
    }
  }, 500);
}

function showError(msg) {
  errorText.textContent = msg;
  errorText.style.display = 'block';
}
