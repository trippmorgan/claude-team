/**
 * Claude Team Browser Bridge - Service Worker
 *
 * Connects to the MCP Browser Bridge server via WebSocket
 * and executes browser commands from Claude Code.
 */

const BRIDGE_URL = 'ws://localhost:8765';
const CLAUDE_TEAM_HUB = 'http://localhost:4847';

let ws = null;
let reconnectTimer = null;
let extensionId = null;
let consoleLogs = new Map(); // tabId -> logs[]
let networkEvents = new Map(); // tabId -> events[]

// =============================================================================
// WEBSOCKET CONNECTION TO BRIDGE
// =============================================================================

function connectToBridge() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    ws = new WebSocket(BRIDGE_URL);

    ws.onopen = () => {
      console.log('[Bridge] Connected to MCP Browser Bridge');
      extensionId = chrome.runtime.id;

      // Register with bridge
      ws.send(JSON.stringify({
        type: 'register',
        extensionId: extensionId
      }));

      // Send current tabs
      sendTabsUpdate();

      // Update popup status
      chrome.storage.local.set({ bridgeConnected: true });
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[Bridge] Received:', message.type);
        await handleBridgeMessage(message);
      } catch (err) {
        console.error('[Bridge] Error handling message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[Bridge] WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('[Bridge] Disconnected, reconnecting in 5s...');
      ws = null;
      chrome.storage.local.set({ bridgeConnected: false });
      reconnectTimer = setTimeout(connectToBridge, 5000);
    };

  } catch (err) {
    console.error('[Bridge] Connection failed:', err);
    reconnectTimer = setTimeout(connectToBridge, 5000);
  }
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

async function handleBridgeMessage(message) {
  const { type, requestId } = message;

  try {
    let result;

    switch (type) {
      case 'registered':
        console.log('[Bridge] Registered as:', message.clientId);
        break;

      case 'navigate':
        result = await handleNavigate(message);
        break;

      case 'click':
        result = await handleClick(message);
        break;

      case 'type':
        result = await handleType(message);
        break;

      case 'screenshot':
        result = await handleScreenshot(message);
        break;

      case 'get_dom':
        result = await handleGetDom(message);
        break;

      case 'execute_script':
        result = await handleExecuteScript(message);
        break;

      case 'get_tabs':
        result = await handleGetTabs();
        break;

      case 'get_console':
        result = await handleGetConsole(message);
        break;

      case 'athena_capture':
        result = await handleAthenaCapture(message);
        break;

      case 'athena_navigate':
        result = await handleAthenaNavigate(message);
        break;

      default:
        console.log('[Bridge] Unknown message type:', type);
        return;
    }

    if (requestId && result !== undefined) {
      sendResponse(requestId, result);
    }

  } catch (err) {
    console.error('[Bridge] Error handling', type, ':', err);
    if (requestId) {
      sendError(requestId, err.message);
    }
  }
}

function sendResponse(requestId, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'response', requestId, data }));
  }
}

function sendError(requestId, error) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', requestId, error }));
  }
}

// =============================================================================
// BROWSER ACTIONS
// =============================================================================

async function handleNavigate(message) {
  const { url, tabId, newTab } = message;

  if (newTab) {
    const tab = await chrome.tabs.create({ url });
    return { success: true, tabId: tab.id, url };
  }

  const targetTabId = tabId || (await getActiveTabId());
  await chrome.tabs.update(targetTabId, { url });
  return { success: true, tabId: targetTabId, url };
}

async function handleClick(message) {
  const { selector, tabId } = message;
  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { success: false, error: `Element not found: ${sel}` };
      }
      element.click();
      return { success: true, clicked: sel };
    },
    args: [selector]
  });

  return result[0]?.result || { success: false, error: 'Script execution failed' };
}

async function handleType(message) {
  const { selector, text, tabId, clear } = message;
  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (sel, txt, shouldClear) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { success: false, error: `Element not found: ${sel}` };
      }

      if (shouldClear) {
        element.value = '';
      }

      element.focus();
      element.value = txt;

      // Trigger input events
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, typed: txt };
    },
    args: [selector, text, clear]
  });

  return result[0]?.result || { success: false, error: 'Script execution failed' };
}

async function handleScreenshot(message) {
  const { tabId, fullPage } = message;
  const targetTabId = tabId || (await getActiveTabId());

  // Capture visible tab
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

  return {
    success: true,
    screenshot: dataUrl,
    tabId: targetTabId,
    timestamp: Date.now()
  };
}

async function handleGetDom(message) {
  const { tabId, selector } = message;
  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (sel) => {
      if (sel) {
        const element = document.querySelector(sel);
        return element ? {
          success: true,
          html: element.outerHTML,
          text: element.textContent
        } : { success: false, error: `Element not found: ${sel}` };
      }

      return {
        success: true,
        url: window.location.href,
        title: document.title,
        html: document.documentElement.outerHTML
      };
    },
    args: [selector]
  });

  return result[0]?.result || { success: false, error: 'Script execution failed' };
}

async function handleExecuteScript(message) {
  const { script, tabId } = message;
  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: new Function('return ' + script)
  });

  return {
    success: true,
    result: result[0]?.result,
    tabId: targetTabId
  };
}

async function handleGetTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    success: true,
    tabs: tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
      windowId: t.windowId
    }))
  };
}

async function handleGetConsole(message) {
  const { tabId, limit } = message;
  const targetTabId = tabId || (await getActiveTabId());
  const logs = consoleLogs.get(targetTabId) || [];

  return {
    success: true,
    logs: logs.slice(-(limit || 100)),
    tabId: targetTabId
  };
}

// =============================================================================
// ATHENA EMR INTEGRATION
// =============================================================================

