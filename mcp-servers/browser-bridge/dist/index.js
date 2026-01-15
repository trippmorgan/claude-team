/**
 * MCP Browser Bridge Server
 *
 * Enables Claude Code to communicate with Chrome extensions and control browser operations.
 * Integrates with claude-team hub for multi-agent coordination.
 *
 * Architecture:
 * - MCP Server (stdio) ← Claude Code
 * - WebSocket Server ← Chrome extensions
 * - HTTP Client → claude-team hub (port 4847)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
// Configuration
const CHROME_WS_PORT = parseInt(process.env.CHROME_WS_PORT || '8765');
const CLAUDE_TEAM_HUB = process.env.CLAUDE_TEAM_HUB || 'http://localhost:4847';
const chromeClients = new Map();
const pendingRequests = new Map();
const capturedData = new Map();
// Logging
function log(message) {
    console.error(`[Browser-Bridge] ${new Date().toISOString()} ${message}`);
}
// =============================================================================
// WEBSOCKET SERVER FOR CHROME EXTENSIONS
// =============================================================================
const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            chromeClients: chromeClients.size,
            pendingRequests: pendingRequests.size,
            capturedDataKeys: Array.from(capturedData.keys())
        }));
        return;
    }
    if (req.method === 'GET' && req.url === '/clients') {
        const clients = Array.from(chromeClients.entries()).map(([id, client]) => ({
            extensionId: id,
            tabs: Array.from(client.tabs.values()),
            lastHeartbeat: client.lastHeartbeat
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clients }));
        return;
    }
    res.writeHead(404);
    res.end('Not found');
});
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (ws, req) => {
    let clientId = '';
    log(`Chrome extension connected from ${req.socket.remoteAddress}`);
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            switch (message.type) {
                case 'register':
                    clientId = message.extensionId || `chrome-${Date.now()}`;
                    chromeClients.set(clientId, {
                        ws,
                        extensionId: clientId,
                        tabs: new Map(),
                        lastHeartbeat: Date.now()
                    });
                    log(`Registered Chrome client: ${clientId}`);
                    ws.send(JSON.stringify({ type: 'registered', clientId }));
                    break;
                case 'tabs_update':
                    const client = chromeClients.get(clientId);
                    if (client && message.tabs) {
                        client.tabs.clear();
                        message.tabs.forEach((tab) => {
                            client.tabs.set(tab.id, tab);
                        });
                    }
                    break;
                case 'heartbeat':
                    const c = chromeClients.get(clientId);
                    if (c)
                        c.lastHeartbeat = Date.now();
                    break;
                case 'response':
                    const pending = pendingRequests.get(message.requestId);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        pending.resolve(message.data);
                        pendingRequests.delete(message.requestId);
                    }
                    break;
                case 'error':
                    const errorPending = pendingRequests.get(message.requestId);
                    if (errorPending) {
                        clearTimeout(errorPending.timeout);
                        errorPending.reject(new Error(message.error));
                        pendingRequests.delete(message.requestId);
                    }
                    break;
                case 'dom_capture':
                    capturedData.set(`dom-${message.tabId}-${Date.now()}`, {
                        tabId: message.tabId,
                        url: message.url,
                        title: message.title,
                        html: message.html,
                        timestamp: Date.now()
                    });
                    // Forward to claude-team hub
                    forwardToHub('dom_capture', message);
                    break;
                case 'console_logs':
                    capturedData.set(`console-${message.tabId}-${Date.now()}`, {
                        tabId: message.tabId,
                        logs: message.logs,
                        timestamp: Date.now()
                    });
                    break;
                case 'network_event':
                    capturedData.set(`network-${Date.now()}`, message);
                    forwardToHub('network_event', message);
                    break;
                case 'athena_data':
                    capturedData.set(`athena-${message.patientId || Date.now()}`, message);
                    forwardToHub('athena_data', message);
                    break;
                default:
                    log(`Unknown message type: ${message.type}`);
            }
        }
        catch (err) {
            log(`Error processing message: ${err.message}`);
        }
    });
    ws.on('close', () => {
        if (clientId) {
            chromeClients.delete(clientId);
            log(`Chrome client disconnected: ${clientId}`);
        }
    });
    ws.on('error', (err) => {
        log(`WebSocket error: ${err.message}`);
    });
});
// Forward events to claude-team hub
async function forwardToHub(eventType, data) {
    try {
        const response = await fetch(`${CLAUDE_TEAM_HUB}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'browser-bridge',
                event: { type: eventType, ...data },
                timestamp: Date.now()
            })
        });
        if (!response.ok) {
            log(`Hub webhook failed: ${response.status}`);
        }
    }
    catch (err) {
        log(`Failed to forward to hub: ${err.message}`);
    }
}
// Send command to Chrome extension and wait for response
function sendToChromeAndWait(clientId, command, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const client = chromeClients.get(clientId);
        if (!client) {
            // Try first available client
            const firstClient = chromeClients.values().next().value;
            if (!firstClient) {
                reject(new Error('No Chrome extension connected'));
                return;
            }
            command.requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const timeout = setTimeout(() => {
                pendingRequests.delete(command.requestId);
                reject(new Error('Request timeout'));
            }, timeoutMs);
            pendingRequests.set(command.requestId, { resolve, reject, timeout });
            firstClient.ws.send(JSON.stringify(command));
            return;
        }
        command.requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const timeout = setTimeout(() => {
            pendingRequests.delete(command.requestId);
            reject(new Error('Request timeout'));
        }, timeoutMs);
        pendingRequests.set(command.requestId, { resolve, reject, timeout });
        client.ws.send(JSON.stringify(command));
    });
}
// Broadcast to all Chrome clients
function broadcastToChrome(message) {
    const data = JSON.stringify(message);
    for (const client of chromeClients.values()) {
        try {
            client.ws.send(data);
        }
        catch (err) {
            // Ignore send errors
        }
    }
}
// =============================================================================
// MCP SERVER
// =============================================================================
const server = new Server({ name: 'browser-bridge', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'browser_navigate',
            description: 'Navigate browser to a URL',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to navigate to' },
                    tabId: { type: 'number', description: 'Optional specific tab ID' },
                    newTab: { type: 'boolean', description: 'Open in new tab' }
                },
                required: ['url']
            }
        },
        {
            name: 'browser_click',
            description: 'Click an element on the page',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector for element' },
                    tabId: { type: 'number', description: 'Tab ID' }
                },
                required: ['selector']
            }
        },
        {
            name: 'browser_type',
            description: 'Type text into an input field',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector for input' },
                    text: { type: 'string', description: 'Text to type' },
                    tabId: { type: 'number', description: 'Tab ID' },
                    clear: { type: 'boolean', description: 'Clear field first' }
                },
                required: ['selector', 'text']
            }
        },
        {
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current page',
            inputSchema: {
                type: 'object',
                properties: {
                    tabId: { type: 'number', description: 'Tab ID' },
                    fullPage: { type: 'boolean', description: 'Capture full page' }
                }
            }
        },
        {
            name: 'browser_get_dom',
            description: 'Get the DOM content of the current page',
            inputSchema: {
                type: 'object',
                properties: {
                    tabId: { type: 'number', description: 'Tab ID' },
                    selector: { type: 'string', description: 'Optional CSS selector to get specific element' }
                }
            }
        },
        {
            name: 'browser_execute_script',
            description: 'Execute JavaScript in the browser context',
            inputSchema: {
                type: 'object',
                properties: {
                    script: { type: 'string', description: 'JavaScript code to execute' },
                    tabId: { type: 'number', description: 'Tab ID' }
                },
                required: ['script']
            }
        },
        {
            name: 'browser_get_tabs',
            description: 'Get list of open browser tabs',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        },
        {
            name: 'browser_get_console',
            description: 'Get console logs from the page',
            inputSchema: {
                type: 'object',
                properties: {
                    tabId: { type: 'number', description: 'Tab ID' },
                    limit: { type: 'number', description: 'Max logs to return' }
                }
            }
        },
        {
            name: 'athena_capture_patient',
            description: 'Capture patient data from Athena EMR page',
            inputSchema: {
                type: 'object',
                properties: {
                    patientId: { type: 'string', description: 'Patient MRN or ID' },
                    dataTypes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Types of data to capture: demographics, vitals, medications, allergies, problems, encounters'
                    }
                }
            }
        },
        {
            name: 'athena_navigate_patient',
            description: 'Navigate to a patient chart in Athena',
            inputSchema: {
                type: 'object',
                properties: {
                    patientId: { type: 'string', description: 'Patient MRN' },
                    section: { type: 'string', description: 'Chart section: summary, encounters, medications, etc.' }
                },
                required: ['patientId']
            }
        },
        {
            name: 'get_captured_data',
            description: 'Get previously captured browser data',
            inputSchema: {
                type: 'object',
                properties: {
                    dataType: { type: 'string', enum: ['dom', 'console', 'network', 'athena', 'all'] },
                    limit: { type: 'number', description: 'Max items to return' }
                }
            }
        },
        {
            name: 'get_chrome_status',
            description: 'Get status of connected Chrome extensions',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        }
    ]
}));
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const typedArgs = args;
    try {
        switch (name) {
            case 'browser_navigate': {
                const result = await sendToChromeAndWait('', {
                    type: 'navigate',
                    url: typedArgs.url,
                    tabId: typedArgs.tabId,
                    newTab: typedArgs.newTab
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'browser_click': {
                const result = await sendToChromeAndWait('', {
                    type: 'click',
                    selector: typedArgs.selector,
                    tabId: typedArgs.tabId
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'browser_type': {
                const result = await sendToChromeAndWait('', {
                    type: 'type',
                    selector: typedArgs.selector,
                    text: typedArgs.text,
                    tabId: typedArgs.tabId,
                    clear: typedArgs.clear
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'browser_screenshot': {
                const result = await sendToChromeAndWait('', {
                    type: 'screenshot',
                    tabId: typedArgs.tabId,
                    fullPage: typedArgs.fullPage
                }, 60000);
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'browser_get_dom': {
                const result = await sendToChromeAndWait('', {
                    type: 'get_dom',
                    tabId: typedArgs.tabId,
                    selector: typedArgs.selector
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'browser_execute_script': {
                const result = await sendToChromeAndWait('', {
                    type: 'execute_script',
                    script: typedArgs.script,
                    tabId: typedArgs.tabId
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'browser_get_tabs': {
                const tabs = [];
                for (const client of chromeClients.values()) {
                    for (const tab of client.tabs.values()) {
                        tabs.push(tab);
                    }
                }
                if (tabs.length === 0) {
                    // Request fresh tabs from extension
                    const result = await sendToChromeAndWait('', { type: 'get_tabs' });
                    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                }
                return { content: [{ type: 'text', text: JSON.stringify({ tabs }) }] };
            }
            case 'browser_get_console': {
                const result = await sendToChromeAndWait('', {
                    type: 'get_console',
                    tabId: typedArgs.tabId,
                    limit: typedArgs.limit || 100
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'athena_capture_patient': {
                const result = await sendToChromeAndWait('', {
                    type: 'athena_capture',
                    patientId: typedArgs.patientId,
                    dataTypes: typedArgs.dataTypes || ['demographics', 'vitals', 'medications', 'problems']
                }, 60000);
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'athena_navigate_patient': {
                const result = await sendToChromeAndWait('', {
                    type: 'athena_navigate',
                    patientId: typedArgs.patientId,
                    section: typedArgs.section || 'summary'
                });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            case 'get_captured_data': {
                const dataType = typedArgs.dataType || 'all';
                const limit = typedArgs.limit || 10;
                const results = [];
                for (const [key, value] of capturedData.entries()) {
                    if (dataType === 'all' || key.startsWith(dataType)) {
                        results.push({ key, ...value });
                    }
                    if (results.length >= limit)
                        break;
                }
                return { content: [{ type: 'text', text: JSON.stringify({ data: results }) }] };
            }
            case 'get_chrome_status': {
                const clients = Array.from(chromeClients.entries()).map(([id, client]) => ({
                    extensionId: id,
                    tabCount: client.tabs.size,
                    tabs: Array.from(client.tabs.values()),
                    lastHeartbeat: client.lastHeartbeat,
                    connected: client.ws.readyState === WebSocket.OPEN
                }));
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                connected: chromeClients.size > 0,
                                clientCount: chromeClients.size,
                                clients,
                                pendingRequests: pendingRequests.size
                            })
                        }]
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
});
// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
        {
            uri: 'browser://tabs',
            name: 'Browser Tabs',
            description: 'List of open browser tabs',
            mimeType: 'application/json'
        },
        {
            uri: 'browser://captured',
            name: 'Captured Data',
            description: 'Data captured from browser',
            mimeType: 'application/json'
        }
    ]
}));
// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === 'browser://tabs') {
        const tabs = [];
        for (const client of chromeClients.values()) {
            for (const tab of client.tabs.values()) {
                tabs.push(tab);
            }
        }
        return {
            contents: [{
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify({ tabs })
                }]
        };
    }
    if (uri === 'browser://captured') {
        const data = [];
        for (const [key, value] of capturedData.entries()) {
            data.push({ key, ...value });
        }
        return {
            contents: [{
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify({ data })
                }]
        };
    }
    throw new Error(`Unknown resource: ${uri}`);
});
// =============================================================================
// START SERVERS
// =============================================================================
async function main() {
    // Start WebSocket server for Chrome extensions
    httpServer.listen(CHROME_WS_PORT, () => {
        log(`WebSocket server listening on port ${CHROME_WS_PORT}`);
    });
    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('MCP Browser Bridge server running');
}
main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
