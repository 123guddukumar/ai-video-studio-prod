let socket = null;
let serverUrl = 'http://localhost:8001';
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
    const logs = data.logs || [];
    logs.push({ text, level, timestamp: Date.now() });
    // Cap logs to last 200
    if (logs.length > 200) logs.shift();
    chrome.storage.local.set({ logs });
    
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
    // Keep-alive message from content script, do nothing. Just handling it wakes up/keeps worker alive.
    if (sendResponse) sendResponse({ status: 'ok' });
    return true;
  }

  if (message.action === 'connect') {
    serverUrl = message.serverUrl;
    // Save URL to storage
    chrome.storage.local.set({ serverUrl }, () => {
      connectWebSocket();
    });
  } else if (message.action === 'disconnect') {
    disconnectWebSocket();
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

// Connect WebSocket
function connectWebSocket() {
  if (socket) {
    socket.close();
  }
  
  const wsUrl = getWsUrl(serverUrl);
  log(`Connecting to server at ${wsUrl}...`, 'info');
  setStatus('disconnected');
  
  try {
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      log('Connected to Flow Worker backend!', 'success');
      setStatus('connected');
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
    };
    
    socket.onerror = (error) => {
      log('WebSocket error occurred.', 'error');
      setStatus('disconnected');
    };
  } catch (err) {
    log(`Connection failed: ${err.message}`, 'error');
    setStatus('disconnected');
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
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

// Helper: Ensure Google Flow tab is open and loaded
async function ensureFlowTab() {
  const targetUrl = 'https://labs.google/fx/tools/flow';
  
  // Find if there's already a tab matching this
  const tabs = await chrome.tabs.query({});
  let flowTab = tabs.find(t => t.url && t.url.includes('labs.google/fx/tools/flow'));
  
  if (flowTab) {
    log(`Found existing Google Flow tab (ID: ${flowTab.id}). Activating it.`, 'info');
    await chrome.tabs.update(flowTab.id, { active: true });
    // Bring window to focus
    await chrome.windows.update(flowTab.windowId, { focused: true });
    return flowTab.id;
  }
  
  log('Opening new Google Flow tab...', 'info');
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  
  // Wait for loading to finish
  return new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        log('Google Flow tab fully loaded.', 'info');
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
  const tabId = await ensureFlowTab();
  
  // Wait 2.5 seconds to make sure DOM is fully settled
  await new Promise(r => setTimeout(r, 2500));
  
  if (task.action === 'generate_scene') {
    // Generate video directly (skipping image generation)
    log('Starting Direct Video Generation (Skipping Image Step)...', 'info');
    const videoResult = await runGenerationInTab(tabId, {
      action: 'generate_video',
      prompt: task.video_prompt,
      duration: task.duration,
      aspect_ratio: task.aspect_ratio,
      imageUrl: task.image_url
    });
    
    log('Video generation completed by content script, preparing upload...', 'info');
    const videoUploaded = await uploadAsset(task, 'video', videoResult.dataUrl);
    if (!videoUploaded) throw new Error('Video upload failed');
    
    // Extract thumbnail from video data URL and upload as image for compatibility
    try {
      log('Extracting video thumbnail for UI dashboard...', 'info');
      const thumbnailDataUrl = videoResult.thumbnailDataUrl || videoResult.dataUrl;
      const imgUploaded = await uploadAsset(task, 'image', thumbnailDataUrl);
      if (imgUploaded) {
        log('Uploaded video thumbnail successfully!', 'success');
      }
    } catch (e) {
      log(`Failed to upload video thumbnail: ${e.message}`, 'warning');
    }
    
    log('Assets generated and uploaded successfully!', 'success');
    sendTaskResult(task.task_id, true);
    setStatus('connected');
  } else if (task.action === 'generate_image') {
    const result = await runGenerationInTab(tabId, {
      action: 'generate_image',
      prompt: task.image_prompt,
      aspect_ratio: task.aspect_ratio
    });
    
    const uploaded = await uploadAsset(task, 'image', result.dataUrl);
    if (!uploaded) throw new Error('Image upload failed');
    
    log('Image asset generated and uploaded successfully!', 'success');
    sendTaskResult(task.task_id, true);
    setStatus('connected');
    
  } else if (task.action === 'generate_video') {
    const result = await runGenerationInTab(tabId, {
      action: 'generate_video',
      prompt: task.video_prompt,
      duration: task.duration,
      aspect_ratio: task.aspect_ratio
    });
    
    const uploaded = await uploadAsset(task, 'video', result.dataUrl);
    if (!uploaded) throw new Error('Video upload failed');
    
    log('Video asset generated and uploaded successfully!', 'success');
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
