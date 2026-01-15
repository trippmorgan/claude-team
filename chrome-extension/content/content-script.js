/**
 * Claude Team Browser Bridge - Content Script
 *
 * Runs in web page context to capture console logs, network events,
 * and DOM changes.
 */

(function() {
  'use strict';

  // =============================================================================
  // CONSOLE LOG CAPTURE
  // =============================================================================

  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };

  function captureConsole(level, ...args) {
    // Call original
    originalConsole[level](...args);

    // Send to background
    try {
      chrome.runtime.sendMessage({
        type: 'console_log',
        level,
        message: args.map(arg => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
          } catch {
            return String(arg);
          }
        }).join(' ')
      });
    } catch (e) {
      // Extension context may not be available
    }
  }

  console.log = (...args) => captureConsole('log', ...args);
  console.warn = (...args) => captureConsole('warn', ...args);
  console.error = (...args) => captureConsole('error', ...args);
  console.info = (...args) => captureConsole('info', ...args);

  // =============================================================================
  // FETCH INTERCEPT
  // =============================================================================

  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const startTime = Date.now();
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const method = args[1]?.method || 'GET';

    try {
      const response = await originalFetch.apply(this, args);
      const endTime = Date.now();

      // Clone response to read body
      const clonedResponse = response.clone();
      let responseBody;
      try {
        responseBody = await clonedResponse.text();
        if (responseBody.length > 10000) {
          responseBody = responseBody.substring(0, 10000) + '... (truncated)';
        }
      } catch {
        responseBody = '[Unable to read body]';
      }

      // Send to background
      try {
        chrome.runtime.sendMessage({
          type: 'network_event',
          data: {
            eventType: 'fetch',
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            latency: endTime - startTime,
            responseSize: responseBody.length,
            timestamp: startTime
          }
        });
      } catch (e) {
        // Extension context may not be available
      }

      return response;
    } catch (error) {
      const endTime = Date.now();

      try {
        chrome.runtime.sendMessage({
          type: 'network_event',
          data: {
            eventType: 'fetch_error',
            url,
            method,
            error: error.message,
            latency: endTime - startTime,
            timestamp: startTime
          }
        });
      } catch (e) {
        // Extension context may not be available
      }

      throw error;
    }
  };

  // =============================================================================
  // XHR INTERCEPT
  // =============================================================================

  const originalXHR = window.XMLHttpRequest;

  function InterceptedXHR() {
    const xhr = new originalXHR();
    const startTime = Date.now();
    let method = 'GET';
    let url = '';

    const originalOpen = xhr.open;
    xhr.open = function(m, u, ...args) {
      method = m;
      url = u;
      return originalOpen.apply(this, [m, u, ...args]);
    };

    xhr.addEventListener('loadend', function() {
      const endTime = Date.now();

      try {
        chrome.runtime.sendMessage({
          type: 'network_event',
          data: {
            eventType: 'xhr',
            url,
            method,
            status: xhr.status,
            statusText: xhr.statusText,
            latency: endTime - startTime,
            responseSize: xhr.responseText?.length || 0,
            timestamp: startTime
          }
        });
      } catch (e) {
        // Extension context may not be available
      }
    });

    return xhr;
  }

  window.XMLHttpRequest = InterceptedXHR;

  // =============================================================================
  // DOM MUTATION OBSERVER
  // =============================================================================

  let mutationDebounceTimer = null;
  const significantChanges = [];

  const mutationObserver = new MutationObserver((mutations) => {
    // Collect significant changes
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            // Check if it's a significant element
            if (el.matches && (
              el.matches('form, table, [data-patient], .patient-chart, .modal, [role="dialog"]') ||
              el.querySelector('form, table, [data-patient]')
            )) {
              significantChanges.push({
                type: 'added',
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                text: el.textContent?.substring(0, 200)
              });
            }
          }
        });
      }
    });

    // Debounce sending
    if (mutationDebounceTimer) {
      clearTimeout(mutationDebounceTimer);
    }

    mutationDebounceTimer = setTimeout(() => {
      if (significantChanges.length > 0) {
        try {
          chrome.runtime.sendMessage({
            type: 'dom_change',
            data: {
              changes: significantChanges.slice(-50), // Limit to last 50
              url: window.location.href
            }
          });
        } catch (e) {
          // Extension context may not be available
        }
        significantChanges.length = 0;
      }
    }, 500);
  });

  // Start observing when DOM is ready
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }

  // =============================================================================
  // MESSAGE LISTENER (from background)
  // =============================================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_PAGE_INFO':
        sendResponse({
          url: window.location.href,
          title: document.title,
          html: document.documentElement.outerHTML.substring(0, 50000)
        });
        break;

      case 'EXECUTE_SCRIPT':
        try {
          const result = eval(message.script);
          sendResponse({ success: true, result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;

      case 'CLICK_ELEMENT':
        try {
          const element = document.querySelector(message.selector);
          if (element) {
            element.click();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Element not found' });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;

      case 'TYPE_TEXT':
        try {
          const element = document.querySelector(message.selector);
          if (element) {
            if (message.clear) element.value = '';
            element.focus();
            element.value = message.text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Element not found' });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }

    return true;
  });

  // =============================================================================
  // ATHENA-SPECIFIC HELPERS
  // =============================================================================

  // Expose helper for Athena data extraction
  window.__claudeTeamHelpers = {
    getPatientData: () => {
      return {
        patientId: document.querySelector('[data-patient-id]')?.dataset?.patientId ||
                   document.querySelector('.patient-mrn')?.textContent?.trim(),
        patientName: document.querySelector('[data-patient-name]')?.textContent?.trim() ||
                     document.querySelector('.patient-name')?.textContent?.trim(),
        currentSection: document.querySelector('.active-section')?.dataset?.section,
        pageType: document.querySelector('[data-page-type]')?.dataset?.pageType
      };
    },

    getVisibleText: (selector) => {
      const elements = document.querySelectorAll(selector);
      return Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean);
    },

    waitForElement: (selector, timeout = 10000) => {
      return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }

        const observer = new MutationObserver((mutations, obs) => {
          const el = document.querySelector(selector);
          if (el) {
            obs.disconnect();
            resolve(el);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
      });
    }
  };

  console.log('[Claude Team] Content script loaded');
})();
