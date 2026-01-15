/**
 * Claude Team Browser Bridge - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const extensionIdEl = document.getElementById('extensionId');
  const tabsList = document.getElementById('tabsList');
  const captureBtn = document.getElementById('captureBtn');
  const reconnectBtn = document.getElementById('reconnectBtn');

  // Get extension ID
  extensionIdEl.textContent = chrome.runtime.id.substring(0, 12) + '...';
  extensionIdEl.title = chrome.runtime.id;

  // Check connection status
  async function updateStatus() {
    try {
      const { bridgeConnected } = await chrome.storage.local.get('bridgeConnected');

      if (bridgeConnected) {
        statusDot.classList.add('connected');
        statusDot.classList.remove('disconnected');
        statusText.textContent = 'Connected to Bridge';
      } else {
        statusDot.classList.add('disconnected');
        statusDot.classList.remove('connected');
        statusText.textContent = 'Disconnected';
      }
    } catch (err) {
      statusDot.classList.add('disconnected');
      statusText.textContent = 'Error checking status';
    }
  }

  // Load tabs
  async function loadTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      tabsList.innerHTML = tabs.map(tab => `
        <div class="tab-item ${tab.active ? 'active' : ''}" data-tab-id="${tab.id}" title="${tab.url}">
          ${tab.title || tab.url}
        </div>
      `).join('');

      // Add click handlers
      tabsList.querySelectorAll('.tab-item').forEach(item => {
        item.addEventListener('click', () => {
          const tabId = parseInt(item.dataset.tabId);
          chrome.tabs.update(tabId, { active: true });
        });
      });
    } catch (err) {
      tabsList.innerHTML = '<div style="color: #999">Unable to load tabs</div>';
    }
  }

  // Capture current page
  captureBtn.addEventListener('click', async () => {
    try {
      captureBtn.textContent = 'Capturing...';
      captureBtn.disabled = true;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        alert('No active tab found');
        return;
      }

      // Execute capture script
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            url: window.location.href,
            title: document.title,
            html: document.documentElement.outerHTML.substring(0, 50000),
            text: document.body.innerText.substring(0, 10000),
            timestamp: Date.now()
          };
        }
      });

      if (result[0]?.result) {
        // Send to bridge
        chrome.runtime.sendMessage({
          type: 'dom_change',
          data: result[0].result
        });

        alert('Page captured successfully!');
      }

    } catch (err) {
      alert('Error capturing page: ' + err.message);
    } finally {
      captureBtn.textContent = 'Capture Current Page';
      captureBtn.disabled = false;
    }
  });

  // Reconnect button
  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.textContent = 'Reconnecting...';
    reconnectBtn.disabled = true;

    // Send message to background to reconnect
    chrome.runtime.sendMessage({ type: 'RECONNECT' }, () => {
      setTimeout(() => {
        updateStatus();
        reconnectBtn.textContent = 'Reconnect to Bridge';
        reconnectBtn.disabled = false;
      }, 2000);
    });
  });

  // Initial load
  updateStatus();
  loadTabs();

  // Refresh every 5 seconds
  setInterval(() => {
    updateStatus();
    loadTabs();
  }, 5000);
});
