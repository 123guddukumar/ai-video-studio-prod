// Helper to split a string by delimiter but ignoring occurrences inside quotes or parenthesis
function splitOutsideQuotes(str, delimiter) {
  const parts = [];
  let current = '';
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  let parenDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '(' && !inDoubleQuotes && !inSingleQuotes) {
      parenDepth++;
    } else if (char === ')' && !inDoubleQuotes && !inSingleQuotes) {
      parenDepth--;
    }

    if (char === delimiter && !inDoubleQuotes && !inSingleQuotes && parenDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

// Replicating Playwright-style selectors inside vanilla DOM
function findElement(selector) {
  if (!selector) return null;

  // Handle comma-separated selectors (like selector1, selector2)
  if (selector.includes(',')) {
    const subSelectors = splitOutsideQuotes(selector, ',');
    for (let sub of subSelectors) {
      const el = findElement(sub);
      if (el) return el;
    }
    return null;
  }

  // Handle Playwright text matching selector: text=Something
  if (selector.startsWith('text=')) {
    const textToFind = selector.substring(5);
    const elements = document.querySelectorAll('button, div, span, a, p, h1, h2, h3');
    for (let el of elements) {
      if (el.textContent.trim() === textToFind) return el;
    }
    return null;
  }

  // Handle button:has-text('text')
  if (selector.includes(':has-text(')) {
    const parts = selector.split(':has-text(');
    const tag = parts[0] || '*';
    const rawText = parts[1].slice(0, -1); // remove trailing ')'
    // Strip surrounding quotes
    const textToFind = (rawText.startsWith("'") && rawText.endsWith("'")) || (rawText.startsWith('"') && rawText.endsWith('"'))
      ? rawText.slice(1, -1)
      : rawText;

    const elements = document.querySelectorAll(tag);
    for (let el of elements) {
      if (el.textContent.includes(textToFind)) {
        return el;
      }
    }
    return null;
  }

  // Handle button:has(i:has-text('text'))
  if (selector.includes(':has(')) {
    // Specifically parse typical structure like button:has(i:has-text('crop_16_9'))
    if (selector.startsWith('button:has(')) {
      const insideSelector = selector.slice(11, -1); // Extract inside: i:has-text('crop_16_9')
      const buttons = document.querySelectorAll('button');
      
      for (let btn of buttons) {
        if (insideSelector.includes(':has-text(')) {
          const parts = insideSelector.split(':has-text(');
          const subTag = parts[0];
          const subRawText = parts[1].slice(0, -1);
          const subText = (subRawText.startsWith("'") && subRawText.endsWith("'")) || (subRawText.startsWith('"') && subRawText.endsWith('"'))
            ? subRawText.slice(1, -1)
            : subRawText;

          const child = btn.querySelector(subTag);
          if (child && child.textContent.includes(subText)) {
            return btn;
          }
        } else {
          // simple child selector
          if (btn.querySelector(insideSelector)) {
            return btn;
          }
        }
      }
      return null;
    }
  }

  // Fallback to standard selector query
  try {
    return document.querySelector(selector);
  } catch (e) {
    console.error('Invalid standard querySelector:', selector);
    return null;
  }
}

// Find multiple elements helper
function findElements(selector) {
  if (!selector) return [];

  if (selector.includes(',')) {
    const subSelectors = splitOutsideQuotes(selector, ',');
    let results = [];
    for (let sub of subSelectors) {
      const els = findElements(sub);
      results = results.concat(els);
    }
    // Remove duplicates
    return Array.from(new Set(results));
  }

  // Handle Playwright text matching selector: text=Something
  if (selector.startsWith('text=')) {
    const textToFind = selector.substring(5);
    const elements = document.querySelectorAll('button, div, span, a, p, h1, h2, h3');
    const matched = [];
    for (let el of elements) {
      if (el.textContent.trim() === textToFind) matched.push(el);
    }
    return matched;
  }

  // Handle button:has-text('text')
  if (selector.includes(':has-text(')) {
    const parts = selector.split(':has-text(');
    const tag = parts[0] || '*';
    const rawText = parts[1].slice(0, -1);
    const textToFind = (rawText.startsWith("'") && rawText.endsWith("'")) || (rawText.startsWith('"') && rawText.endsWith('"'))
      ? rawText.slice(1, -1)
      : rawText;

    const elements = document.querySelectorAll(tag);
    const matched = [];
    for (let el of elements) {
      if (el.textContent.includes(textToFind)) {
        return el;
      }
    }
    return matched;
  }

  // Standard querySelectorAll
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (e) {
    return [];
  }
}

// Helper: wait for element to be visible/present
function waitForElement(selector, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const el = findElement(selector);
    if (el) return resolve(el);
    
    let timer;
    const observer = new MutationObserver(() => {
      const el = findElement(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for element matching selector: ${selector}`));
    }, timeoutMs);
  });
}

// Helper: sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Listen for generation requests from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_GENERATION') {
    // Ack immediately to background to let them know we received it
    sendResponse({ ack: true });
    
    // Execute async automation
    executeAutomation(message.params)
      .then(result => {
        chrome.runtime.sendMessage({
          type: 'GENERATION_RESPONSE',
          success: true,
          dataUrl: result.dataUrl,
          thumbnailDataUrl: result.thumbnailDataUrl
        });
      })
      .catch(err => {
        console.error('Automation error:', err);
        chrome.runtime.sendMessage({
          type: 'GENERATION_RESPONSE',
          success: false,
          error: err.message
        });
      });
  }
  return true;
});

// Helper to dispatch simulated click/pointer/mouse events to guarantee Radix trigger opens
function clickElement(el) {
  if (!el) return;
  // Click deepest child to trigger natural event bubbling in React/Radix
  let target = el;
  const child = el.querySelector("i, span, div, svg");
  if (child) {
    target = child;
  }
  
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  target.click();
}

// Helper to strip safety trigger words and return a tweaked prompt
function tweakPrompt(originalPrompt, attempt) {
  let tweaked = originalPrompt;
  if (attempt === 2) {
    // Strip potentially sensitive terms that often trigger safety filters in real estate ads
    tweaked = tweaked
      .replace(/security guard/gi, "welcoming entry staff")
      .replace(/security/gi, "safety")
      .replace(/cctv/gi, "smart monitoring")
      .replace(/guarded/gi, "safe")
      .replace(/police/gi, "patrol")
      .replace(/rich/gi, "premium")
      .replace(/wealthy/gi, "luxurious");
    // If nothing changed, append a visual modifier
    if (tweaked === originalPrompt) {
      tweaked = tweaked + ", cinematic presentation";
    }
  } else if (attempt === 3) {
    // A more aggressive reduction: strip commas, simplify sentences
    tweaked = tweaked
      .replace(/[^a-zA-Z0-9\s]/g, "") // strip punctuation
      .trim() + " style";
  }
  return tweaked;
}

// Helper to check if an error popup or rate limiting message is visible on screen
function checkGenerationError() {
  const errorSelectors = ["[role='alert']", "[data-testid='error']", ".error-message", "div", "span", "p"];
  for (let selector of errorSelectors) {
    const elements = document.querySelectorAll(selector);
    for (let el of elements) {
      if (el.offsetWidth > 0 || el.offsetHeight > 0) {
        const text = el.textContent.trim();
        if (
          text.includes("unusual activity") || 
          text.includes("Safety policy") || 
          text.includes("safety policy") || 
          text.includes("generation failed") || 
          text.includes("failed to generate") || 
          (text.includes("Failed") && text.includes("activity"))
        ) {
          return text;
        }
      }
    }
  }
  return null;
}

// Helper to select Mode (Image/Video) inside the open popover container
function findModeOption(mode) {
  const textToFind = mode === 'generate_image' ? 'Image' : 'Video';
  const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
  for (let container of containers) {
    const elements = container.querySelectorAll("*");
    for (let el of elements) {
      const text = el.textContent.trim().toLowerCase();
      if (text === textToFind.toLowerCase()) {
        return el;
      }
    }
  }
  // Global search fallback
  return findElement(`button:has-text('${textToFind}'), [role='menuitem']:has-text('${textToFind}')`);
}

// Helper to select Model (Nano/Fast) inside the open popover container
function findModelOption(mode) {
  // Prefer Imagen 3 (Nano) or Imagen 3 (Fast) for images, Veo 2 (Nano) / Veo (Nano) for videos
  const searchTerms = mode === 'generate_image' 
    ? ['imagen 3 (nano)', 'imagen 3 (fast)', 'nano', 'fast']
    : ['veo 2 (nano)', 'veo (nano)', 'nano', 'fast'];

  const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
  for (let container of containers) {
    const elements = container.querySelectorAll("*");
    for (let el of elements) {
      const text = el.textContent.trim().toLowerCase();
      for (let term of searchTerms) {
        if (text === term || text.includes(term)) {
          return el;
        }
      }
    }
  }
  return null;
}

// Helper to select Aspect Ratio inside the open popover container
function findRatioOption(ratio) {
  const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
  for (let container of containers) {
    const elements = container.querySelectorAll("*");
    for (let el of elements) {
      const text = el.textContent.trim();
      if (text === ratio) {
        return el;
      }
    }
  }
  // Global search fallback
  return findElement(`button:has-text('${ratio}'), [role='menuitem']:has-text('${ratio}')`);
}

// Helper to select Video Duration inside the open popover container
function findDurationOption(durationSeconds) {
  const options = [`${durationSeconds}s`, `${durationSeconds} seconds`, `${durationSeconds} Sec`].map(t => t.toLowerCase());
  const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
  for (let container of containers) {
    const elements = container.querySelectorAll("*");
    for (let el of elements) {
      const text = el.textContent.trim().toLowerCase();
      if (options.includes(text)) {
        return el;
      }
    }
  }
  // Global search fallback
  for (let opt of options) {
    const el = findElement(`button:has-text('${opt}'), [role='menuitem']:has-text('${opt}')`);
    if (el) return el;
  }
  return null;
}

// Helper to convert base64 image data URL to a File object
function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

// Upload reference image logic in content.js
async function uploadReferenceImage(imageUrl) {
  console.log('Uploading reference image to Google Flow canvas...');
  
  // Find hidden file input
  let fileInput = document.querySelector("input[type='file']");
  
  // If not found, click the upload/media button to mount it in the DOM
  if (!fileInput) {
    console.log('File input not found, searching for media button...');
    const buttons = document.querySelectorAll("button");
    let uploadBtn = null;
    for (let btn of buttons) {
      const text = (btn.textContent || "").trim();
      const html = btn.innerHTML || "";
      if (text === "+" || text.toLowerCase().includes("add") || html.includes("add") || html.includes("plus") || html.includes("upload") || html.includes("media")) {
        uploadBtn = btn;
        break;
      }
    }
    if (uploadBtn) {
      console.log('Clicking upload/media button to activate uploader...');
      uploadBtn.click();
      await sleep(1000);
      fileInput = document.querySelector("input[type='file']");
    }
  }
  
  if (!fileInput) {
    throw new Error('Could not locate file input to upload reference image.');
  }
  
  // Create File and assign to input
  const file = dataURLtoFile(imageUrl, "reference_image.png");
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;
  
  // Dispatch change events
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('Reference image file assigned and change event dispatched.');
  
  // Wait for the image to be uploaded and appear in the UI
  await sleep(3500); 
}

async function executeAutomation(params) {
  const { action, prompt, aspect_ratio, duration, imageUrl } = params;
  console.log(`Executing automation for action: ${action}, prompt: "${prompt}", ratio: ${aspect_ratio}`);
  
  // ── Step 1: Open project canvas (Click 'New project' if visible) ────────────
  const newProjBtn = findElement("button:has-text('New project')");
  if (newProjBtn) {
    console.log('Clicking New Project button...');
    newProjBtn.click();
    await sleep(2000);
  }

  // ── Step 1.5: Upload reference image if imageUrl is provided ────────────
  if (imageUrl) {
    await uploadReferenceImage(imageUrl);
  }


  
  // ── Step 2: Configure Mode and Settings inside Popover ────────────────────
  const targetMode = action === 'generate_image' ? 'Image' : 'Video';
  console.log(`Configuring mode and settings for target: ${targetMode}`);
  
  // Find settings trigger button (e.g. "Video · 720p · 6s ⧉ x1" or "Image · ...")
  let settingsBtn = null;
  const startSettingsWait = Date.now();
  console.log('Waiting for settings button to render in DOM...');
  while (Date.now() - startSettingsWait < 15000) {
    const allButtons = document.querySelectorAll("button, [role='button']");
    for (let btn of allButtons) {
      const text = (btn.textContent || "").trim();
      const textLower = text.toLowerCase();
      
      // Signature based settings button detection
      const hasSetting = textLower.includes("720p") || textLower.includes("1080p") || textLower.includes("x1") || textLower.includes("x4") || textLower.includes("6s") || textLower.includes("3s") || textLower.includes("12s") || text.includes(" · ") || textLower.includes("banana") || textLower.includes("nano") || textLower.includes("fast") || text.includes("crop_");
      
      // Must be a radix menu trigger
      const isTrigger = btn.getAttribute("aria-haspopup") === "menu" || btn.getAttribute("id")?.includes("radix-");
      
      if (hasSetting && isTrigger && text.length > 2 && text.length < 50) {
        settingsBtn = btn;
        break;
      }
    }
    if (settingsBtn) break;
    await sleep(250);
  }

  if (settingsBtn) {
    console.log(`Found settings button: "${settingsBtn.textContent.trim()}". Clicking to open popover...`);
    clickElement(settingsBtn);
    await sleep(1200); // Wait for popover to open
    
    // 1. Select Mode (Image vs Video)
    console.log(`Selecting mode option for: ${action}`);
    const modeOpt = findModeOption(action);
    if (modeOpt) {
      console.log(`Found mode option in popover: "${modeOpt.textContent.trim()}". Clicking...`);
      clickElement(modeOpt);
      await sleep(1000);
    } else {
      console.warn('Mode option not found in popover.');
    }

    // 2. Select Model (Nano / Fast)
    console.log(`Selecting model for: ${action}`);
    const modelOpt = findModelOption(action);
    if (modelOpt) {
      console.log(`Found model option: "${modelOpt.textContent.trim()}". Clicking...`);
      clickElement(modelOpt);
      await sleep(1000);
    } else {
      console.warn('Model option not found in popover.');
    }
    
    // 3. Select Aspect Ratio
    if (aspect_ratio) {
      console.log(`Selecting aspect ratio: ${aspect_ratio}`);
      const ratioOpt = findRatioOption(aspect_ratio);
      if (ratioOpt) {
        console.log(`Found aspect ratio option: "${ratioOpt.textContent.trim()}". Clicking...`);
        clickElement(ratioOpt);
        await sleep(1000);
      } else {
        console.warn('Aspect ratio option not found in popover.');
      }
    }
    
    // 4. Select Duration (only for video)
    if (action === 'generate_video') {
      const targetDuration = duration || 6;
      console.log(`Selecting video duration: ${targetDuration}s`);
      const durationOpt = findDurationOption(targetDuration);
      if (durationOpt) {
        console.log(`Found duration option: "${durationOpt.textContent.trim()}". Clicking...`);
        clickElement(durationOpt);
        await sleep(1000);
      } else {
        console.warn('Duration option not found in popover.');
      }
    }
    
    // Close settings popover by toggling the button closed
    console.log('Closing settings popover...');
    clickElement(settingsBtn);
    await sleep(800);
  } else {
    console.warn('Could not locate settings trigger button on the page. Proceeding with defaults.');
  }
  
  // ── Step 3: Enter prompt & generation wrapper with retry on safety block ──
  const promptInput = await waitForElement("div[role='textbox'], div[data-slate-editor='true']", 15000);
  
  // Track pre-existing assets BEFORE submitting the prompt to avoid matching old assets
  const assetSelector = action === 'generate_image'
    ? "[data-testid='image-result'] img, .generated-image img, img[alt*='generated'], img[src*='googleusercontent'], img[src*='blob:']"
    : "video[src], [data-testid='video-result'] video, .generated-video video, video";
  const preExistingAssets = Array.from(document.querySelectorAll(assetSelector))
    .map(el => el.getAttribute('src'))
    .filter(Boolean);
  console.log(`Tracking ${preExistingAssets.length} pre-existing asset URLs to avoid premature matching.`);

  let currentPrompt = prompt;
  const maxAttempts = 3;
  let resultElement = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Starting generation attempt ${attempt} of ${maxAttempts} with prompt: "${currentPrompt}"`);
    
    // Clear prompt textbox first
    promptInput.click();
    await sleep(200);
    promptInput.focus();
    document.execCommand('selectAll', false, null);
    await sleep(100);
    document.execCommand('delete', false, null);
    await sleep(300);

    // ── Inject text via postMessage to MAIN world injector.js ─────────────────
    // CSP blocks inline <script> injection. Instead, we communicate with injector.js
    // which runs in the PAGE's MAIN world (declared in manifest.json with "world":"MAIN").
    // injector.js has full access to React fiber and Slate internals.
    const injectResult = await new Promise((resolve) => {
      // Listen for response from MAIN world injector
      const resultHandler = (event) => {
        if (event.data && event.data.source === 'FLOW_EXTENSION_INJECTOR' && event.data.type === 'SLATE_INSERT_RESULT') {
          window.removeEventListener('message', resultHandler);
          clearTimeout(fallbackTimer);
          resolve(event.data.result);
        }
      };
      window.addEventListener('message', resultHandler);
      
      // Timeout fallback if injector doesn't respond within 3s
      const fallbackTimer = setTimeout(() => {
        window.removeEventListener('message', resultHandler);
        resolve('timeout');
      }, 3000);
      
      // Send request to MAIN world injector
      window.postMessage({
        source: 'FLOW_EXTENSION_CONTENT',
        type: 'SLATE_INSERT_TEXT',
        text: currentPrompt
      }, '*');
    });
    
    console.log('Slate injection result via MAIN world injector:', injectResult);
    
    // If MAIN world injection failed or timed out, fall back to execCommand
    if (injectResult !== 'success') {
      console.warn('MAIN world injection failed, using execCommand fallback:', injectResult);
      promptInput.focus();
      await sleep(100);
      document.execCommand('insertText', false, currentPrompt);
      await sleep(300);
    }
    
    const typedText = promptInput.textContent || "";
    console.log(`Editor content after injection: "${typedText.substring(0, 60)}"`);
    await sleep(500);
    
    // Submit prompt
    await sleep(1500); // Wait longer for Slate to register text and enable the submit button
    
    // Find the submit button — look for arrow_forward icon button
    let submitBtn = null;
    const allPageBtns = document.querySelectorAll("button");
    for (let b of allPageBtns) {
      // Match the arrow_forward icon button (not the + upload button)
      const iTag = b.querySelector("i");
      if (iTag && iTag.textContent.trim() === "arrow_forward") {
        submitBtn = b;
        break;
      }
    }
    
    if (!submitBtn) {
      // Fallback: find button with Create text but not the + add button
      for (let b of allPageBtns) {
        const txt = b.textContent.trim();
        const iTag = b.querySelector("i");
        const iText = iTag?.textContent.trim() || "";
        // + button has "add" icon, skip it
        if (txt.includes("Create") && iText !== "add") {
          submitBtn = b;
          break;
        }
      }
    }
    
    if (submitBtn) {
      console.log(`Found submit button: "${submitBtn.textContent.trim()}". Removing disabled state and clicking...`);
      // Forcefully remove the aria-disabled and disabled attributes so React allows the click
      submitBtn.removeAttribute("aria-disabled");
      submitBtn.removeAttribute("disabled");
      submitBtn.disabled = false;
      await sleep(100);
      clickElement(submitBtn);
      await sleep(1500);
    } else {
      console.warn('Could not locate submit button at all. Trying keyboard Enter fallback...');
      // Last resort: press Enter on the textbox
      promptInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
      await sleep(1500);
    }
    
    // Poll until element is present or safety error dialog appears
    console.log('Generation started. Waiting for completion or safety block...');
    const timeoutLimit = action === 'generate_image' ? 120000 : 360000; // 2 mins for image, 6 mins for video
    const startTime = Date.now();
    let errorDetected = null;
    
    while (Date.now() - startTime < timeoutLimit) {
      // 1. Check for success (Asset loaded)
      const elements = document.querySelectorAll(assetSelector);
      for (let el of elements) {
        const srcAttr = el.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('data:image/svg+xml') && srcAttr.length > 5 && !preExistingAssets.includes(srcAttr)) {
          // Additional safety check: make sure it is not a tiny UI icon/avatar (avatars are usually < 96px)
          if (action === 'generate_image') {
            const isImageTag = el.tagName.toLowerCase() === 'img';
            if (isImageTag) {
              const width = el.naturalWidth || el.width || 0;
              const height = el.naturalHeight || el.height || 0;
              if (width < 100 && height < 100 && width > 0 && height > 0) {
                continue; // Skip tiny icons/avatars
              }
            }
          }
          resultElement = el;
          break;
        }
      }
      if (resultElement) {
        console.log('New result asset loaded successfully with source:', resultElement.getAttribute('src'));
        break;
      }
      
      // 2. Check for safety/unusual activity errors
      errorDetected = checkGenerationError();
      if (errorDetected) {
        console.warn(`Error/Safety filter detected: ${errorDetected}`);
        break;
      }
      
      await sleep(2000);
    }
    
    if (resultElement) {
      break; // Successfully generated and matched the asset!
    }
    
    // If we reach here, it failed. Tweak prompt and retry if we have remaining attempts.
    if (attempt < maxAttempts) {
      console.log(`Attempt ${attempt} failed. Dismissing error popup and preparing next attempt...`);
      currentPrompt = tweakPrompt(prompt, attempt + 1);
      
      // Dismiss error dialog
      try {
        const dismissBtns = document.querySelectorAll("button");
        for (let btn of dismissBtns) {
          const txt = btn.textContent.trim().toLowerCase();
          if (txt === "dismiss" || txt === "ok" || txt === "close" || txt === "got it") {
            clickElement(btn);
            await sleep(1000);
            break;
          }
        }
      } catch (e) {
        console.warn("Could not dismiss error popup:", e);
      }
    } else {
      throw new Error(errorDetected || `Generation failed on all ${maxAttempts} attempts.`);
    }
  }
  
  if (!resultElement) {
    throw new Error(`Generation timed out or new result asset (${assetSelector}) not found.`);
  }
  
  // Add another small sleep to make sure final file download buffer is stable
  await sleep(2000);
  
  const assetUrl = resultElement.getAttribute('src');
  if (!assetUrl) {
    throw new Error('Result element found, but "src" attribute is missing or empty.');
  }
  
  // ── Step 6: Fetch file data & convert to base64 ────────────────────────────
  console.log('Fetching asset data from URL:', assetUrl);
  const fileBlob = await fetchAssetBlob(assetUrl);
  const dataUrl = await convertBlobToDataUrl(fileBlob);
  
  // Trigger local browser download safely using same-origin Blob URL to prevent page navigation
  try {
    const blobUrl = URL.createObjectURL(fileBlob);
    const downloadLink = document.createElement('a');
    downloadLink.href = blobUrl;
    const ext = action === 'generate_image' ? 'png' : 'mp4';
    downloadLink.download = `scene_${params.scene_number || '0'}_${action}.${ext}`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    
    // Cleanup blob URL after a short timeout to let download start
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(blobUrl);
    }, 1000);
    console.log('Local browser download triggered safely via Blob URL.');
  } catch (e) {
    console.error('Failed to trigger local browser download:', e);
  }
  
  let thumbnailDataUrl = null;
  if (action === 'generate_video') {
    thumbnailDataUrl = await extractVideoThumbnail(assetUrl);
  }
  
  return {
    success: true,
    dataUrl: dataUrl,
    thumbnailDataUrl: thumbnailDataUrl
  };
}

