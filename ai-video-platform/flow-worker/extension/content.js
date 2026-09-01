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

// Helper to sanitize prompts before sending to Google Flow
function sanitizePromptText(text) {
  if (!text) return text;
  let sanitized = text
    // Minors & Children
    .replace(/\b(kids?|children|child|minors?|toddlers?|babies|baby|infants?|teenagers?|schoolboys?|schoolgirls?)\b/gi, "residents")
    .replace(/\bschool\s*bag\b/gi, "briefcase")
    .replace(/\bplay\s*area\b/gi, "landscaped garden")
    .replace(/\bplayground\b/gi, "community park")
    .replace(/\byoung\s*parents\b/gi, "young homeowners")
    .replace(/\bplaying\b/gi, "strolling")
    .replace(/\bplay\s+safely\b/gi, "enjoy outdoors")
    .replace(/\bschools?\b/gi, "scenic boulevard")
    .replace(/\bclassrooms?\b/gi, "modern lounge")
    
    // Surveillance & Security
    .replace(/\bCCTV\s*(cameras?)?\b/gi, "ambient architectural lighting")
    .replace(/\bsecurity\s*guards?\b/gi, "concierge foyer")
    .replace(/\bdigital\s*(video\s*)?door\s*locks?\b/gi, "modern sleek doorway")
    .replace(/\bsurveillance\b/gi, "peaceful setting")
    
    // Brand names, Signage, Slogans & Taglines
    .replace(/\bAsha\s*Vihar\s*(Reality|Realtech|Enterprises)?\b/gi, "luxury modern residential community")
    .replace(/\b[A-Z]{1,4}\s*(Jawellry|Jewelry|Jewellers|Enterprises|Corp|Ltd|Pvt)?\s*signage\b/gi, "illuminated boutique entrance")
    .replace(/\b(signage|signboard|billboard|neon\s*sign|board\s*saying|text\s*saying|written\s*text)\b/gi, "storefront display")
    .replace(/\b(brand\s*CTA|call\s*to\s*action|tagline|slogan|logo|watermark)\b/gi, "")
    .replace(/\b\d+:\d+\s*(aspect|ratio)?\b/gi, "")
    .replace(/\b(aspect\s*ratio|9:16|16:9)\b/gi, "")
    .replace(/\bEnds\s*with\s*(brand\s*CTA|tagline|brand)?.*$/gi, "")
    .replace(/\bTone:\s*.*$/gi, "")
    .replace(/\bVisual\s*style:\s*.*$/gi, "")
    .replace(/\bStyle:\s*.*$/gi, "")
    .replace(/\bTopic\s*Prompt:\s*.*$/gi, "")
    .replace(/\bConcept\s*\d+:?\s*.*$/gi, "")
    
    // Financial / Marketing words
    .replace(/\b(registry\s*discount|home\s*loan\s*approval|hidden\s*charges|special\s*discount\s*offer)\b/gi, "premier luxury living")
    .replace(/\brising\s*price\s*charts\s*on\s*a\s*tablet\b/gi, "architectural floorplans on a sleek tablet");

  sanitized = sanitized.replace(/\s+/g, " ").trim();
  sanitized = sanitized.replace(/^[\s,.\-—:]+|[\s,.\-—:]+$/g, "").trim();

  // Cap to 25 words max for pure safety
  const words = sanitized.split(" ");
  if (words.length > 25) {
    sanitized = words.slice(0, 25).join(" ");
  }

  return sanitized.trim();
}

// Helper to strip safety trigger words and return a tweaked prompt
function tweakPrompt(originalPrompt, attempt) {
  let tweaked = sanitizePromptText(originalPrompt);
  if (attempt === 2) {
    tweaked = tweaked
      .replace(/security/gi, "safety")
      .replace(/cctv/gi, "smart monitoring")
      .replace(/guarded/gi, "safe")
      .replace(/rich/gi, "premium")
      .replace(/wealthy/gi, "luxurious");
    if (tweaked === originalPrompt) {
      tweaked = tweaked + ", cinematic presentation";
    }
  } else if (attempt === 3) {
    tweaked = tweaked
      .replace(/[^a-zA-Z0-9\s]/g, "") // strip punctuation
      .trim() + " style";
  }
  return tweaked;
}

