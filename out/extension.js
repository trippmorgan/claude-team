"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// extension.ts - Main Extension Entry Point
// EXTENSIVE LOGGING VERSION
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const ws_1 = require("ws");
const claudeCodeIntegration_1 = require("./claudeCodeIntegration");
const sharedContextApproach_1 = require("./sharedContextApproach");
const autoResponse_1 = require("./autoResponse");
// ============================================================================
// SIDEBAR TREE DATA PROVIDERS
// ============================================================================
class WindowTreeItem extends vscode.TreeItem {
    windowId;
    windowName;
    projectPath;
    isHub;
    constructor(windowId, windowName, projectPath, isHub) {
        super(windowName, vscode.TreeItemCollapsibleState.None);
        this.windowId = windowId;
        this.windowName = windowName;
        this.projectPath = projectPath;
        this.isHub = isHub;
        this.tooltip = `${windowName}\n${projectPath}`;
        this.description = isHub ? '(hub)' : projectPath.split('/').pop();
        this.iconPath = new vscode.ThemeIcon(isHub ? 'server' : 'window');
        this.contextValue = 'window';
    }
}
class WindowsTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    windows = new Map();
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    updateWindows(windows, hubId) {
        this.windows.clear();
        for (const [id, w] of windows) {
            if (id !== 'claude-code-mcp') {
                this.windows.set(id, {
                    name: w.name || id,
                    projectPath: w.projectPath || '',
                    isHub: id === hubId
                });
            }
        }
        this.refresh();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        const items = [];
        for (const [id, w] of this.windows) {
            items.push(new WindowTreeItem(id, w.name, w.projectPath, w.isHub));
        }
        return items;
    }
}
class MessageTreeItem extends vscode.TreeItem {
    messageId;
    from;
    content;
    type;
    timestamp;
    constructor(messageId, from, content, type, timestamp) {
        const time = new Date(timestamp).toLocaleTimeString();
        super(`[${time}] ${from}`, vscode.TreeItemCollapsibleState.None);
        this.messageId = messageId;
        this.from = from;
        this.content = content;
        this.type = type;
        this.timestamp = timestamp;
        this.tooltip = content;
        this.description = content.substring(0, 40) + (content.length > 40 ? '...' : '');
        this.iconPath = new vscode.ThemeIcon(type === 'query' ? 'question' :
            type === 'response' ? 'check' :
                type === 'broadcast' ? 'broadcast' : 'mail');
    }
}
class MessagesTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    messages = [];
    maxMessages = 50;
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    addMessage(msg) {
        this.messages.unshift({
            id: msg.id,
            from: msg.fromWindow,
            content: msg.content,
            type: msg.type,
            timestamp: msg.timestamp
        });
        if (this.messages.length > this.maxMessages) {
            this.messages.pop();
        }
        this.refresh();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        return this.messages.map(m => new MessageTreeItem(m.id, m.from, m.content, m.type, m.timestamp));
    }
}
class ClaudeTeamHub {
    context;
    server = null;
    wss = null;
    windows = new Map();
    pendingQuerySockets = new Map();
    outputChannel;
    statusBar;
    windowId;
    socket = null;
    isHub = false;
    bridge;
    sharedContext;
    autoResponder;
    // Sidebar tree data providers
    windowsProvider;
    messagesProvider;
    constructor(context) {
        this.context = context;
        const workspaceName = vscode.workspace.name || 'unnamed';
        this.windowId = workspaceName + '-' + Math.random().toString(36).substring(7);
        this.outputChannel = vscode.window.createOutputChannel('Claude Team');
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.show();
        this.updateStatus('disconnected');
        this.bridge = new claudeCodeIntegration_1.ClaudeCodeBridge(this.outputChannel);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.sharedContext = new sharedContextApproach_1.SharedContextManager(workspaceRoot);
        // Initialize improved auto-responder with strategy pattern
        const autoRespondMode = vscode.workspace.getConfiguration('claudeTeam').get('autoRespondMode', 'smart');
        this.autoResponder = new autoResponse_1.ImprovedAutoResponder(this.bridge, this.outputChannel, {
            enabled: vscode.workspace.getConfiguration('claudeTeam').get('autoRespond', true),
            mode: autoRespondMode,
            logClassifications: true,
            claudeTimeout: 120000,
            requireApprovalFor: [autoResponse_1.QueryIntent.TASK_DELEGATION]
        });
        // Initialize and register sidebar providers
        this.windowsProvider = new WindowsTreeDataProvider();
        this.messagesProvider = new MessagesTreeDataProvider();
        vscode.window.registerTreeDataProvider('claude-team.windows', this.windowsProvider);
        vscode.window.registerTreeDataProvider('claude-team.messages', this.messagesProvider);
        this.log('[CONSTRUCTOR] Created, windowId=' + this.windowId);
    }
    /**
     * Find a window by target string using fuzzy matching
     * Supports: exact ID, name match, ID prefix match
     */
    findWindowByTarget(target) {
        // Exact ID match
        if (this.windows.has(target)) {
            return this.windows.get(target);
        }
        // Try matching by name or ID prefix
        for (const [id, window] of this.windows) {
            // Skip MCP pseudo-window
            if (id === 'claude-code-mcp')
                continue;
            // Match by window name (case-insensitive)
            if (window.name.toLowerCase() === target.toLowerCase()) {
                this.log(`[FIND-WINDOW] Matched by name: "${target}" -> "${id}"`);
                return window;
            }
            // Match by ID prefix (e.g., "claude-team" matches "claude-team-x7k2")
            if (id.toLowerCase().startsWith(target.toLowerCase())) {
                this.log(`[FIND-WINDOW] Matched by ID prefix: "${target}" -> "${id}"`);
                return window;
            }
            // Match by project path basename
            if (window.projectPath) {
                const pathBasename = window.projectPath.split('/').pop() || '';
                if (pathBasename.toLowerCase() === target.toLowerCase()) {
                    this.log(`[FIND-WINDOW] Matched by project path: "${target}" -> "${id}"`);
                    return window;
                }
            }
        }
        this.log(`[FIND-WINDOW] No match found for: "${target}"`);
        return undefined;
    }
    /**
     * Check if target refers to this hub window (self-routing)
     */
    isTargetingSelf(target) {
        if (target === this.windowId)
            return true;
        const workspaceName = vscode.workspace.name || '';
        if (target.toLowerCase() === workspaceName.toLowerCase())
            return true;
        if (this.windowId.toLowerCase().startsWith(target.toLowerCase()))
            return true;
        return false;
    }
    /**
     * Register or update a window, deduplicating by workspace path
     */
    registerOrUpdateWindow(entry, socket) {
        // Check for existing window with same workspace path (deduplication)
        if (entry.projectPath) {
            for (const [existingId, existingWindow] of this.windows) {
                if (existingId !== entry.id &&
                    existingId !== 'claude-code-mcp' &&
                    existingWindow.projectPath === entry.projectPath) {
                    // Same workspace - remove old entry, keep new one
                    this.log(`[REGISTER] Deduplicating: removing old "${existingId}" for workspace "${entry.projectPath}"`);
                    this.windows.delete(existingId);
                    break;
                }
            }
        }
        entry.socket = socket;
        this.windows.set(entry.id, entry);
        this.log(`[REGISTER] Window registered: ${entry.id} (${entry.name})`);
    }
    async initialize() {
        this.log('========== INIT START ==========');
        this.outputChannel.show(true);
        try {
            const connected = await this.tryConnectToHub();
            this.log('[INIT] Connect result: ' + connected);
            if (!connected)
                await this.startHub();
            this.sharedContext.watchForResponses((r) => this.handleSharedResponse(r));
            this.registerCommands();
            this.log('========== INIT COMPLETE ==========');
        }
        catch (e) {
            this.log('[INIT] ERROR: ' + e.message);
        }
    }
    async tryConnectToHub() {
        this.log('[CONNECT] Trying ws://localhost:4847...');
        return new Promise((resolve) => {
            try {
                const socket = new ws_1.WebSocket('ws://localhost:4847');
                socket.on('open', () => {
                    this.log('[CONNECT] SUCCESS');
                    this.socket = socket;
                    this.setupClientHandlers(socket);
                    this.registerWindow();
                    this.updateStatus('connected');
                    resolve(true);
                });
                socket.on('error', () => resolve(false));
                setTimeout(() => resolve(false), 1500);
            }
            catch {
                resolve(false);
            }
        });
    }
    async startHub() {
        this.log('[HUB] Starting...');
        this.isHub = true;
        // HTTP server handles both WebSocket upgrades AND webhook POSTs
        this.server = http.createServer((req, res) => {
            // CORS headers for cross-origin requests
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            // Webhook endpoint for Chrome extension events
            if (req.method === 'POST' && req.url === '/webhook') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const event = JSON.parse(body);
                        this.log('[WEBHOOK] Received event from: ' + (event.source || 'unknown'));
                        this.log('[WEBHOOK] Event: ' + JSON.stringify(event).substring(0, 200));
                        // Broadcast to all connected windows
                        const msg = {
                            id: 'webhook-' + Date.now(),
                            fromWindow: event.source || 'chrome-extension',
                            type: 'broadcast',
                            content: '[TELEMETRY] ' + JSON.stringify(event.event || event),
                            timestamp: Date.now()
                        };
                        this.broadcast(msg);
                        this.messagesProvider.addMessage(msg);
                        // Show notification
                        vscode.window.showInformationMessage('[Chrome] Event from ' + (event.source || 'extension'));
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ received: true, id: msg.id }));
                    }
                    catch (e) {
                        this.log('[WEBHOOK] Parse error: ' + e.message);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }
            // Health check endpoint
            if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    hub: true,
                    windows: this.windows.size,
                    windowList: Array.from(this.windows.keys())
                }));
                return;
            }
            // Status endpoint
            if (req.method === 'GET' && req.url === '/status') {
                const windowData = Array.from(this.windows.values()).map(w => ({
                    id: w.id,
                    name: w.name,
                    projectPath: w.projectPath,
                    status: w.status
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ windows: windowData }));
                return;
            }
            // Default: 404
            res.writeHead(404);
            res.end('Not found');
        });
        this.wss = new ws_1.WebSocketServer({ server: this.server });
        this.wss.on('connection', (socket) => {
            let clientId = '';
            this.log('[HUB] New client');
            socket.on('message', (data) => {
                try {
                    const raw = data.toString();
                    this.log('[HUB] <<< ' + raw.substring(0, 200));
                    const msg = JSON.parse(raw);
                    if (!clientId && msg.fromWindow) {
                        clientId = msg.fromWindow;
                        this.log('[HUB] Registered: ' + clientId);
                        if (clientId === 'claude-code-mcp') {
                            this.windows.set(clientId, { id: clientId, name: 'MCP', projectPath: '', status: 'idle', capabilities: [], socket });
                            this.broadcastWindowList();
                        }
                    }
                    this.handleHubMessage(msg, socket);
                }
                catch (e) {
                    this.log('[HUB] Error: ' + e.message);
                }
            });
            socket.on('close', () => { if (clientId) {
                this.windows.delete(clientId);
                this.broadcastWindowList();
            } });
        });
        this.server.listen(4847, () => {
            this.log('[HUB] STARTED on 4847');
            this.updateStatus('hub');
            this.registerWindow();
            vscode.window.showInformationMessage('Claude Team Hub on 4847');
        });
    }
    setupClientHandlers(socket) {
        socket.on('message', (d) => {
            try {
                const raw = d.toString();
                this.log('[CLIENT] <<< ' + raw.substring(0, 150));
                this.handleClientMessage(JSON.parse(raw));
            }
            catch (e) {
                this.log('[CLIENT] ERROR parsing message: ' + e.message);
            }
        });
        socket.on('close', () => {
            this.log('[CLIENT] Connection closed, reconnecting in 3s...');
            this.updateStatus('disconnected');
            setTimeout(() => this.initialize(), 3000);
        });
        socket.on('error', (e) => {
            this.log('[CLIENT] Socket error: ' + e.message);
        });
    }
    handleHubMessage(msg, socket) {
        this.log('');
        this.log('╔══════════════════════════════════════════════════════════════');
        this.log('║ [HUB] INCOMING MESSAGE');
        this.log('║   type: ' + msg.type);
        this.log('║   from: ' + msg.fromWindow);
        this.log('║   to: ' + (msg.toWindow || 'ALL'));
        this.log('║   id: ' + (msg.id || 'none'));
        this.log('╚══════════════════════════════════════════════════════════════');
        this.log('[HUB] Window registry (' + this.windows.size + '):');
        for (const [id, w] of this.windows) {
            this.log('  - ' + id + ' | socket=' + (w.socket ? 'YES(state=' + w.socket.readyState + ')' : 'NO'));
        }
        switch (msg.type) {
            case 'status':
                // Register window with deduplication
                this.log('[STATUS] Registering window: ' + msg.fromWindow);
                this.log('[STATUS] Socket param exists: ' + !!socket + ', readyState: ' + (socket?.readyState ?? 'N/A'));
                const statusEntry = {
                    id: msg.fromWindow,
                    name: msg.content,
                    projectPath: msg.metadata?.projectContext || '',
                    status: 'idle',
                    capabilities: []
                };
                // Use deduplicating registration
                this.registerOrUpdateWindow(statusEntry, socket);
                // Verify storage worked
                const verifyEntry = this.windows.get(msg.fromWindow);
                this.log('[STATUS] Verify: stored socket exists=' + !!verifyEntry?.socket + ', readyState=' + (verifyEntry?.socket?.readyState ?? 'N/A'));
                this.broadcastWindowList();
                break;
            case 'status_request':
                this.log('[HUB-MSG] STATUS_REQUEST id=' + msg.id);
                const list = Array.from(this.windows.values()).filter(w => w.id !== 'claude-code-mcp').map(w => '- ' + w.name + ' (' + (w.projectPath || 'unknown') + ')');
                const content = list.length > 0 ? 'Connected windows:\n' + list.join('\n') : 'No windows connected (hub only).';
                const resp = { type: 'response', id: msg.id, content };
                this.log('[HUB-MSG] >>> ' + JSON.stringify(resp));
                socket?.send(JSON.stringify(resp));
                break;
            case 'query':
            case 'task':
                this.log('[QUERY] *** Processing query id=' + msg.id);
                // Add to sidebar messages
                this.messagesProvider.addMessage(msg);
                // Store the originating socket for response routing
                this.pendingQuerySockets.set(msg.id, socket);
                this.log('[QUERY] Stored MCP socket for response (pending=' + this.pendingQuerySockets.size + ')');
                if (msg.fromWindow === 'claude-code-mcp') {
                    this.log('[QUERY] Source is MCP, routing to windows...');
                    // MCP query - route to target window or all windows (excluding MCP)
                    if (msg.toWindow) {
                        // Check if targeting self (hub window)
                        if (this.isTargetingSelf(msg.toWindow)) {
                            this.log('[QUERY] Target is self (hub window), handling locally');
                            this.handleIncomingQuery(msg);
                        }
                        else {
                            // Use fuzzy matching to find target window
                            const target = this.findWindowByTarget(msg.toWindow);
                            this.log('[QUERY] Target: ' + msg.toWindow + ' | found=' + !!target + ' | hasSocket=' + !!target?.socket + ' | readyState=' + (target?.socket?.readyState ?? 'N/A'));
                            if (target?.socket && target.socket.readyState === ws_1.WebSocket.OPEN) {
                                try {
                                    this.log('[QUERY] >>> Sending to target window: ' + target.id);
                                    target.socket.send(JSON.stringify(msg));
                                    this.log('[QUERY] ✓ Sent to target');
                                }
                                catch (e) {
                                    this.log('[QUERY] !!! Send error to target: ' + e.message);
                                    this.log('[QUERY] >>> Handling LOCALLY (send failed)');
                                    this.handleIncomingQuery(msg);
                                }
                            }
                            else {
                                // Target not found or socket not open - handle locally
                                this.log('[QUERY] >>> Handling LOCALLY (target not found or socket not open)');
                                this.handleIncomingQuery(msg);
                            }
                        }
                    }
                    else {
                        // Broadcast to all real windows (not MCP)
                        this.log('[QUERY] No target, will broadcast + handle locally');
                        this.log('[QUERY] Windows in registry: ' + Array.from(this.windows.keys()).join(', '));
                        let sentCount = 0;
                        for (const [id, w] of this.windows) {
                            this.log('[QUERY] Checking ' + id + ': isMCP=' + (id === 'claude-code-mcp') + ', socket=' + !!w.socket + ', readyState=' + (w.socket?.readyState ?? 'N/A'));
                            if (id !== 'claude-code-mcp' && id !== this.windowId && w.socket && w.socket.readyState === ws_1.WebSocket.OPEN) {
                                try {
                                    this.log('[QUERY] >>> Sending to: ' + id);
                                    w.socket.send(JSON.stringify(msg));
                                    sentCount++;
                                    this.log('[QUERY] ✓ Sent to ' + id);
                                }
                                catch (e) {
                                    this.log('[QUERY] !!! Send error to ' + id + ': ' + e.message);
                                }
                            }
                        }
                        this.log('[QUERY] Sent to ' + sentCount + ' client windows');
                        // ALWAYS handle locally on hub since hub is also a VS Code window
                        this.log('[QUERY] >>> Handling LOCALLY on hub window');
                        this.handleIncomingQuery(msg);
                    }
                }
                else {
                    // Regular window query
                    this.log('[QUERY] Source is regular window');
                    if (msg.toWindow) {
                        // Use fuzzy matching for regular window queries too
                        const target = this.findWindowByTarget(msg.toWindow);
                        if (target?.socket && target.socket.readyState === ws_1.WebSocket.OPEN) {
                            target.socket.send(JSON.stringify(msg));
                        }
                        else {
                            this.log('[QUERY] Target not found for regular window query: ' + msg.toWindow);
                        }
                    }
                    else {
                        this.broadcast(msg, msg.fromWindow);
                    }
                }
                break;
            case 'response':
                this.log('[RESPONSE] *** Processing response for id=' + msg.id);
                // Add to sidebar messages
                this.messagesProvider.addMessage(msg);
                this.log('[RESPONSE] Pending query IDs: [' + Array.from(this.pendingQuerySockets.keys()).join(', ') + ']');
                // Route response back to originating socket (could be MCP or window)
                const originalSocket = this.pendingQuerySockets.get(msg.id);
                this.log('[RESPONSE] Original socket found=' + !!originalSocket + ' | state=' + (originalSocket?.readyState ?? 'N/A'));
                let responseSent = false;
                if (originalSocket && originalSocket.readyState === ws_1.WebSocket.OPEN) {
                    try {
                        this.log('[RESPONSE] >>> Routing back via pendingQuerySockets');
                        const jsonMsg = JSON.stringify(msg);
                        this.log('[RESPONSE] Sending: ' + jsonMsg.substring(0, 150));
                        originalSocket.send(jsonMsg);
                        this.pendingQuerySockets.delete(msg.id);
                        this.log('[RESPONSE] ✓ Sent successfully via pendingQuerySockets');
                        responseSent = true;
                    }
                    catch (sendErr) {
                        this.log('[RESPONSE] !!! Send error: ' + sendErr.message);
                    }
                }
                // Try fallback if primary path failed
                if (!responseSent && msg.toWindow) {
                    this.log('[RESPONSE] Trying fallback via fuzzy window lookup for: ' + msg.toWindow);
                    const targetWindow = this.findWindowByTarget(msg.toWindow);
                    this.log('[RESPONSE] Target window entry: ' + (targetWindow ? 'found' : 'NOT FOUND'));
                    if (targetWindow) {
                        this.log('[RESPONSE] Target socket: ' + (targetWindow.socket ? 'exists, state=' + targetWindow.socket.readyState : 'NULL'));
                    }
                    if (targetWindow?.socket && targetWindow.socket.readyState === ws_1.WebSocket.OPEN) {
                        try {
                            const jsonMsg = JSON.stringify(msg);
                            this.log('[RESPONSE] Sending via fallback: ' + jsonMsg.substring(0, 150));
                            targetWindow.socket.send(jsonMsg);
                            this.log('[RESPONSE] ✓ Sent successfully via fallback');
                            responseSent = true;
                        }
                        catch (sendErr) {
                            this.log('[RESPONSE] !!! Fallback send error: ' + sendErr.message);
                        }
                    }
                }
                if (!responseSent) {
                    this.log('[RESPONSE] !!! CRITICAL: Could not route response - all methods failed');
                    this.log('[RESPONSE] !!! msg.id=' + msg.id + ', msg.toWindow=' + msg.toWindow);
                    this.log('[RESPONSE] !!! Windows in registry: ' + Array.from(this.windows.keys()).join(', '));
                }
                break;
            case 'broadcast':
                // Broadcast to all windows (not MCP)
                this.log('[HUB-MSG] Broadcasting message to team');
                // Add to sidebar messages
                this.messagesProvider.addMessage(msg);
                for (const [id, w] of this.windows) {
                    if (id !== msg.fromWindow && id !== 'claude-code-mcp' && w.socket && w.socket.readyState === ws_1.WebSocket.OPEN) {
                        try {
                            w.socket.send(JSON.stringify(msg));
                            this.log('[HUB-MSG] ✓ Broadcast sent to ' + id);
                        }
                        catch (e) {
                            this.log('[HUB-MSG] !!! Broadcast error to ' + id + ': ' + e.message);
                        }
                    }
                }
                // Show notification on hub
                vscode.window.showInformationMessage('[Team] ' + msg.content.substring(0, 100));
                break;
        }
    }
    handleClientMessage(msg) {
        this.log('[CLIENT] Processing message type=' + msg.type);
        if (msg.type === 'windowList') {
            this.log('[CLIENT] Received window list with ' + msg.windows?.length + ' windows');
            this.windows = new Map(msg.windows.map((w) => [w.id, w]));
            // Update sidebar with received window list
            this.windowsProvider.updateWindows(this.windows);
        }
        else if (msg.type === 'query' || msg.type === 'task') {
            this.log('[CLIENT] Received query/task, calling handleIncomingQuery');
            this.messagesProvider.addMessage(msg);
            this.handleIncomingQuery(msg);
        }
        else if (msg.type === 'response') {
            this.log('[CLIENT] Received response');
            this.messagesProvider.addMessage(msg);
            this.handleIncomingResponse(msg);
        }
        else if (msg.type === 'broadcast') {
            this.log('[CLIENT] Received broadcast: ' + msg.content?.substring(0, 50));
            this.messagesProvider.addMessage(msg);
            vscode.window.showInformationMessage('[Team] ' + msg.content?.substring(0, 100));
        }
        else {
            this.log('[CLIENT] Unknown message type: ' + msg.type);
        }
    }
    async handleIncomingQuery(msg) {
        this.log('');
        this.log('┌──────────────────────────────────────────────────────────────');
        this.log('│ [LOCAL] HANDLING QUERY LOCALLY');
        this.log('│   id: ' + msg.id);
        this.log('│   from: ' + msg.fromWindow);
        this.log('│   content: ' + msg.content.substring(0, 80));
        this.log('└──────────────────────────────────────────────────────────────');
        // Use the improved auto-responder with query classification
        const incomingQuery = {
            id: msg.id,
            content: msg.content,
            fromWindow: msg.fromWindow,
            fromWindowName: msg.fromWindow,
            timestamp: msg.timestamp
        };
        // Check if we should auto-respond
        const decision = this.autoResponder.shouldAutoRespond(incomingQuery);
        this.log(`[LOCAL] Classification: intent=${decision.classification.intent}, confidence=${decision.classification.confidence.toFixed(2)}`);
        this.log(`[LOCAL] Should respond: ${decision.shouldRespond}, requires approval: ${decision.requiresApproval}`);
        if (decision.shouldRespond && !decision.requiresApproval) {
            // Auto-respond using the strategy pattern
            this.log('[LOCAL] *** AUTO-RESPONDING (Strategy Pattern) ***');
            const context = this.bridge.gatherContext();
            context.windowId = this.windowId;
            const result = await this.autoResponder.generateResponse(incomingQuery, context);
            if (result.success) {
                this.log(`[LOCAL] Response generated by ${result.strategyUsed} strategy (${result.processingTimeMs}ms)`);
                this.sendResponse(msg.id, msg.fromWindow, result.response);
                vscode.window.showInformationMessage(`Auto-responded to ${msg.fromWindow} using ${result.strategyUsed} strategy`);
            }
            else {
                this.log('[LOCAL] Auto-response failed: ' + result.error);
                // Fall back to basic context response
                const fallbackResponse = this.generateContextResponse(msg.content);
                this.sendResponse(msg.id, msg.fromWindow, fallbackResponse);
                vscode.window.showInformationMessage('Auto-responded with fallback context');
            }
            return;
        }
        // Show notification with options for queries requiring approval or when auto-respond is off
        const intentLabel = decision.classification.intent.replace(/_/g, ' ');
        const action = await vscode.window.showInformationMessage(`[${intentLabel}] Query from ${msg.fromWindow}: ${msg.content.substring(0, 40)}...`, 'Smart Response', 'Quick Context', 'View', 'Ignore');
        if (action === 'View') {
            this.outputChannel.show();
            this.log('Query: ' + msg.content);
        }
        else if (action === 'Smart Response') {
            // Use full strategy pattern response
            const context = this.bridge.gatherContext();
            context.windowId = this.windowId;
            const result = await this.autoResponder.generateResponse(incomingQuery, context);
            this.sendResponse(msg.id, msg.fromWindow, result.response);
            vscode.window.showInformationMessage(`Response sent (${result.strategyUsed} strategy)`);
        }
        else if (action === 'Quick Context') {
            // Use quick context response
            const context = this.bridge.gatherContext();
            const response = this.autoResponder.quickContextResponse(context);
            this.sendResponse(msg.id, msg.fromWindow, response);
            vscode.window.showInformationMessage('Quick context response sent!');
        }
    }
    generateContextResponse(query) {
        const ctx = this.bridge.gatherContext();
        const editor = vscode.window.activeTextEditor;
        let response = `## Response from ${vscode.workspace.name || 'Unknown'}\n\n`;
        response += `**Project:** ${ctx.projectName}\n`;
        response += `**Current File:** ${ctx.currentFile || 'None'}\n`;
        response += `**Git Branch:** ${ctx.gitBranch || 'Unknown'}\n`;
        response += `**Recent Files:** ${ctx.recentFiles.slice(0, 5).join(', ') || 'None'}\n\n`;
        // Add current selection if relevant
        if (editor?.selection && !editor.selection.isEmpty) {
            const selectedText = editor.document.getText(editor.selection);
            if (selectedText.length < 1000) {
                response += `**Currently Selected Code:**\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
            }
        }
        // Add open errors if any
        if (ctx.openProblems.length > 0) {
            response += `**Open Errors (${ctx.openProblems.length}):**\n`;
            ctx.openProblems.slice(0, 5).forEach(p => {
                response += `- ${p.message}\n`;
            });
            response += '\n';
        }
        // Add query acknowledgment
        response += `**Your Query:** ${query}\n\n`;
        response += `_This is an automated context response. The Claude instance in this window can see this query._`;
        this.log('[QUERY] Generated response: ' + response.substring(0, 200));
        return response;
    }
    handleIncomingResponse(msg) {
        this.outputChannel.show();
        this.log('Response from ' + msg.fromWindow + ': ' + msg.content);
    }
    handleSharedResponse(r) { this.log('Shared response: ' + r.id); }
    registerWindow() {
        const msg = { id: this.windowId + '-' + Date.now(), fromWindow: this.windowId, type: 'status', content: vscode.workspace.name || 'Unnamed', timestamp: Date.now(), metadata: { projectContext: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath } };
        if (this.isHub) {
            this.windows.set(this.windowId, { id: this.windowId, name: msg.content, projectPath: msg.metadata.projectContext, status: 'idle', capabilities: [] });
            // Update sidebar after hub registers itself
            this.broadcastWindowList();
        }
        else {
            this.socket?.send(JSON.stringify(msg));
        }
    }
    broadcast(msg, excludeId) {
        this.log('[BROADCAST] Broadcasting msg type=' + msg.type + ', excluding=' + (excludeId || 'none'));
        const data = JSON.stringify(msg);
        for (const [id, w] of this.windows) {
            if (id !== excludeId && w.socket && w.socket.readyState === ws_1.WebSocket.OPEN) {
                try {
                    w.socket.send(data);
                    this.log('[BROADCAST] ✓ Sent to ' + id);
                }
                catch (e) {
                    this.log('[BROADCAST] !!! Error sending to ' + id + ': ' + e.message);
                }
            }
        }
    }
    broadcastWindowList() {
        this.log('[BROADCAST-LIST] Starting broadcast to ' + this.windows.size + ' registered windows');
        const list = Array.from(this.windows.values()).map(w => ({ id: w.id, name: w.name, projectPath: w.projectPath, status: w.status }));
        const data = JSON.stringify({ type: 'windowList', windows: list });
        for (const [id, w] of this.windows) {
            this.log('[BROADCAST-LIST] ' + id + ': socket=' + (w.socket ? 'YES' : 'NO') + ', readyState=' + (w.socket?.readyState ?? 'N/A'));
            if (w.socket && w.socket.readyState === ws_1.WebSocket.OPEN) {
                try {
                    w.socket.send(data);
                    this.log('[BROADCAST-LIST] ✓ Sent to ' + id);
                }
                catch (e) {
                    this.log('[BROADCAST-LIST] !!! Send error to ' + id + ': ' + e.message);
                }
            }
            else if (w.socket) {
                this.log('[BROADCAST-LIST] !!! Socket for ' + id + ' not OPEN (state=' + w.socket.readyState + ')');
            }
        }
        // Update sidebar
        this.windowsProvider.updateWindows(this.windows, this.isHub ? this.windowId : undefined);
    }
    async sendQuery(targetId, query) {
        const msg = { id: this.windowId + '-' + Date.now(), fromWindow: this.windowId, toWindow: targetId, type: 'query', content: query, timestamp: Date.now() };
        if (this.isHub)
            this.handleHubMessage(msg, null);
        else
            this.socket?.send(JSON.stringify(msg));
    }
    sendResponse(queryId, toWindow, response) {
        this.log('[SEND-RESPONSE] Sending response for query=' + queryId + ' to=' + toWindow);
        const msg = { id: queryId, fromWindow: this.windowId, toWindow, type: 'response', content: response, timestamp: Date.now() };
        if (this.isHub) {
            this.log('[SEND-RESPONSE] I am hub, calling handleHubMessage directly');
            this.handleHubMessage(msg, null);
        }
        else {
            this.log('[SEND-RESPONSE] I am client, sending via socket');
            this.socket?.send(JSON.stringify(msg));
        }
    }
    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.sendQuery', async () => {
            const windows = Array.from(this.windows.values()).filter(w => w.id !== this.windowId);
            const t = await vscode.window.showQuickPick([{ label: 'All', id: undefined }, ...windows.map(w => ({ label: w.name, id: w.id }))]);
            if (!t)
                return;
            const q = await vscode.window.showInputBox({ prompt: 'Query' });
            if (q)
                await this.sendQuery(t.id, q);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.showWindows', async () => {
            const list = Array.from(this.windows.values());
            if (!list.length) {
                vscode.window.showInformationMessage('No windows');
                return;
            }
            await vscode.window.showQuickPick(list.map(w => ({ label: w.name, description: w.projectPath })));
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.broadcastContext', async () => {
            await this.sendQuery(undefined, 'Context: ' + vscode.workspace.name);
            vscode.window.showInformationMessage('Broadcasted');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.requestHelp', async () => {
            const h = await vscode.window.showInputBox({ prompt: 'Help?' });
            if (h) {
                await this.sendQuery(undefined, 'HELP: ' + h);
                vscode.window.showInformationMessage('Sent');
            }
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.showLog', () => this.outputChannel.show()));
    }
    updateStatus(s) { this.statusBar.text = '$(organization) Claude Team: ' + s; }
    log(m) { this.outputChannel.appendLine('[' + new Date().toLocaleTimeString() + '] ' + m); }
    dispose() { this.socket?.close(); this.wss?.close(); this.server?.close(); this.sharedContext?.dispose(); }
}
let hub;
function activate(context) {
    hub = new ClaudeTeamHub(context);
    hub.initialize();
    context.subscriptions.push({ dispose: () => hub.dispose() });
}
function deactivate() { hub?.dispose(); }
//# sourceMappingURL=extension.js.map