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
    // ── 1. Find the editor element with polling ──────────────────────────────
    let editorEl = null;
    for (let i = 0; i < 30; i++) {
      editorEl = document.querySelector("div[data-slate-editor='true'], div[role='textbox'], div[contenteditable='true']");
      if (editorEl) break;
      await sleep(100);
    }
    if (!editorEl) return { status: 'no-editor' };

    // ── 2. Find the Slate editor object via React fiber ───────────────────────
    const fiberKey = Object.keys(editorEl).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance') || k.startsWith('__reactProps')
    );

    let slateEditor = null;
    if (fiberKey) {
      let current = editorEl[fiberKey];
      for (let i = 0; i < 60 && current; i++) {
        const props = current.memoizedProps || current.pendingProps;
        if (props && props.editor && typeof props.editor.insertText === 'function') {
          slateEditor = props.editor;
          break;
        }
        current = current.return;
      }
    }

    // ── 3. Focus editor and clear existing content ────────────────────────────
    editorEl.focus();
    await sleep(100);

    if (slateEditor) {
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
      } catch (e) {
        console.warn("[Injector] Clear error:", e);
      }
      await sleep(100);

      if (!slateEditor.selection) {
        try {
          const startPoint = { path: [0, 0], offset: 0 };
          slateEditor.selection = { anchor: startPoint, focus: startPoint };
        } catch (e) {}
      }

      slateEditor.insertText(text);
    } else {
      // Direct DOM fallback
      editorEl.focus();
      document.execCommand('selectAll', false, null);
      await sleep(50);
      document.execCommand('delete', false, null);
      await sleep(50);
      document.execCommand('insertText', false, text);
    }

    // Dispatch synthetic input events to sync React state
    try {
      editorEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
      editorEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
      editorEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}

    await sleep(300);

    // ── 4. Find submit button & force-enable if needed ───────────────────────
    let submitBtn = null;
    for (let i = 0; i < 30; i++) {
      for (const btn of document.querySelectorAll('button')) {
        const iEl = btn.querySelector('i');
        const txt = (btn.textContent || "").toLowerCase();
        if ((iEl && iEl.textContent.trim() === 'arrow_forward') || (txt.includes('create') && (!iEl || iEl.textContent.trim() !== 'add'))) {
          btn.disabled = false;
          btn.removeAttribute('aria-disabled');
          submitBtn = btn;
          break;
        }
      }
      if (submitBtn) break;
      await sleep(100);
    }

    if (!submitBtn) return { status: 'no-submit-button' };

    const rect = submitBtn.getBoundingClientRect();
    const btnCenterX = Math.round(rect.left + rect.width / 2);
    const btnCenterY = Math.round(rect.top + rect.height / 2);

    return {
      status: 'ready-to-click',
      btnRect: { x: btnCenterX, y: btnCenterY }
    };

  } catch (e) {
    return { status: 'error:' + e.message };
  }
}

console.log('[Flow Extension Injector] MAIN world injector ready (CDP click mode).');