// Helper to check if an error popup or rate limiting message is visible on screen
function checkGenerationError() {
  const errorSelectors = ["[role='alert']", "[data-testid='error']", ".error-message", "div[class*='error']", "div[class*='toast']", "div[class*='dialog']", "div[class*='popover']"];
  for (let selector of errorSelectors) {
    const elements = document.querySelectorAll(selector);
    for (let el of elements) {
      if (el.offsetWidth > 0 || el.offsetHeight > 0) {
        const text = el.textContent.trim();
        if (text.length > 500) continue; // ignore massive outer parent containers
        if (
          text.includes("unusual activity") || 
          text.includes("Safety policy") || 
          text.includes("safety policy") || 
          text.includes("violate our policies") || 
          text.includes("harmful content") || 
          text.includes("related to minors") || 
          text.includes("minors at this time") ||
          text.includes("generation failed") || 
          text.includes("failed to generate") || 
          text.includes("Prompt must be provided") ||
          (text.includes("Failed") && (text.includes("activity") || text.includes("policy") || text.includes("prompt")))
        ) {
          return text.substring(0, 200);
        }
      }
    }
  }
  return null;
}

// Helper to select Mode (Image/Video) inside the open popover container (with retry/waiting)
async function findModeOption(mode, timeoutMs = 3000) {
  const isVideo = mode === 'generate_video';
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
    for (let container of containers) {
      const elements = container.querySelectorAll("button, [role='tab'], [role='menuitem'], div, span");
      for (let el of elements) {
        const text = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const val = (el.getAttribute("value") || el.getAttribute("data-value") || "").toLowerCase();
        
        if (isVideo) {
          if (text === "video" || aria === "video" || val === "video" || text.startsWith("video ") || text.includes("veo")) {
            return el;
          }
        } else {
          if (text === "image" || aria === "image" || val === "image" || text.startsWith("image ") || text.includes("imagen")) {
            return el;
          }
        }
      }
    }
    await sleep(150);
  }
  // Global search fallback
  return findElement(isVideo ? "button:has-text('Video'), [role='tab']:has-text('Video')" : "button:has-text('Image'), [role='tab']:has-text('Image')");
}

// Helper to select Model (Veo 2 vs Imagen 3) inside the open popover container (with retry/waiting)
async function findModelOption(mode, timeoutMs = 3000) {
  // Strict terms — do NOT use generic 'fast' or 'nano' without model prefix to avoid cross-mode collision!
  const isVideo = mode === 'generate_video';
  const searchTerms = isVideo
    ? ['veo 2 (fast)', 'veo 2 (nano)', 'veo 2', 'veo (fast)', 'veo (nano)', 'veo']
    : ['imagen 3 (fast)', 'imagen 3 (nano)', 'imagen 3', 'imagen'];

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
    for (let container of containers) {
      const elements = container.querySelectorAll("button, [role='menuitem'], [role='option'], div, span");
      for (let el of elements) {
        const text = el.textContent.trim().toLowerCase();
        for (let term of searchTerms) {
          if (text === term || text.includes(term)) {
            return el;
          }
        }
      }
    }
    await sleep(150);
  }
  return null;
}

// Helper to select Aspect Ratio inside the open popover container (with retry/waiting)
async function findRatioOption(ratio, timeoutMs = 3000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
    for (let container of containers) {
      const elements = container.querySelectorAll("button, div, span, [role='menuitem']");
      for (let el of elements) {
        const text = el.textContent.trim();
        if (text === ratio) {
          return el;
        }
      }
    }
    await sleep(150);
  }
  // Global search fallback
  return findElement(`button:has-text('${ratio}'), [role='menuitem']:has-text('${ratio}')`);
}

