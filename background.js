const OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2:7b';

// Translation cache: key = "model:text", value = translated result
const translationCache = new Map();
const CACHE_MAX_SIZE = 500;

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译选中文本',
    contexts: ['selection'],
  });
});

// Keyboard shortcut listener
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'translate-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'startTranslate' });
    }
  }
});

// Context menu click listener
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateSelection',
      text: info.selectionText,
    });
  }
});

// Port connections
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'translate') {
      await handleTranslate(port, msg);
    } else if (msg.type === 'check-ollama') {
      await handleCheckOllama(port);
    }
  });
});

async function getSelectedModel() {
  const { selectedModel } = await chrome.storage.local.get('selectedModel');
  return selectedModel || DEFAULT_MODEL;
}

function getCacheKey(model, text) {
  return `${model}:${text}`;
}

async function handleCheckOllama(port) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    port.postMessage({
      type: 'ollama-status',
      connected: true,
      models,
    });
  } catch {
    port.postMessage({
      type: 'ollama-status',
      connected: false,
      models: [],
    });
  }
}

async function handleTranslate(port, msg) {
  const { text, elementId } = msg;
  const model = await getSelectedModel();
  const cacheKey = getCacheKey(model, text);

  // Check cache first
  if (translationCache.has(cacheKey)) {
    const cached = translationCache.get(cacheKey);
    port.postMessage({
      type: 'translation-chunk',
      elementId,
      text: cached,
      done: true,
    });
    return;
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              '你是一个翻译助手。将用户提供的文本翻译成中文，只返回翻译结果，不要添加任何解释、注释或额外内容。',
          },
          {
            role: 'user',
            content: `翻译以下文本为中文：\n\n${text}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API 错误: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            accumulated += json.message.content;
            port.postMessage({
              type: 'translation-chunk',
              elementId,
              text: accumulated,
              done: false,
            });
          }
          if (json.done) {
            // Store in cache
            if (translationCache.size >= CACHE_MAX_SIZE) {
              const firstKey = translationCache.keys().next().value;
              translationCache.delete(firstKey);
            }
            translationCache.set(cacheKey, accumulated);

            port.postMessage({
              type: 'translation-chunk',
              elementId,
              text: accumulated,
              done: true,
            });
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } catch (err) {
    port.postMessage({
      type: 'translation-error',
      elementId,
      error: err.message || '翻译失败',
    });
  }
}
