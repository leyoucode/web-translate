const OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2:7b';

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