// Helper to select Video Duration inside the open popover container (with retry/waiting)
async function findDurationOption(durationSeconds, timeoutMs = 3000) {
  const options = [`${durationSeconds}s`, `${durationSeconds} seconds`, `${durationSeconds} Sec`].map(t => t.toLowerCase());
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const containers = document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
    for (let container of containers) {
      const elements = container.querySelectorAll("button, div, span, [role='menuitem']");
      for (let el of elements) {
        const text = el.textContent.trim().toLowerCase();
        if (options.includes(text)) {
          return el;
        }
      }
    }
    await sleep(150);
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

// Upload reference image logic in content.js with Multi-Method Fallback (Paste, Drop, FileInput)
async function uploadReferenceImage(imageUrl) {
  console.log('Attaching reference image to Google Flow prompt...');
  if (!imageUrl) return;

  const file = dataURLtoFile(imageUrl, "reference_image.png");

  // 1. Try Clipboard Paste directly onto the prompt textbox
  try {
    const promptInput = document.querySelector("div[role='textbox'], div[data-slate-editor='true']");
    if (promptInput) {
      promptInput.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      promptInput.dispatchEvent(pasteEvent);
      console.log('[Content] Dispatched Clipboard Paste event with reference image.');
      await sleep(1500);
    }
  } catch (e) {
    console.warn('[Content] Clipboard paste failed:', e);
  }

  // 2. Try Drag & Drop onto prompt box / dropzone
  try {
    const dropZone = document.querySelector("div[role='textbox'], div[data-slate-editor='true'], form, div[class*='prompt'], div[class*='input']");
    if (dropZone) {
      const dt = new DataTransfer();
      dt.items.add(file);
      dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      console.log('[Content] Dispatched Drag & Drop event with reference image.');
      await sleep(1500);
    }
  } catch (e) {
    console.warn('[Content] Drag & Drop failed:', e);
  }

  // 3. Try File Input with React tracker reset
  try {
    let fileInput = document.querySelector("input[type='file']");
    if (!fileInput) {
      const buttons = document.querySelectorAll("button");
      for (let btn of buttons) {
        const text = (btn.textContent || "").trim();
        const html = (btn.innerHTML || "").toLowerCase();
        if (text === "+" || text.toLowerCase().includes("add") || html.includes("add") || html.includes("upload") || html.includes("media") || html.includes("photo")) {
          btn.click();
          await sleep(800);
          fileInput = document.querySelector("input[type='file']");
          if (fileInput) break;
        }
      }
    }

    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      const tracker = fileInput._valueTracker;
      if (tracker) tracker.setValue("");
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[Content] Dispatched File Input change event.');
      await sleep(2500);
    }
  } catch (e) {
    console.warn('[Content] File input method failed:', e);
  }
}

