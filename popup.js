const translateBtn = document.getElementById('translateBtn');
const toggleBtn = document.getElementById('toggleBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const progressDiv = document.getElementById('progress');
const errorText = document.getElementById('errorText');
const modeBtns = document.querySelectorAll('.mode-btn');

let ollamaConnected = false;
let isTranslating = false;

// Check Ollama status on popup open
checkOllamaStatus();
checkTranslationStatus();
loadDisplayMode();

translateBtn.addEventListener('click', async () => {
  if (!ollamaConnected || isTranslating) return;

  errorText.style.display = 'none';
  translateBtn.disabled = true;
  translateBtn.textContent = '翻译中...';
  isTranslating = true;
  progressDiv.style.display = 'block';
  progressDiv.textContent = '正在启动翻译...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'startTranslate' });
    // Start polling for progress
    pollProgress();
  } catch (err) {
    showError('无法连接到页面，请刷新后重试');
    translateBtn.disabled = false;
    translateBtn.textContent = '翻译此页';
    isTranslating = false;
  }
});

toggleBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation' });
    toggleBtn.textContent = res.visible ? '隐藏译文' : '显示译文';
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

    // Save to storage
    await chrome.storage.local.set({ displayMode: mode });

    // Notify content script to switch mode
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'setDisplayMode', mode });
    } catch {
      // Content script not ready yet, that's fine — it will read from storage on next translate
    }
  });
});

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
        if (msg.connected && msg.modelLoaded) {
          ollamaConnected = true;
          statusDot.classList.add('connected');
          statusText.textContent = 'Ollama 已连接 (qwen2:7b)';
          if (!isTranslating) {
            translateBtn.disabled = false;
          }
        } else if (msg.connected && !msg.modelLoaded) {
          statusDot.classList.add('error');
          statusText.textContent = 'Ollama 已连接，但 qwen2 模型未加载';
          showError('请运行: ollama pull qwen2:7b');
        } else {
          statusDot.classList.add('error');
          statusText.textContent = 'Ollama 未连接';
          showError('请确保 Ollama 正在运行 (ollama serve)');
        }
      }
    });

    port.postMessage({ type: 'check-ollama' });
  } catch {
    statusDot.classList.add('error');
    statusText.textContent = 'Ollama 未连接';
    showError('请确保 Ollama 正在运行');
  }
}

async function checkTranslationStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
    if (status.translating) {
      isTranslating = true;
      translateBtn.disabled = true;
      translateBtn.textContent = '翻译中...';
      progressDiv.style.display = 'block';
      progressDiv.textContent = `翻译中... ${status.done}/${status.total}`;
      pollProgress();
    }
    toggleBtn.textContent = status.visible ? '隐藏译文' : '显示译文';
  } catch {
    // Content script not loaded yet
  }
}

function pollProgress() {
  const interval = setInterval(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });

      if (status.total > 0) {
        const pct = Math.round((status.done / status.total) * 100);
        progressDiv.textContent = `翻译中... ${status.done}/${status.total} (${pct}%)`;
      }

      if (!status.translating) {
        clearInterval(interval);
        isTranslating = false;
        translateBtn.textContent = '重新翻译';
        translateBtn.disabled = false;
        progressDiv.textContent = `翻译完成 ✓ (${status.done} 段)`;
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
