let socket = null;
let serverUrl = 'http://diin-videoai.duckdns.org:8001';
let runnerState = 'disconnected'; // disconnected, connected, working
let activeTaskId = null;

// Initialize on start
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    runnerState: 'disconnected', 
    logs: [{ text: 'Extension initialized.', level: 'info' }] 
  });
  // Create keep-alive alarm
  chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 0.25 });
});

// Ensure alarms are created when worker wakes up/starts
chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 0.25 });

// Logs helper function
function log(text, level = 'info') {
  console.log(`[${level.toUpperCase()}] ${text}`);
  
  // Stream log to backend WebSocket if open
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({
        type: 'LOG',
        text: text,
        level: level
      }));
    } catch (e) {}
  }
  
  chrome.storage.local.get(['logs'], (data) => {
    let localLogs = data.logs || [];
    localLogs.push({ text, level, timestamp: Date.now() });
    // Cap logs to last 200
    if (localLogs.length > 200) localLogs.shift();
    chrome.storage.local.set({ logs: localLogs });
    
    // Broadcast log to popup if open
    chrome.runtime.sendMessage({ action: 'logAdded', log: { text, level } }).catch(() => {
      // Ignore error when popup is closed
    });
  });
}

// Update status helper
function setStatus(state) {
  runnerState = state;
  chrome.storage.local.set({ runnerState });
  chrome.runtime.sendMessage({ action: 'statusUpdate', state }).catch(() => {
    // Ignore error when popup is closed
  });
}

// Message Listener from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'KEEP_ALIVE') {
    if (sendResponse) sendResponse({ status: 'ok' });
    return true;
  }

  // ── Trusted CDP type & submit request from content script ───────────────
  if (message.type === 'CDP_TYPE_AND_SUBMIT') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return true; }
    const { text, x, y } = message;
    cdpTypeAndSubmit(tabId, text, x, y)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // ── Trusted CDP click request from content script ────────────────────────
  if (message.type === 'CLICK_SUBMIT_BUTTON') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return true; }
    const { x, y } = message;
    cdpTrustedClick(tabId, x, y)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async response
  }

  // ── Network Fetch request from content script (bypasses CORS/CSP) ───────
  if (message.type === 'FETCH_NETWORK_URL') {
    const { url } = message;
    fetchNetworkUrlAsDataUrl(url)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // keep channel open for async response
  }

  if (message.action === 'connect') {
    serverUrl = message.serverUrl;
    chrome.storage.local.set({ serverUrl }, () => {
      connectWebSocket();
    });
  } else if (message.action === 'disconnect') {
    disconnectWebSocket();
  }
});

// Helper to fetch network URL from background and convert to Data URL
async function fetchNetworkUrlAsDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  
  const base64 = btoa(binary);
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

// ── CDP native typing and submit via chrome.debugger ─────────────────────────
async function cdpTypeAndSubmit(tabId, text, x, y) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!e.message.includes('already attached')) throw e;
  }
  try {
    // 1. Select All and delete
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: 65, modifiers: 2, key: 'a', code: 'KeyA'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 65, modifiers: 0, key: 'a', code: 'KeyA'
    });
    await new Promise(r => setTimeout(r, 50));
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace'
    });
    await new Promise(r => setTimeout(r, 100));

    // 2. Native CDP text insertion (triggers real TextInputClient events in Chrome)
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text: text });
    await new Promise(r => setTimeout(r, 300));

    // 3. Dispatch Enter key to submit
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13,
      unmodifiedText: '\r', text: '\r', key: 'Enter', code: 'Enter'
    });
    await new Promise(r => setTimeout(r, 50));
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13,
      unmodifiedText: '\r', text: '\r', key: 'Enter', code: 'Enter'
    });

    // 4. Also click submit button coordinates if provided
    if (x && y) {
      await new Promise(r => setTimeout(r, 200));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1,
        buttons: 1, modifiers: 0, timestamp: Date.now() / 1000
      });
      await new Promise(r => setTimeout(r, 80));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
        buttons: 0, modifiers: 0, timestamp: Date.now() / 1000
      });
    }
  } finally {
    try { await chrome.debugger.detach(target); } catch(e) {}
  }
}