async function handleAthenaCapture(message) {
  const { patientId, dataTypes } = message;
  const targetTabId = await getActiveTabId();

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (pId, types) => {
      const data = {
        patientId: pId,
        capturedAt: new Date().toISOString(),
        url: window.location.href,
        data: {}
      };

      // Try to extract patient data based on Athena's DOM structure
      // This is a template - actual selectors depend on Athena's specific UI

      if (types.includes('demographics')) {
        data.data.demographics = {
          name: document.querySelector('[data-patient-name]')?.textContent?.trim() ||
                document.querySelector('.patient-name')?.textContent?.trim(),
          dob: document.querySelector('[data-patient-dob]')?.textContent?.trim() ||
               document.querySelector('.patient-dob')?.textContent?.trim(),
          mrn: document.querySelector('[data-patient-mrn]')?.textContent?.trim() ||
               document.querySelector('.patient-mrn')?.textContent?.trim() || pId
        };
      }

      if (types.includes('vitals')) {
        data.data.vitals = {};
        const vitalsSection = document.querySelector('.vitals-section, [data-section="vitals"]');
        if (vitalsSection) {
          data.data.vitals.html = vitalsSection.innerHTML;
          data.data.vitals.text = vitalsSection.textContent;
        }
      }

      if (types.includes('medications')) {
        data.data.medications = [];
        const medElements = document.querySelectorAll('.medication-item, [data-medication]');
        medElements.forEach(el => {
          data.data.medications.push({
            name: el.querySelector('.med-name')?.textContent?.trim(),
            dosage: el.querySelector('.med-dosage')?.textContent?.trim(),
            text: el.textContent?.trim()
          });
        });
      }

      if (types.includes('problems')) {
        data.data.problems = [];
        const problemElements = document.querySelectorAll('.problem-item, [data-problem]');
        problemElements.forEach(el => {
          data.data.problems.push({
            description: el.textContent?.trim()
          });
        });
      }

      if (types.includes('allergies')) {
        data.data.allergies = [];
        const allergyElements = document.querySelectorAll('.allergy-item, [data-allergy]');
        allergyElements.forEach(el => {
          data.data.allergies.push({
            description: el.textContent?.trim()
          });
        });
      }

      // Capture raw HTML of key sections for further processing
      data.rawHtml = {
        body: document.body.innerHTML.substring(0, 50000) // Limit size
      };

      return data;
    },
    args: [patientId, dataTypes]
  });

  const capturedData = result[0]?.result;

  // Forward to bridge and hub
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'athena_data',
      ...capturedData
    }));
  }

  // Also send to Claude Team hub
  try {
    await fetch(`${CLAUDE_TEAM_HUB}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'chrome-extension-athena',
        event: { type: 'athena_capture', ...capturedData },
        timestamp: Date.now()
      })
    });
  } catch (err) {
    console.error('[Athena] Failed to forward to hub:', err);
  }

  return { success: true, ...capturedData };
}

async function handleAthenaNavigate(message) {
  const { patientId, section } = message;

  // Athena URL patterns (adjust based on actual Athena instance)
  const athenaBaseUrl = 'https://athenahealth.com'; // Replace with actual URL
  const sectionPaths = {
    summary: '/patient/summary',
    encounters: '/patient/encounters',
    medications: '/patient/medications',
    allergies: '/patient/allergies',
    problems: '/patient/problems',
    vitals: '/patient/vitals'
  };

  const url = `${athenaBaseUrl}${sectionPaths[section] || sectionPaths.summary}?patientId=${patientId}`;

  const targetTabId = await getActiveTabId();
  await chrome.tabs.update(targetTabId, { url });

  return { success: true, navigatedTo: url, patientId, section };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function sendTabsUpdate() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const tabs = await chrome.tabs.query({});
  ws.send(JSON.stringify({
    type: 'tabs_update',
    tabs: tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active
    }))
  }));
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// Tab events
chrome.tabs.onCreated.addListener(sendTabsUpdate);
chrome.tabs.onRemoved.addListener(sendTabsUpdate);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    sendTabsUpdate();
  }
});

// Navigation events
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    console.log('[Nav] Page loaded:', details.url);
  }
});

// Message from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'console_log':
      if (tabId) {
        if (!consoleLogs.has(tabId)) {
          consoleLogs.set(tabId, []);
        }
        consoleLogs.get(tabId).push({
          level: message.level,
          message: message.message,
          timestamp: Date.now()
        });
        // Limit to last 1000 logs per tab
        if (consoleLogs.get(tabId).length > 1000) {
          consoleLogs.set(tabId, consoleLogs.get(tabId).slice(-1000));
        }
      }
      break;

    case 'network_event':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'network_event',
          tabId,
          ...message.data
        }));
      }
      break;

    case 'dom_change':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'dom_capture',
          tabId,
          url: sender.tab?.url,
          title: sender.tab?.title,
          ...message.data
        }));
      }
      break;
  }

  sendResponse({ received: true });
  return true;
});

// External messages (from web pages or other extensions)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[External] Message from:', sender.origin, message);

  switch (message.type) {
    case 'GET_STATUS':
      sendResponse({
        connected: ws && ws.readyState === WebSocket.OPEN,
        extensionId: chrome.runtime.id
      });
      break;

    case 'CLAUDE_TEAM_QUERY':
      handleBridgeMessage(message).then(result => {
        sendResponse({ success: true, result });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // Async response

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true;
});

// Heartbeat
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'heartbeat' }));
  }
}, 30000);

// =============================================================================
// STARTUP
// =============================================================================

console.log('[Bridge] Starting Claude Team Browser Bridge extension');
connectToBridge();

// Store extension ID
chrome.storage.local.set({ extensionId: chrome.runtime.id });
