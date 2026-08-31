// injector.js — Runs in PAGE MAIN WORLD (world: "MAIN" in manifest.json)
// Handles text insertion into Slate editor via React fiber.
// The CLICK is handled by background.js via CDP (trusted isTrusted=true event).

window.addEventListener('message', function(event) {
  if (!event.data || event.data.source !== 'FLOW_EXTENSION_CONTENT') return;

  if (event.data.type === 'SLATE_INSERT_TEXT') {
    handleInsertText(event.data.text).then(result => {
      window.postMessage({
        source: 'FLOW_EXTENSION_INJECTOR',
        type: 'SLATE_INSERT_RESULT',
        result: result.status,
        btnRect: result.btnRect || null
      }, '*');
    });
  }
});

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handleInsertText(text) {
  try {
    // ── 1. Find the Slate editor element ──────────────────────────────────────
    const editorEl = document.querySelector("div[data-slate-editor='true']");
    if (!editorEl) return { status: 'no-editor' };

    // ── 2. Find the Slate editor object via React fiber ───────────────────────
    const fiberKey = Object.keys(editorEl).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) return { status: 'no-fiber' };

    let slateEditor = null;
    let current = editorEl[fiberKey];
    for (let i = 0; i < 60 && current; i++) {
      const props = current.memoizedProps || current.pendingProps;
      if (props && props.editor && typeof props.editor.insertText === 'function') {
        slateEditor = props.editor;
        break;
      }
      current = current.return;
    }
    if (!slateEditor) return { status: 'no-slate-editor' };

    // ── 3. Focus editor and clear existing content ────────────────────────────
    editorEl.focus();
    await sleep(100);

    // Select all and delete in a single operation to prevent Slate desync
    try {
      if (slateEditor.selectAll) {
        slateEditor.selectAll();
      } else {
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      await sleep(100);
      if (slateEditor.deleteFragment) {
        slateEditor.deleteFragment();
      } else {
        document.execCommand('delete', false, null);
      }
    } catch(e) {
      console.warn("[Injector] Clear error:", e);
    }
    await sleep(150);

    // ── 4. Insert text via Slate's own insertText ─────────────────────────────
    slateEditor.insertText(text);
    await sleep(300);

    const editorText = editorEl.textContent || '';
    console.log('[Injector] Text in editor after insertText:', editorText.substring(0, 80));

    if (!editorText.trim()) {
      return { status: 'insert-failed-empty' };
    }

    // ── 5. Wait for React to re-render and enable the submit button ───────────
    // Poll up to 5 seconds for the arrow_forward button to become active
    let submitBtn = null;
    for (let i = 0; i < 50; i++) {
      for (const btn of document.querySelectorAll('button')) {
        const iEl = btn.querySelector('i');
        if (iEl && iEl.textContent.trim() === 'arrow_forward') {
          const isDisabled =
            btn.disabled === true ||
            btn.getAttribute('aria-disabled') === 'true';
          if (!isDisabled) {
            submitBtn = btn;
            break;
          }
        }
      }
      if (submitBtn) break;
      await sleep(100);
    }

    // If button never naturally enabled, find it anyway
    if (!submitBtn) {
      for (const btn of document.querySelectorAll('button')) {
        const iEl = btn.querySelector('i');
        if (iEl && iEl.textContent.trim() === 'arrow_forward') {
          submitBtn = btn;
          break;
        }
      }
      if (!submitBtn) {
        for (const btn of document.querySelectorAll('button')) {
          const iEl = btn.querySelector('i');
          if (btn.textContent.includes('Create') && iEl?.textContent.trim() !== 'add') {
            submitBtn = btn;
            break;
          }
        }
      }
    }

    if (!submitBtn) return { status: 'no-submit-button' };

    // ── 6. Return button center coordinates so background.js can CDP-click ────
    const rect = submitBtn.getBoundingClientRect();
    const btnCenterX = Math.round(rect.left + rect.width / 2);
    const btnCenterY = Math.round(rect.top + rect.height / 2);

    console.log(`[Injector] Submit button center: (${btnCenterX}, ${btnCenterY}). Enabled: ${!submitBtn.disabled}`);

    return {
      status: 'ready-to-click',
      btnRect: { x: btnCenterX, y: btnCenterY }
    };

  } catch (e) {
    return { status: 'error:' + e.message };
  }
}

console.log('[Flow Extension Injector] MAIN world injector ready (CDP click mode).');