// Helper to extract a thumbnail from a video URL (under page origin to prevent CORS canvas taint)
function extractVideoThumbnail(videoUrl) {
  return new Promise((resolve) => {
    console.log('Extracting video thumbnail from URL:', videoUrl);
    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.currentTime = 0.5; // Seek to 0.5 seconds to capture a valid frame (not black)
    video.muted = true;
    video.playsInline = true;
    
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        console.log('Successfully captured video frame as PNG data URL.');
        resolve(dataUrl);
      } catch (err) {
        console.error('Failed to draw video frame to canvas:', err);
        resolve(null);
      }
    };
    
    video.onerror = (e) => {
      console.error('Failed to load video for thumbnail extraction:', e);
      resolve(null);
    };
    
    video.load();
  });
}

// Fetch blob under Google's page origin to bypass CORS restrictions
async function fetchAssetBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset from URL (${url}): HTTP ${response.status}`);
  }
  return await response.blob();
}

// Convert Blob to Data URL Base64
function convertBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reader.abort();
      reject(new Error('Failed to parse asset data as DataURL.'));
    };
    reader.onloadend = () => {
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

// Accept keep-alive port connections from background script to keep service worker active during generation
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keep-alive") {
    port.onMessage.addListener((msg) => {
      // Heartbeat message received
    });
  }
});

// Periodically send a message to background.js to prevent it from going to sleep while idle
setInterval(() => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({ type: 'KEEP_ALIVE' }).catch(() => {});
    }
  } catch (e) {
    // Ignore extension context invalidated errors silently
  }
}, 10000);
