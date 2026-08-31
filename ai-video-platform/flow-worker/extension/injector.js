// injector.js — Runs in PAGE MAIN WORLD (no CSP restrictions, world: "MAIN" in manifest.json)
// Communicates with content.js (ISOLATED world) via window.postMessage

window.addEventListener('message', function(event) {
  if (!event.data || event.data.source !== 'FLOW_EXTENSION_CONTENT') return;

  if (event.data.type === 'SLATE_INSERT_AND_SUBMIT') {
    handleInsertAndSubmit(event.data.text).then(result => {
      window.postMessage({
        source: 'FLOW_EXTENSION_INJECTOR',
        type: 'SLATE_INSERT_RESULT',
        result: result
      }, '*');
    });
  }
});

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handleInsertAndSubmit(text) {
  try {
    // ── 1. Find the Slate editor element ──────────────────────────────────────
    const editorEl = document.querySelector("div[data-slate-editor='true']");
    if (!editorEl) return 'no-editor';

    // ── 2. Find the Slate editor object via React fiber ───────────────────────
    const fiberKey = Object.keys(editorEl).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) return 'no-fiber';

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
    if (!slateEditor) return 'no-slate-editor';

    // ── 3. Focus editor and clear existing content ────────────────────────────
    editorEl.focus();
    await sleep(100);

    // Delete all text in Slate by collapsing selection and deleting
    try {
      // Select all — move to end then delete backward to beginning
      const allText = editorEl.textContent || '';
      for (let i = 0; i < allText.length + 5; i++) {
        slateEditor.deleteBackward('character');
      }
    } catch(e) {}
    await sleep(100);

    // ── 4. Insert text via Slate's own insertText ─────────────────────────────
    slateEditor.insertText(text);
    await sleep(200);

    // Verify text is in the editor DOM
    const editorText = editorEl.textContent || '';
    console.log('[Injector] Text in editor after insertText:', editorText.substring(0, 80));

    if (!editorText.trim()) {
      return 'insert-failed-empty';
    }

    // ── 5. Wait for React to re-render and enable the submit button ───────────
    // Poll up to 4 seconds for the arrow_forward button to become active
    let submitBtn = null;
    for (let i = 0; i < 40; i++) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const iEl = btn.querySelector('i');
        if (iEl && iEl.textContent.trim() === 'arrow_forward') {
          submitBtn = btn;
          break;
        }
      }

      if (submitBtn) {
        const isDisabled =
          submitBtn.disabled === true ||
          submitBtn.getAttribute('aria-disabled') === 'true';

        if (!isDisabled) {
          console.log('[Injector] Submit button is enabled! Clicking now.');
          break;
        } else {
          // Button found but still disabled — keep waiting
          submitBtn = null;
        }
      }
      await sleep(100);
    }

    // ── 6. If button never became enabled, force-enable and click ─────────────
    if (!submitBtn) {
      // Find it even if disabled
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const iEl = btn.querySelector('i');
        if (iEl && iEl.textContent.trim() === 'arrow_forward') {
          submitBtn = btn;
          break;
        }
      }
    }

    if (!submitBtn) {
      // Last resort: find by "Create" text
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const iEl = btn.querySelector('i');
        const iText = iEl ? iEl.textContent.trim() : '';
        if (btn.textContent.includes('Create') && iText !== 'add') {
          submitBtn = btn;
          break;
        }
      }
    }

    if (!submitBtn) return 'no-submit-button';

    // Force-remove disabled attributes and click directly on the button
    submitBtn.removeAttribute('aria-disabled');
    submitBtn.removeAttribute('disabled');
    submitBtn.disabled = false;
    await sleep(50);
    submitBtn.click();
    console.log('[Injector] Clicked submit button.');

    return 'success';
  } catch (e) {
    return 'error:' + e.message;
  }
}

console.log('[Flow Extension Injector] MAIN world injector ready.');