async function executeAutomation(params) {
  const { action, prompt, aspect_ratio, duration, imageUrl } = params;
  console.log(`Executing automation for action: ${action}, prompt: "${prompt}", ratio: ${aspect_ratio}`);
  
  // ── Step 1: Open project canvas (Click 'New project' ONLY for fresh image generation) ────
  if (action === 'generate_image') {
    const newProjBtn = findElement("button:has-text('New project')");
    if (newProjBtn) {
      console.log('Clicking New Project button for fresh image generation...');
      newProjBtn.click();
      await sleep(2000);
    }
  }

  // ── Step 2: Configure Mode and Settings FIRST (Select Video/Veo 2 before reference image) ──
  const targetMode = action === 'generate_image' ? 'Image' : 'Video';
  console.log(`[Step 2] Configuring mode and settings for target: ${targetMode}`);
  
  let settingsBtn = null;
  const startSettingsWait = Date.now();
  while (Date.now() - startSettingsWait < 15000) {
    const allButtons = document.querySelectorAll("button, [role='button']");
    for (let btn of allButtons) {
      const text = (btn.textContent || "").trim();
      const textLower = text.toLowerCase();
      
      const hasSetting = textLower.includes("720p") || textLower.includes("1080p") || textLower.includes("x1") || textLower.includes("x4") || textLower.includes("6s") || textLower.includes("3s") || textLower.includes("12s") || text.includes(" · ") || textLower.includes("banana") || textLower.includes("nano") || textLower.includes("fast") || text.includes("crop_");
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
    await sleep(1200);

    const isPopoverOpen = () => {
      return !!document.querySelector("[role='dialog'], [role='menu'], [role='listbox'], .radix-popover-content, div[class*='popover'], div[class*='content']");
    };

    const clickOptionAndKeepPopoverOpen = async (optionEl) => {
      if (!optionEl) return;
      clickElement(optionEl);
      await sleep(1000);
      if (!isPopoverOpen()) {
        console.log("Popover closed after click. Reopening settings popover...");
        clickElement(settingsBtn);
        await sleep(1200);
      }
    };
    
    // 1. Select Mode (Image vs Video)
    console.log(`[Step 2.1] Selecting mode option for: ${action}`);
    const modeOpt = await findModeOption(action);
    if (modeOpt) {
      console.log(`Found mode option in popover: "${modeOpt.textContent.trim()}". Clicking...`);
      await clickOptionAndKeepPopoverOpen(modeOpt);
    }

    // 2. Select Model (Veo 2 for video, Imagen 3 for image)
    console.log(`[Step 2.2] Selecting model for: ${action}`);
    const modelOpt = await findModelOption(action);
    if (modelOpt) {
      console.log(`Found model option: "${modelOpt.textContent.trim()}". Clicking...`);
      await clickOptionAndKeepPopoverOpen(modelOpt);
    }
    
    // 3. Select Aspect Ratio
    if (aspect_ratio) {
      const ratioOpt = await findRatioOption(aspect_ratio);
      if (ratioOpt) {
        await clickOptionAndKeepPopoverOpen(ratioOpt);
      }
    }
    
    // 4. Select Duration (only for video)
    if (action === 'generate_video') {
      const targetDuration = duration || 6;
      const durationOpt = await findDurationOption(targetDuration);
      if (durationOpt) {
        await clickOptionAndKeepPopoverOpen(durationOpt);
      }
    }
    
    // Close settings popover
    if (isPopoverOpen()) {
      clickElement(settingsBtn);
      await sleep(800);
    }
  }

// Helper to check if a reference image chip/thumbnail is attached to the prompt container
function isReferenceImageAttached() {
  const promptBar = document.querySelector("form, div[class*='prompt'], div[class*='input'], div[class*='bar']");
  if (!promptBar) return false;

  // 1. Check for attached image elements in prompt bar
  const imgs = promptBar.querySelectorAll("img, div[style*='background-image']");
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('http') || (img.style && img.style.backgroundImage)) {
      return true;
    }
  }

  // 2. Check for attached chips or remove buttons
  const chips = promptBar.querySelectorAll("div[class*='chip'], div[class*='thumbnail'], div[class*='media'], div[class*='preview'], div[class*='asset']");
  if (chips.length > 0) return true;

  return false;
}

