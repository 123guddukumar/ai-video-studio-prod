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
  const allButtons = document.querySelectorAll("button, [role='button'], div, span");
  for (let btn of allButtons) {
    const text = (btn.textContent || "").trim();
    const textLower = text.toLowerCase();
    
    // Signature based settings button detection
    const hasMode = textLower.startsWith("video") || textLower.startsWith("image") || textLower.startsWith("animate");
    const hasSetting = textLower.includes("720p") || textLower.includes("1080p") || textLower.includes("x1") || textLower.includes("x4") || textLower.includes("6s") || textLower.includes("3s") || textLower.includes("12s") || text.includes(" · ");
    
    if (hasMode && hasSetting && text.length < 50) {
      settingsBtn = btn;
      break;
    }
  }

  if (settingsBtn) {
    console.log(`Found settings button: "${settingsBtn.textContent.trim()}". Clicking to open popover...`);
    settingsBtn.click();
    await sleep(1200); // Wait for popover to open
    
    // 1. Select Mode (Image vs Video)
    console.log(`Selecting mode option for: ${action}`);
    const modeOpt = findModeOption(action);
    if (modeOpt) {
      console.log(`Found mode option in popover: "${modeOpt.textContent.trim()}". Clicking...`);
      modeOpt.click();
      await sleep(1000);
    } else {
      console.warn('Mode option not found in popover.');
    }

    // 2. Select Model (Nano / Fast)
    console.log(`Selecting model for: ${action}`);
    const modelOpt = findModelOption(action);
    if (modelOpt) {
      console.log(`Found model option: "${modelOpt.textContent.trim()}". Clicking...`);
      modelOpt.click();
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
        ratioOpt.click();
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
        durationOpt.click();
        await sleep(1000);
      } else {
        console.warn('Duration option not found in popover.');
      }
    }
    
    // Close settings popover by toggling the button closed
    console.log('Closing settings popover...');
    settingsBtn.click();
    await sleep(800);
  } else {
    console.warn('Could not locate settings trigger button on the page. Proceeding with defaults.');
  }
  
  // ── Step 3: Enter prompt character-by-character (Human simulation) ─────────
  console.log('Entering prompt text character-by-character...');
  const promptInput = await waitForElement("div[role='textbox'], div[data-slate-editor='true']", 15000);
  
  // Track pre-existing assets BEFORE submitting the prompt to avoid matching old assets
  const assetSelector = action === 'generate_image'
    ? "[data-testid='image-result'], img[src], .generated-image"
    : "video[src], [data-testid='video-result'] video, .generated-video video, video";
  const preExistingAssets = Array.from(document.querySelectorAll(assetSelector))
    .map(el => el.getAttribute('src'))
    .filter(Boolean);
  console.log(`Tracking ${preExistingAssets.length} pre-existing asset URLs to avoid premature matching.`);
  
  // Click and focus the prompt box
  promptInput.click();
  await sleep(200);
  promptInput.focus();

  // Select all existing text so that typing the first character replaces it safely (no crash)
  let range = document.createRange();
  let sel = window.getSelection();
  range.selectNodeContents(promptInput);
  sel.removeAllRanges();
  sel.addRange(range);
  await sleep(200);
  
  // Type character-by-character letting browser handle cursor movements and React state updates natively
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i];
    
    // Dispatch keydown
    promptInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: char,
      code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true
    }));
    
    // Dispatch beforeinput (Critical for React Slate.js to register key input)
    promptInput.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: char,
      bubbles: true,
      cancelable: true
    }));
    
    // Insert character (this replaces selected text on index 0, and appends for the rest)
    document.execCommand('insertText', false, char);
    
    // Dispatch input
    promptInput.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText',
      data: char,
      bubbles: true
    }));
    
    // Dispatch keyup
    promptInput.dispatchEvent(new KeyboardEvent('keyup', {
      key: char,
      code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true
    }));
    
    await sleep(15 + Math.random() * 20); // 15-35ms human-like delay
  }
  
  console.log('Prompt typed successfully.');
  await sleep(800);
  
  // ── Step 4: Submit prompt (Press Enter and fallback to click) ──────────────
  console.log('Submitting prompt with Enter key events...');
  
  // Geometrically locate the actual submit button on the right side of the prompt input
  const promptRect = promptInput.getBoundingClientRect();
  const btns = Array.from(document.querySelectorAll("button, [role='button'], .submit-btn, div[class*='submit'], div[class*='generate'], div[class*='send'], span[class*='send'], i[class*='send'], svg[class*='send']"));
  let submitBtn = null;
  let maxLeft = 0;
  for (let btn of btns) {
    const rect = btn.getBoundingClientRect();
    // Must be on the right side of the prompt input and vertically aligned with it
    if (rect.left > promptRect.right - 120 && Math.abs(rect.top - promptRect.top) < 60) {
      if (rect.left > maxLeft) {
        maxLeft = rect.left;
        submitBtn = btn;
      }
    }
  }
  
  // Dispatch Enter key events on the text box
  const createEvents = (type) => new KeyboardEvent(type, {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  
  promptInput.dispatchEvent(createEvents('keydown'));
  promptInput.dispatchEvent(createEvents('keypress'));
  promptInput.dispatchEvent(createEvents('keyup'));
  
  await sleep(800); // Wait for Slate to process Enter
  
  // Safe Fallback: Only click the submit button if the prompt text is still present in the input box!
  if (promptInput.textContent.trim().length > 0) {
    console.log('Enter key did not submit. Clicking the geometric submit button on the right...');
    if (submitBtn) {
      submitBtn.click();
      await sleep(1000);
    } else {
      console.warn('Could not locate geometric submit button to click.');
    }
  } else {
    console.log('Enter key successfully submitted the prompt.');
  }
  
  // ── Step 5: Wait for generation & download ────────────────────────────────
  console.log('Generation started. Waiting for completion...');
  const timeoutLimit = action === 'generate_image' ? 120000 : 360000; // 2 mins for image, 6 mins for video
  
  // Poll until element is present
  const startTime = Date.now();
  let resultElement = null;
  
  while (Date.now() - startTime < timeoutLimit) {
    const elements = document.querySelectorAll(assetSelector);
    for (let el of elements) {
      const srcAttr = el.getAttribute('src');
      if (srcAttr && !srcAttr.startsWith('data:image/svg+xml') && srcAttr.length > 5 && !preExistingAssets.includes(srcAttr)) {
        resultElement = el;
        break;
      }
    }
    if (resultElement) {
      console.log('New result asset loaded successfully with source:', resultElement.getAttribute('src'));
      break;
    }
    await sleep(2000);
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
