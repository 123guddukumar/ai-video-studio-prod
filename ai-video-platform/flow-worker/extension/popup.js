// DOM elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const serverUrlInput = document.getElementById('server-url');
const connectBtn = document.getElementById('connect-btn');
const logsConsole = document.getElementById('logs-console');
const clearBtn = document.getElementById('clear-btn');

// Load settings and current status on open
document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.local.get(['serverUrl', 'runnerState', 'logs'], (data) => {
    if (data.serverUrl) {
      serverUrlInput.value = data.serverUrl;
    }
    
    if (data.runnerState) {
      updateUIStatus(data.runnerState);
    }
    
    if (data.logs && Array.isArray(data.logs)) {
      renderLogs(data.logs);
    }
  });
});

// Update UI Connection status helper
function updateUIStatus(state) {
  statusDot.className = 'status-dot'; // Reset classes
  
  if (state === 'connected') {
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected & Idle';
    connectBtn.textContent = 'Disconnect Runner';
    connectBtn.className = 'primary-btn disconnect';
  } else if (state === 'working') {
    statusDot.classList.add('working');
    statusText.textContent = 'Generating Assets...';
    connectBtn.textContent = 'Disconnect Runner';
    connectBtn.className = 'primary-btn disconnect';
  } else {
    // disconnected
    statusText.textContent = 'Disconnected';
    connectBtn.textContent = 'Connect Runner';
    connectBtn.className = 'primary-btn';
  }
}

// Log renderer
function renderLogs(logs) {
  logsConsole.innerHTML = '';
  logs.forEach(log => {
    addLogToConsole(log.text, log.level);
  });
  logsConsole.scrollTop = logsConsole.scrollHeight;
}

function addLogToConsole(text, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${text}`;
  
  logsConsole.appendChild(entry);
  logsConsole.scrollTop = logsConsole.scrollHeight;
}

// Connect/Disconnect button listener
connectBtn.addEventListener('click', () => {
  chrome.storage.local.get(['runnerState'], (data) => {
    const isConnected = data.runnerState === 'connected' || data.runnerState === 'working';
    
    if (isConnected) {
      // Send disconnect message to background
      chrome.runtime.sendMessage({ action: 'disconnect' });
    } else {
      const serverUrl = serverUrlInput.value.trim();
      if (!serverUrl) {
        addLogToConsole('Server URL is required', 'error');
        return;
      }
      
      // Save URL
      chrome.storage.local.set({ serverUrl }, () => {
        // Send connect message to background
        chrome.runtime.sendMessage({ action: 'connect', serverUrl });
      });
    }
  });
});

// Clear logs button listener
clearBtn.addEventListener('click', () => {
  chrome.storage.local.set({ logs: [] }, () => {
    logsConsole.innerHTML = '';
    addLogToConsole('Logs cleared.', 'info');
  });
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'statusUpdate') {
    updateUIStatus(message.state);
  } else if (message.action === 'logAdded') {
    addLogToConsole(message.log.text, message.log.level);
  }
});