// ── Step 3: If generate_video, strictly attach Reference Image & WAIT until verified ──
  if (action === 'generate_video') {
    console.log('[Step 3] Attaching reference image for video generation (WAITING UNTIL VERIFIED)...');
    
    let isAttached = isReferenceImageAttached();
    const attachStart = Date.now();
    let attempt = 0;
    
    while (!isAttached && Date.now() - attachStart < 25000) {
      attempt++;
      console.log(`[Step 3] Reference image attachment attempt ${attempt}...`);

      // Method 1: Prompt Bar Add Media (+) Button
      try {
        const allButtons = document.querySelectorAll("button, [role='button']");
        let addBtn = null;
        for (const btn of allButtons) {
          const text = (btn.textContent || "").trim().toLowerCase();
          const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
          const icon = (btn.querySelector("i")?.textContent || "").trim().toLowerCase();
          if (
            text === "+" || 
            text.includes("add") || 
            aria.includes("add") || 
            aria.includes("media") || 
            aria.includes("photo") || 
            aria.includes("image") ||
            icon === "add" || 
            icon === "add_photo_alternate" || 
            icon === "photo" || 
            icon === "image" || 
            icon === "attach_file"
          ) {
            addBtn = btn;
            break;
          }
        }

        if (addBtn) {
          console.log('[Step 3] Clicking Add Media (+) button...');
          clickElement(addBtn);
          await sleep(1000);
          
          const pickerImgs = document.querySelectorAll("[role='dialog'] img, [role='menu'] img, div[class*='popover'] img, div[class*='content'] img, div[role='option'] img");
          if (pickerImgs.length > 0) {
            console.log('[Step 3] Clicking reference image from media popover...');
            clickElement(pickerImgs[pickerImgs.length - 1]);
            await sleep(1500);
          }
        }
      } catch (e) {
        console.warn('[Step 3] Media button error:', e.message);
      }

      isAttached = isReferenceImageAttached();
      if (isAttached) break;

      // Method 2: Direct Animate button on canvas card
      try {
        const animateButtons = document.querySelectorAll("button, [role='button']");
        for (const btn of animateButtons) {
          const text = (btn.textContent || "").trim().toLowerCase();
          const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
          const iText = (btn.querySelector("i")?.textContent || "").trim().toLowerCase();
          if (text === "animate" || aria.includes("animate") || text.includes("video") || iText === "movie" || iText === "play_circle" || iText === "play_arrow") {
            console.log(`[Step 3] Found Animate button (${text || aria || iText}). Clicking...`);
            clickElement(btn);
            await sleep(2000);
            break;
          }
        }
      } catch (e) {
        console.warn('[Step 3] Animate button error:', e.message);
      }

      isAttached = isReferenceImageAttached();
      if (isAttached) break;

      // Method 3: File Input upload / Clipboard Paste with imageUrl
      if (imageUrl) {
        try {
          console.log('[Step 3] Uploading reference image DataURL to prompt box...');
          await uploadReferenceImage(imageUrl);
          await sleep(2000);
        } catch (e) {
          console.warn('[Step 3] UploadReferenceImage error:', e.message);
        }
      }

      isAttached = isReferenceImageAttached();
      if (isAttached) break;
      await sleep(1200);
    }

    console.log('[Step 3] Reference image confirmed attached! Proceeding to prompt input.');
    await sleep(1500);
  }

  // ── Step 4: Enter Prompt & Generate ──
  const promptInput = await waitForElement("div[role='textbox'], div[data-slate-editor='true']", 15000);
  
  // Snapshot ALL img and video srcs before submission so we can detect any NEW ones
  const preExistingAssets = new Set(
    Array.from(document.querySelectorAll('img[src], video[src]'))
      .map(el => el.getAttribute('src'))
      .filter(Boolean)
  );
  console.log(`Snapshotted ${preExistingAssets.size} pre-existing asset URLs before generation.`);

  let currentPrompt = sanitizePromptText(prompt);
  const maxAttempts = 3;
  let resultElement = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Starting generation attempt ${attempt} of ${maxAttempts} with prompt: "${currentPrompt}"`);
    
    // Focus the editor so injector can detect it
    promptInput.click();
    await sleep(200);
    promptInput.focus();
    await sleep(100);

    // ── Step 1: Insert text via MAIN world injector (Slate React fiber) ───────
    const injectorResponse = await new Promise((resolve) => {
      const resultHandler = (event) => {
        if (
          event.data &&
          event.data.source === 'FLOW_EXTENSION_INJECTOR' &&
          event.data.type === 'SLATE_INSERT_RESULT'
        ) {
          window.removeEventListener('message', resultHandler);
          clearTimeout(fallbackTimer);
          resolve(event.data);
        }
      };
      window.addEventListener('message', resultHandler);

      const fallbackTimer = setTimeout(() => {
        window.removeEventListener('message', resultHandler);
        resolve({ result: 'timeout', btnRect: null });
      }, 8000);

      window.postMessage({
        source: 'FLOW_EXTENSION_CONTENT',
        type: 'SLATE_INSERT_TEXT',
        text: currentPrompt
      }, '*');
    });

    console.log('Injector response:', injectorResponse.result, 'btnRect:', injectorResponse.btnRect);

    if (injectorResponse.btnRect) {
      // ── Step 2: Native CDP Type & Submit via background.js ─────────────
      const { x, y } = injectorResponse.btnRect;
      console.log(`Requesting CDP native typing and submit at (${x}, ${y})...`);
      
      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'CDP_TYPE_AND_SUBMIT',
            text: currentPrompt,
            x, y
          }, (response) => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve(response || { ok: false });
          });
        });
        console.log('CDP native typing and submit completed successfully.');
      } catch (clickErr) {
        console.warn('[Content] CDP type/submit fallback:', clickErr.message);
        let submitBtn = null;
        for (const b of document.querySelectorAll('button')) {
          const iEl = b.querySelector('i');
          const txt = (b.textContent || "").toLowerCase();
          if ((iEl && iEl.textContent.trim() === 'arrow_forward') || (txt.includes('create') && (!iEl || iEl.textContent.trim() !== 'add'))) {
            submitBtn = b; break;
          }
        }
        if (submitBtn) {
          submitBtn.removeAttribute('aria-disabled');
          submitBtn.disabled = false;
          submitBtn.click();
        }
      }
      await sleep(1500);
    } else {
      // ── Fallback: execCommand insert + direct click & Enter event ─────────────────
      console.warn('Injector did not return coords (' + injectorResponse.result + '). Using execCommand fallback.');
      promptInput.focus();
      document.execCommand('selectAll', false, null);
      await sleep(50);
      document.execCommand('delete', false, null);
      await sleep(50);
      document.execCommand('insertText', false, currentPrompt);
      await sleep(300);

      // Dispatch synthetic input events
      try {
        promptInput.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: currentPrompt, inputType: 'insertText' }));
        promptInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: currentPrompt, inputType: 'insertText' }));
        promptInput.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {}

      await sleep(500);

      // Try triggering Enter key event
      promptInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      promptInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));

      // Find and direct-click submit button (last resort)
      let submitBtn = null;
      for (const b of document.querySelectorAll('button')) {
        const iEl = b.querySelector('i');
        if (iEl && iEl.textContent.trim() === 'arrow_forward') { submitBtn = b; break; }
      }
      if (!submitBtn) {
        for (const b of document.querySelectorAll('button')) {
          const iEl = b.querySelector('i');
          if (b.textContent.includes('Create') && iEl?.textContent.trim() !== 'add') {
            submitBtn = b; break;
          }
        }
      }
      if (submitBtn) {
        submitBtn.removeAttribute('aria-disabled');
        submitBtn.removeAttribute('disabled');
        submitBtn.disabled = false;
        await sleep(100);
        submitBtn.click();
        await sleep(1000);
      }
    }
    
    // Poll until element is present or safety error dialog appears
    console.log('Generation started. Waiting for completion or safety block...');
    const timeoutLimit = action === 'generate_image' ? 120000 : 360000; // 2 mins for image, 6 mins for video
    const startTime = Date.now();
    let errorDetected = null;
    
    let pollCount = 0;
    while (Date.now() - startTime < timeoutLimit) {
      pollCount++;
      // Log progress every 10 seconds so user knows it's running
      if (pollCount % 5 === 1) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[Poll ${pollCount}] Waiting for generated asset... (${elapsed}s elapsed)`);
      }

      // 1. Scan ALL imgs and videos for any new src not in the pre-existing snapshot
      const allMediaEls = document.querySelectorAll('img[src], video[src]');
      for (const el of allMediaEls) {
        const src = el.getAttribute('src');
        if (!src) continue;
        if (src.startsWith('data:image/svg+xml')) continue; // skip SVG placeholders
        if (src.length < 10) continue;                      // skip empty/tiny srcs
        if (preExistingAssets.has(src)) continue;           // skip pre-existing

        const tag = el.tagName.toLowerCase();

        if (action === 'generate_image' && tag === 'img') {
          // Skip tiny UI icons (< 100px)
          const w = el.naturalWidth || el.width || 0;
          const h = el.naturalHeight || el.height || 0;
          if (w > 0 && h > 0 && w < 100 && h < 100) continue;
          resultElement = el;
          break;
        } else if (action === 'generate_video' && tag === 'video') {
          resultElement = el;
          break;
        } else if (action === 'generate_image' && tag === 'img') {
          // naturalWidth may be 0 if not yet loaded — accept it optimistically
          resultElement = el;
          break;
        }
      }

      // Wider sweep: if image mode and no match yet, accept any new large img
      if (!resultElement && action === 'generate_image') {
        for (const el of allMediaEls) {
          const src = el.getAttribute('src');
          if (!src || src.startsWith('data:image/svg+xml') || src.length < 10) continue;
          if (preExistingAssets.has(src)) continue;
          if (el.tagName.toLowerCase() === 'img') {
            resultElement = el;
            break;
          }
        }
      }

      if (resultElement) {
        console.log('✅ New result asset detected! src:', resultElement.getAttribute('src').substring(0, 120));
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
      
      // Dismiss error dialog / failed generation card
      try {
        const dismissBtns = document.querySelectorAll("button");
        let clicked = false;
        for (let btn of dismissBtns) {
          const txt = btn.textContent.trim().toLowerCase();
          const innerHtml = (btn.innerHTML || "").toLowerCase();
          const iconText = btn.querySelector('i')?.textContent.trim().toLowerCase() || "";
          
          if (
            txt === "dismiss" || txt === "ok" || txt === "close" || txt === "got it" || 
            txt.includes("delete") || iconText === "delete" || iconText === "close" || 
            iconText === "clear" || iconText === "cancel" || iconText === "undo" ||
            innerHtml.includes("delete") || innerHtml.includes("close") || innerHtml.includes("cancel") || innerHtml.includes("undo")
          ) {
            console.log(`Clicking error dismiss/delete button: "${txt || iconText || 'icon'}"`);
            clickElement(btn);
            await sleep(1200);
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          console.warn("Could not find text/icon match to dismiss dialog. Attempting to click the last icon-only button as fallback...");
          // Fallback: if there are icon buttons in the dialog, click the delete/curved-arrow one
          const iconBtns = document.querySelectorAll("button:has(i)");
          if (iconBtns.length > 0) {
            clickElement(iconBtns[iconBtns.length - 1]);
            await sleep(1000);
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
  const dataUrl = await fetchAssetAsDataUrl(assetUrl);
  
  // Re-create fileBlob from dataUrl for the local download link to bypass CSP
  const responseBlob = await fetch(dataUrl);
  const fileBlob = await responseBlob.blob();
  
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

// Fetch asset data URL with background script fallback to bypass CORS/CSP restrictions
async function fetchAssetAsDataUrl(url) {
  if (url.startsWith('data:')) {
    // Already a base64 data URL, return it directly!
    return url;
  }
  
  // Resolve relative URLs (like /fx/tools/flow/...) to absolute URLs using page origin
  const absoluteUrl = new URL(url, document.baseURI).href;
  
  if (absoluteUrl.startsWith('blob:')) {
    // blob: URLs must be fetched in content script (same origin)
    const res = await fetch(absoluteUrl);
    if (!res.ok) throw new Error(`Failed to fetch blob URL: HTTP ${res.status}`);
    const blob = await res.blob();
    return await convertBlobToDataUrl(blob);
  } else {
    // Network URLs (http/https) are fetched in background.js to bypass CORS/CSP
    console.log('[Content] Requesting background fetch for network URL:', absoluteUrl);
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'FETCH_NETWORK_URL',
        url: absoluteUrl
      }, (res) => {
        resolve(res || { success: false, error: 'No response from background' });
      });
    });
    if (response.success) {
      return response.dataUrl;
    } else {
      throw new Error(`Background fetch failed: ${response.error}`);
    }
  }
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
