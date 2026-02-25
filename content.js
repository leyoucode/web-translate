(() => {
  const TRANSLATABLE_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION',
    'A', 'SPAN', 'LABEL', 'CAPTION', 'SUMMARY', 'DT', 'DD',
  ]);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG',
    'MATH', 'TEXTAREA', 'INPUT', 'SELECT', 'IFRAME', 'CANVAS',
  ]);

  const CHINESE_RE = /[\u4e00-\u9fff]/;
  const MAX_TEXT_LEN = 500;
  const ATTR_TRANSLATED = 'data-wt-translated';
  const ATTR_ID = 'data-wt-id';

  let port = null;
  let translating = false;
  let totalElements = 0;
  let doneElements = 0;
  let progressBar = null;
  let translationsVisible = true;
  let idCounter = 0;
  let displayMode = 'bilingual'; // 'bilingual' | 'replace'

  // Load saved display mode
  chrome.storage.local.get('displayMode', (res) => {
    displayMode = res.displayMode || 'bilingual';
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'startTranslate') {
      startTranslation();
      sendResponse({ status: 'started' });
    } else if (msg.action === 'toggleTranslation') {
      toggleTranslations();
      sendResponse({ visible: translationsVisible });
    } else if (msg.action === 'getStatus') {
      sendResponse({
        translating,
        total: totalElements,
        done: doneElements,
        visible: translationsVisible,
      });
    } else if (msg.action === 'setDisplayMode') {
      switchDisplayMode(msg.mode);
      sendResponse({ mode: displayMode });
    } else if (msg.action === 'translateSelection') {
      translateSelection(msg.text);
      sendResponse({ status: 'started' });
    }
    return true;
  });

  function switchDisplayMode(newMode) {
    if (newMode === displayMode) return;
    displayMode = newMode;

    // Update all already-translated elements
    const translatedEls = document.querySelectorAll(`[${ATTR_TRANSLATED}]`);
    translatedEls.forEach((el) => {
      const elId = el.getAttribute(ATTR_ID);
      if (!elId) return;
      const transDiv = document.getElementById(`wt-trans-${elId}`);
      if (!transDiv) return;

      if (displayMode === 'replace') {
        // Hide original, restyle translation
        el.classList.add('wt-original-hidden');
        transDiv.classList.add('wt-replace-mode');
      } else {
        // Show original, restore bilingual style
        el.classList.remove('wt-original-hidden');
        transDiv.classList.remove('wt-replace-mode');
      }
    });
  }

  function connectPort() {
    port = chrome.runtime.connect({ name: 'translate' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'translation-chunk') {
        updateTranslation(msg.elementId, msg.text, msg.done);
      } else if (msg.type === 'translation-error') {
        handleTranslationError(msg.elementId, msg.error);
      }
    });

    port.onDisconnect.addListener(() => {
      // Reconnect if translation is still in progress
      if (translating) {
        port = null;
        connectPort();
      }
    });
  }

  function startTranslation() {
    if (translating) return;
    translating = true;
    doneElements = 0;
    idCounter = 0;

    connectPort();
    showProgressBar();

    const elements = collectTranslatableElements();
    totalElements = elements.length;

    if (totalElements === 0) {
      translating = false;
      removeProgressBar();
      return;
    }

    updateProgress();

    // Sort by visibility: viewport elements first
    const sorted = sortByVisibility(elements);

    // Translate sequentially to avoid overwhelming Ollama
    translateSequentially(sorted);
  }

  function collectTranslatableElements() {
    const elements = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
          if (node.hasAttribute(ATTR_TRANSLATED)) return NodeFilter.FILTER_SKIP;
          if (node.classList.contains('wt-translation')) return NodeFilter.FILTER_REJECT;
          if (node.classList.contains('wt-progress-bar')) return NodeFilter.FILTER_REJECT;
          if (TRANSLATABLE_TAGS.has(node.tagName)) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        },
      }
    );

    while (walker.nextNode()) {
      const el = walker.currentNode;
      const text = getDirectText(el);
      if (shouldTranslate(text)) {
        elements.push(el);
      }
    }

    return elements;
  }

  function getDirectText(el) {
    // Get text content, cleaning up whitespace
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE && !TRANSLATABLE_TAGS.has(child.tagName)) {
        // Include text from inline non-translatable children (e.g., <strong>, <em>)
        text += child.textContent;
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function shouldTranslate(text) {
    if (!text || text.length < 2) return false;
    // Skip pure numbers/symbols
    if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) return false;
    // Skip mostly Chinese text (>50% Chinese characters)
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    if (chineseChars / text.length > 0.5) return false;
    return true;
  }

  function sortByVisibility(elements) {
    const viewportHeight = window.innerHeight;
    return [...elements].sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const inViewA = rectA.top >= 0 && rectA.top <= viewportHeight;
      const inViewB = rectB.top >= 0 && rectB.top <= viewportHeight;
      if (inViewA && !inViewB) return -1;
      if (!inViewA && inViewB) return 1;
      return rectA.top - rectB.top;
    });
  }

  async function translateSequentially(elements) {
    for (const el of elements) {
      if (!translating) break;

      const text = getDirectText(el);
      if (!text) {
        doneElements++;
        updateProgress();
        continue;
      }

      const elId = `wt-${idCounter++}`;
      el.setAttribute(ATTR_ID, elId);
      el.setAttribute(ATTR_TRANSLATED, 'pending');

      // Insert placeholder
      insertTranslationElement(el, elId, '翻译中...');

      // Split long text
      const chunks = text.length > MAX_TEXT_LEN ? splitText(text) : [text];
      const fullText = chunks.join('\n');

      await new Promise((resolve) => {
        const handler = (msg) => {
          if (msg.elementId !== elId) return;
          if (msg.type === 'translation-chunk') {
            updateTranslation(elId, msg.text, msg.done);
            if (msg.done) {
              port.onMessage.removeListener(handler);
              el.setAttribute(ATTR_TRANSLATED, 'done');
              doneElements++;
              updateProgress();
              resolve();
            }
          } else if (msg.type === 'translation-error') {
            updateTranslation(elId, `⚠️ ${msg.error}`, true);
            el.setAttribute(ATTR_TRANSLATED, 'error');
            doneElements++;
            updateProgress();
            port.onMessage.removeListener(handler);
            resolve();
          }
        };
        port.onMessage.addListener(handler);

        try {
          port.postMessage({ type: 'translate', text: fullText, elementId: elId });
        } catch {
          // Port disconnected — reconnect and retry
          connectPort();
          port.onMessage.addListener(handler);
          port.postMessage({ type: 'translate', text: fullText, elementId: elId });
        }
      });
    }

    translating = false;
    finishProgress();
  }

  function splitText(text) {
    const sentences = text.match(/[^.!?。！？]+[.!?。！？]+/g) || [text];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + sentence).length > MAX_TEXT_LEN && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function insertTranslationElement(el, elId, text) {
    const div = document.createElement('div');
    div.className = 'wt-translation';
    div.id = `wt-trans-${elId}`;
    div.textContent = text;
    if (!translationsVisible) div.style.display = 'none';

    if (displayMode === 'replace') {
      el.classList.add('wt-original-hidden');
      div.classList.add('wt-replace-mode');
    }

    el.insertAdjacentElement('afterend', div);
  }

  function updateTranslation(elId, text, done) {
    const div = document.getElementById(`wt-trans-${elId}`);
    if (!div) return;
    div.textContent = text;
    if (done) {
      div.classList.add('wt-translation-done');
    }
  }

  function handleTranslationError(elId, error) {
    const div = document.getElementById(`wt-trans-${elId}`);
    if (!div) return;
    div.textContent = `⚠️ ${error}`;
    div.classList.add('wt-translation-error');
  }

  function toggleTranslations() {
    translationsVisible = !translationsVisible;
    const translations = document.querySelectorAll('.wt-translation');
    translations.forEach((el) => {
      el.style.display = translationsVisible ? '' : 'none';
    });

    // In replace mode, also toggle original elements back
    if (displayMode === 'replace') {
      const originals = document.querySelectorAll('.wt-original-hidden');
      originals.forEach((el) => {
        // When hiding translations in replace mode, show originals
        el.classList.toggle('wt-original-hidden', translationsVisible);
      });
    }
  }

  // Progress bar
  function showProgressBar() {
    if (progressBar) progressBar.remove();
    progressBar = document.createElement('div');
    progressBar.className = 'wt-progress-bar';
    progressBar.innerHTML = `
      <div class="wt-progress-track">
        <div class="wt-progress-fill" style="width: 0%"></div>
      </div>
      <span class="wt-progress-text">准备翻译...</span>
    `;
    document.body.prepend(progressBar);
  }

  function updateProgress() {
    if (!progressBar) return;
    const pct = totalElements > 0 ? Math.round((doneElements / totalElements) * 100) : 0;
    const fill = progressBar.querySelector('.wt-progress-fill');
    const text = progressBar.querySelector('.wt-progress-text');
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = `翻译中... ${doneElements}/${totalElements} (${pct}%)`;
  }

  function finishProgress() {
    if (!progressBar) return;
    const fill = progressBar.querySelector('.wt-progress-fill');
    const text = progressBar.querySelector('.wt-progress-text');
    if (fill) fill.style.width = '100%';
    if (text) text.textContent = `翻译完成 ✓ (${doneElements} 段)`;
    setTimeout(removeProgressBar, 3000);
  }

  function removeProgressBar() {
    if (progressBar) {
      progressBar.remove();
      progressBar = null;
    }
  }

  // --- Selection translation tooltip ---
  function translateSelection(text) {
    if (!text || !text.trim()) return;

    // Remove existing tooltip
    removeSelectionTooltip();

    // Position near selection
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const tooltip = document.createElement('div');
    tooltip.className = 'wt-selection-tooltip';
    tooltip.id = 'wt-selection-tooltip';
    tooltip.textContent = '翻译中...';

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'wt-tooltip-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', removeSelectionTooltip);
    tooltip.prepend(closeBtn);

    document.body.appendChild(tooltip);

    // Position: below selection, clamped to viewport
    const top = rect.bottom + window.scrollY + 6;
    const left = Math.max(8, Math.min(
      rect.left + window.scrollX,
      window.innerWidth - 320
    ));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Translate via port
    const selPort = chrome.runtime.connect({ name: 'translate' });
    const selId = `wt-sel-${Date.now()}`;

    selPort.onMessage.addListener((msg) => {
      if (msg.elementId !== selId) return;
      const content = tooltip.lastChild;
      if (msg.type === 'translation-chunk') {
        // Keep close button, update text
        if (content.nodeType === Node.TEXT_NODE) {
          content.textContent = msg.text;
        } else {
          tooltip.appendChild(document.createTextNode(msg.text));
        }
        if (msg.done) {
          tooltip.classList.add('wt-tooltip-done');
          selPort.disconnect();
        }
      } else if (msg.type === 'translation-error') {
        if (content.nodeType === Node.TEXT_NODE) {
          content.textContent = `⚠️ ${msg.error}`;
        }
        tooltip.classList.add('wt-tooltip-error');
        selPort.disconnect();
      }
    });

    selPort.postMessage({ type: 'translate', text: text.trim(), elementId: selId });

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('mousedown', onClickOutside);
    }, 100);
  }

  function onClickOutside(e) {
    const tooltip = document.getElementById('wt-selection-tooltip');
    if (tooltip && !tooltip.contains(e.target)) {
      removeSelectionTooltip();
    }
  }

  function removeSelectionTooltip() {
    const tooltip = document.getElementById('wt-selection-tooltip');
    if (tooltip) tooltip.remove();
    document.removeEventListener('mousedown', onClickOutside);
  }
})();