// ── CDP trusted click via chrome.debugger ────────────────────────────────────
async function cdpTrustedClick(tabId, x, y) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!e.message.includes('already attached')) throw e;
  }
  try {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
      buttons: 1, modifiers: 0, timestamp: Date.now() / 1000
    });
    await new Promise(r => setTimeout(r, 80));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
      buttons: 0, modifiers: 0, timestamp: Date.now() / 1000
    });
    
    // Also dispatch trusted Enter key event
    await new Promise(r => setTimeout(r, 100));
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13,
      unmodifiedText: '\r', text: '\r', key: 'Enter', code: 'Enter'
    });
    await new Promise(r => setTimeout(r, 50));
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13,
      unmodifiedText: '\r', text: '\r', key: 'Enter', code: 'Enter'
    });
  } finally {
    try { await chrome.debugger.detach(target); } catch(e) {}
  }
}

let isUserDisconnected = false;

// Alarms listener to keep service worker and WebSocket permanently alive
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAliveAlarm') {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (!isUserDisconnected) {
        log('KeepAlive: Reconnecting WebSocket...', 'info');
        connectWebSocket();
      }
    } else {
      try {
        socket.send(JSON.stringify({ type: 'PING' }));
      } catch (e) {}
    }
  }
});

// Convert Server URL to WS URL
function getWsUrl(url) {
  let wsUrl = url.trim();
  // Remove trailing slashes
  wsUrl = wsUrl.replace(/\/+$/, '');
  
  if (wsUrl.startsWith('http://')) {
    wsUrl = wsUrl.replace('http://', 'ws://');
  } else if (wsUrl.startsWith('https://')) {
    wsUrl = wsUrl.replace('https://', 'wss://');
  } else {
    wsUrl = 'ws://' + wsUrl;
  }
  return `${wsUrl}/extension/ws`;
}

let reconnectTimeout = null;

// Connect WebSocket
function connectWebSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    try { socket.close(); } catch(e) {}
    socket = null;
  }
  
  const wsUrl = getWsUrl(serverUrl);
  log(`Connecting to server at ${wsUrl}...`, 'info');
  setStatus('disconnected');
  
  try {
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      log('Connected to Flow Worker backend!', 'success');
      setStatus('connected');
      isUserDisconnected = false;
      startHeartbeat();
    };
    
    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'PING') {
          socket.send(JSON.stringify({ type: 'PONG' }));
          return;
        }
        
        if (data.type === 'TASK_START') {
          log(`Received new task: ${data.action} for Project: ${data.project_id}, Scene: ${data.scene_number}`, 'info');
          setStatus('working');
          activeTaskId = data.task_id;
          
          try {
            await executeTask(data);
          } catch (err) {
            log(`Task execution failed: ${err.message}`, 'error');
            sendTaskResult(data.task_id, false, err.message);
            setStatus('connected');
          }
        }
      } catch (e) {
        log(`Error processing message: ${e.message}`, 'error');
      }
    };
    
    socket.onclose = (event) => {
      log('WebSocket connection closed.', 'warning');
      setStatus('disconnected');
      socket = null;
      stopHeartbeat();
      
      // Auto reconnect immediately if not manually disconnected
      if (!isUserDisconnected) {
        reconnectTimeout = setTimeout(() => {
          log('Auto-reconnecting to backend WebSocket...', 'info');
          connectWebSocket();
        }, 2000);
      }
    };
    
    socket.onerror = (error) => {
      log('WebSocket error occurred.', 'error');
      setStatus('disconnected');
    };
  } catch (err) {
    log(`Connection failed: ${err.message}`, 'error');
    setStatus('disconnected');
    if (!isUserDisconnected) {
      reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
  isUserDisconnected = true;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  log('Disconnected by user request.', 'info');
  setStatus('disconnected');
}

// Heartbeat mechanism to prevent socket drops
let heartbeatInterval = null;
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'PING' }));
    }
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Helper: Get or create Google Flow tab based on task action
// For generate_image/scene: Opens a fresh clean tab
// For generate_video: Reuses existing tab where image was just generated!
async function getFlowTabForTask(action) {
  const targetUrl = 'https://labs.google/fx/tools/flow';
  const tabs = await chrome.tabs.query({});
  const flowTabs = tabs.filter(t => t.url && t.url.includes('labs.google/fx/tools/flow'));

  if (action === 'generate_video') {
    // If video task: find existing tab with the generated image
    if (flowTabs.length > 0) {
      const existingTab = flowTabs[flowTabs.length - 1];
      log(`Reusing existing Google Flow tab (ID: ${existingTab.id}) containing generated image...`, 'info');
      try {
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
      } catch (e) {}
      return existingTab.id;
    }
  }

  // For fresh scene or image: close old tabs to prevent canvas clutter
  for (const oldTab of flowTabs) {
    await chrome.tabs.remove(oldTab.id).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 600));

  log('Opening brand new clean Google Flow tab...', 'info');
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {}
  
  return new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        log('Google Flow tab fully loaded and ready.', 'info');
        resolve(tab.id);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Send task response to WS
