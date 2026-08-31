// injector.js — Runs in PAGE MAIN WORLD (no CSP restrictions)
// Communicates with content.js (ISOLATED world) via window.postMessage

window.addEventListener('message', function(event) {
  if (!event.data || event.data.source !== 'FLOW_EXTENSION_CONTENT') return;
  
  if (event.data.type === 'SLATE_INSERT_TEXT') {
    const text = event.data.text;
    let result = 'unknown';
    
    try {
      const editorEl = document.querySelector("div[data-slate-editor='true']");
      if (!editorEl) {
        result = 'no-editor';
        window.postMessage({ source: 'FLOW_EXTENSION_INJECTOR', type: 'SLATE_INSERT_RESULT', result }, '*');
        return;
      }
      
      // Find React fiber key
      const fiberKey = Object.keys(editorEl).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      
      if (!fiberKey) {
        result = 'no-fiber';
        window.postMessage({ source: 'FLOW_EXTENSION_INJECTOR', type: 'SLATE_INSERT_RESULT', result }, '*');
        return;
      }
      
      // Walk fiber tree upward to find Slate editor object
      let slateEditor = null;
      let current = editorEl[fiberKey];
      for (let i = 0; i < 50 && current; i++) {
        const props = current.memoizedProps || current.pendingProps;
        if (props && props.editor && typeof props.editor.insertText === 'function') {
          slateEditor = props.editor;
          break;
        }
        current = current.return;
      }
      
      if (!slateEditor) {
        result = 'no-slate-editor';
        window.postMessage({ source: 'FLOW_EXTENSION_INJECTOR', type: 'SLATE_INSERT_RESULT', result }, '*');
        return;
      }
      
      // Focus the editor element first
      editorEl.focus();
      
      // Select all existing text and delete it
      slateEditor.selectAll && slateEditor.selectAll();
      // Use Slate's own transforms to delete and insert
      const { children } = slateEditor;
      if (children && children.length > 0) {
        // Delete all children content by selecting full range
        try {
          slateEditor.deleteFragment && slateEditor.deleteFragment();
        } catch(e) {}
        try {
          slateEditor.delete && slateEditor.delete();
        } catch(e) {}
      }
      
      // Insert the new text
      slateEditor.insertText(text);
      result = 'success';
      
    } catch (e) {
      result = 'error:' + e.message;
    }
    
    window.postMessage({ source: 'FLOW_EXTENSION_INJECTOR', type: 'SLATE_INSERT_RESULT', result }, '*');
  }
});

console.log('[Flow Extension Injector] MAIN world injector ready.');