function sendTaskResult(taskId, success, errorMsg = '') {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'TASK_COMPLETE',
      task_id: taskId,
      success,
      error: errorMsg
    }));
  }
}

// Orchestrate the task steps by communicating with content script
async function executeTask(task) {
  const tabId = await getFlowTabForTask(task.action);
  
  // Wait 3.5 seconds to make sure DOM is fully settled
  await new Promise(r => setTimeout(r, 3500));
  
  if (task.action === 'generate_scene') {
    // ── STEP 1: Generate Image on Fresh Canvas ──────────────────────────────
    log(`[Scene ${task.scene_number}] Step 1: Generating Image...`, 'info');
    const imageResult = await runGenerationInTab(tabId, {
      action: 'generate_image',
      prompt: task.image_prompt,
      aspect_ratio: task.aspect_ratio,
      imageUrl: task.image_url
    });
    
    if (!imageResult || !imageResult.dataUrl) {
      throw new Error('Image generation failed or returned empty data URL.');
    }
    
    log(`[Scene ${task.scene_number}] Uploading generated image to server...`, 'info');
    const imgUploaded = await uploadAsset(task, 'image', imageResult.dataUrl);
    if (!imgUploaded) throw new Error('Image asset upload to server failed');
    log(`[Scene ${task.scene_number}] Image saved!`, 'success');
    
    await new Promise(r => setTimeout(r, 2000));
    
    // ── STEP 2: Animate the same Generated Image into Video (tab stays open!) ──
    log(`[Scene ${task.scene_number}] Step 2: Animating generated image into Video (Veo 2)...`, 'info');
    const videoResult = await runGenerationInTab(tabId, {
      action: 'generate_video',
      prompt: task.video_prompt,
      duration: task.duration,
      aspect_ratio: task.aspect_ratio,
      imageUrl: imageResult.dataUrl // pass generated image dataUrl as reference!
    });
    
    if (!videoResult || !videoResult.dataUrl) {
      throw new Error('Video generation failed or returned empty data URL.');
    }
    
    log(`[Scene ${task.scene_number}] Uploading generated video to server...`, 'info');
    const videoUploaded = await uploadAsset(task, 'video', videoResult.dataUrl);
    if (!videoUploaded) throw new Error('Video asset upload to server failed');
    log(`[Scene ${task.scene_number}] Video saved!`, 'success');
    
    // ── STEP 3: Close Tab ONLY after BOTH Image and Video are saved! ─────────
    log(`[Scene ${task.scene_number}] Both Image & Video completed! Closing Google Flow tab...`, 'info');
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {}
    
    log(`[Scene ${task.scene_number}] Scene complete and closed cleanly for next scene!`, 'success');
    sendTaskResult(task.task_id, true);
    setStatus('connected');
    
  } else if (task.action === 'generate_image') {
    log(`Generating Image for Scene ${task.scene_number}...`, 'info');
    const result = await runGenerationInTab(tabId, {
      action: 'generate_image',
      prompt: task.image_prompt,
      aspect_ratio: task.aspect_ratio,
      imageUrl: task.image_url
    });
    
    const uploaded = await uploadAsset(task, 'image', result.dataUrl);
    if (!uploaded) throw new Error('Image upload failed');
    
    // KEEP TAB OPEN so video generation can animate this image!
    log('Image generated & saved! Keeping tab open for video animation...', 'success');
    sendTaskResult(task.task_id, true);
    setStatus('connected');
    
  } else if (task.action === 'generate_video') {
    log(`Generating Video from Image for Scene ${task.scene_number}...`, 'info');
    const result = await runGenerationInTab(tabId, {
      action: 'generate_video',
      prompt: task.video_prompt,
      duration: task.duration,
      aspect_ratio: task.aspect_ratio,
      imageUrl: task.image_url
    });
    
    const uploaded = await uploadAsset(task, 'video', result.dataUrl);
    if (!uploaded) throw new Error('Video upload failed');
    
    // Close tab ONLY after video is complete and uploaded!
    log('Video generated & uploaded! Closing tab for next scene...', 'success');
    try { await chrome.tabs.remove(tabId); } catch (e) {}
    
    sendTaskResult(task.task_id, true);
    setStatus('connected');
  }
}

// Run prompt/click automation inside tab
function runGenerationInTab(tabId, params) {
  return new Promise((resolve, reject) => {
    // Open a keep-alive port to the content script to keep service worker active
    let port = null;
    let keepAliveInterval = null;
    try {
      port = chrome.tabs.connect(tabId, { name: "keep-alive" });
      keepAliveInterval = setInterval(() => {
        try {
          port.postMessage({ ping: true });
        } catch (e) {
          // Port disconnected
          clearInterval(keepAliveInterval);
        }
      }, 5000);
    } catch (e) {
      log(`Failed to establish keep-alive port: ${e.message}`, 'warning');
    }

    const cleanup = () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
      if (port) {
        try {
          port.disconnect();
        } catch (e) {}
      }
    };

    const sendMessage = () => {
      // Listen for response
      const messageListener = (msg, sender) => {
        if (sender.tab && sender.tab.id === tabId && msg.type === 'GENERATION_RESPONSE') {
          chrome.runtime.onMessage.removeListener(messageListener);
          cleanup();
          if (msg.success) {
            resolve(msg);
          } else {
            reject(new Error(msg.error || 'Generation failed in content script'));
          }
        }
      };
      
      chrome.runtime.onMessage.addListener(messageListener);
      
      // Trigger command inside content script
      log(`Sending command to content script: ${params.action}`, 'info');
      chrome.tabs.sendMessage(tabId, {
        type: 'START_GENERATION',
        params
      }, async (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          chrome.runtime.onMessage.removeListener(messageListener);
          cleanup();
          
          const isConnectionError = err.message.includes('Could not establish connection') || 
                                    err.message.includes('Receiving end does not exist');
          
          if (isConnectionError) {
            log('Content script connection failed. Attempting programmatic injection of content.js...', 'warning');
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
              });
              log('Content.js injected successfully. Retrying command in 1.5s...', 'info');
              await new Promise(r => setTimeout(r, 1500));
              
              // Retry sending message
              runGenerationInTab(tabId, params).then(resolve).catch(reject);
            } catch (injectErr) {
              reject(new Error(`Failed to inject content script: ${injectErr.message}`));
            }
          } else {
            reject(new Error(`Failed to send message to tab content.js (Make sure tab is active and you are on Google Flow page): ${err.message}`));
          }
        }
      });
    };
    
    sendMessage();
  });
}

// Convert data URL base64 into binary Blob and upload to flow-worker API
async function uploadAsset(task, fileType, dataUrl) {
  log(`Uploading generated ${fileType} to server...`, 'info');
  
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    
    const formData = new FormData();
    const extension = fileType === 'image' ? 'png' : 'mp4';
    formData.append('file', blob, `scene_${task.scene_number}.${extension}`);
    formData.append('task_id', task.task_id);
    formData.append('project_id', task.project_id);
    formData.append('scene_number', task.scene_number.toString());
    formData.append('file_type', fileType);
    
    const uploadUrl = `${serverUrl.replace(/\/+$/, '')}/extension/upload`;
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });
    
    if (response.ok) {
      const result = await response.json();
      log(`Uploaded ${fileType} successfully!`, 'success');
      return true;
    } else {
      const text = await response.text();
      log(`Upload failed with status ${response.status}: ${text}`, 'error');
      return false;
    }
  } catch (e) {
    log(`Network upload error: ${e.message}`, 'error');
    return false;
  }
}

// Keep-alive alarm handler to prevent worker suspension and handle auto-reconnects
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAliveAlarm') {
    chrome.storage.local.get(['runnerState', 'serverUrl'], (data) => {
      const state = data.runnerState || 'disconnected';
      if (state !== 'disconnected') {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          log('Keep-alive: WebSocket connection lost. Reconnecting...', 'warning');
          serverUrl = data.serverUrl || serverUrl;
          connectWebSocket();
        } else {
          // Send a heartbeat ping to verify link is active
          try {
            socket.send(JSON.stringify({ type: 'PING' }));
          } catch (e) {
            log(`Keep-alive heartbeat failed: ${e.message}`, 'warning');
          }
        }
      }
    });
  }
});
