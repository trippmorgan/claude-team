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
exports.ClaudeTeamCommunication = void 0;
exports.setCommsLogger = setCommsLogger;
const vscode = __importStar(require("vscode"));
const ws_1 = require("ws");
const events_1 = require("events");
// Create a shared output channel reference
let outputChannel = {
    appendLine: (text) => console.log(text)
};
function setCommsLogger(logger) {
    outputChannel = logger;
}
class ClaudeTeamCommunication extends events_1.EventEmitter {
    server = null;
    client = null;
    port;
    windowInfo;
    connections = new Map();
    windows = [];
    sharedState = {};
    constructor(port, windowName) {
        super();
        this.port = port;
        // Use a more reliable unique ID than sessionId which can sometimes be shared
        const uniqueId = Math.random().toString(36).substring(2, 15);
        this.windowInfo = {
            id: uniqueId,
            name: windowName || `Window-${uniqueId.substring(0, 4)}`,
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        };
    }
    async start() {
        this.tryBecomeHub();
    }
    async tryBecomeHub() {
        try {
            outputChannel.appendLine(`[System] Attempting to start Hub on port ${this.port}...`);
            this.server = new ws_1.WebSocketServer({ port: this.port });
            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    outputChannel.appendLine(`[System] Port ${this.port} in use, connecting as client.`);
                    this.connectAsClient();
                }
                else {
                    outputChannel.appendLine(`[Error] Hub server error: ${err}`);
                    this.emit('error', err);
                }
            });
            this.server.on('connection', (socket) => {
                let socketId = '';
                // Set up message listener for this client
                socket.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        outputChannel.appendLine(`[Hub] Received message: ${message.type}`);
                        this.handleHubMessage(socket, message, (id) => {
                            socketId = id;
                        });
                    }
                    catch (e) {
                        outputChannel.appendLine(`[Hub] Failed to parse message: ${e}`);
                    }
                });
                socket.on('close', () => {
                    if (socketId) {
                        outputChannel.appendLine(`[Hub] Client disconnected: ${socketId}`);
                        this.connections.delete(socketId);
                        this.windows = this.windows.filter(w => w.id !== socketId);
                        this.broadcastWindowList();
                    }
                });
                // Send current state to new connection
                socket.send(JSON.stringify({ type: 'memorySync', state: this.sharedState }));
            });
            outputChannel.appendLine(`[System] Hub successfully started.`);
            this.client = null;
            if (!this.windows.find(w => w.id === this.windowInfo.id)) {
                this.windows.push(this.windowInfo);
            }
            this.emit('ready', true);
        }
        catch (err) {
            outputChannel.appendLine(`[System] Could not start server: ${err}. Attempting client connection.`);
            this.connectAsClient();
        }
    }
    connectAsClient() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.client = new ws_1.WebSocket(`ws://localhost:${this.port}`);
        this.client.on('open', () => {
            console.log('Connected to Hub as client');
            this.send({ type: 'register', window: this.windowInfo });
            this.emit('ready', false);
        });
        this.client.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleClientMessage(message);
            }
            catch (e) {
                console.error('Failed to parse client message', e);
            }
        });
        this.client.on('error', (err) => {
            // If we can't connect, try to become the hub
            console.log('Connection error, attempting to become hub...');
            this.tryBecomeHub();
        });
        this.client.on('close', () => {
            console.log('Connection to Hub closed. Attempting to promote to Hub...');
            // Wait a random short time to avoid collision if multiple windows try to become hub
            setTimeout(() => this.tryBecomeHub(), Math.random() * 2000);
        });
    }
    handleHubMessage(socket, message, setSocketId) {
        outputChannel.appendLine(`[Hub] Handling message type: ${message.type}`);
        switch (message.type) {
            case 'register':
                if (socket) {
                    setSocketId(message.window.id);
                    this.connections.set(message.window.id, socket);
                    // Sync current memory to new window
                    socket.send(JSON.stringify({ type: 'memorySync', state: this.sharedState }));
                }
                if (!this.windows.find(w => w.id === message.window.id)) {
                    this.windows.push(message.window);
                }
                this.broadcastWindowList();
                break;
            case 'query':
            case 'response':
            case 'broadcastContext':
            case 'taskAssign':
            case 'taskUpdate':
            case 'mcpQuery':
            case 'chromeQuery':
                outputChannel.appendLine(`[Hub] Routing ${message.type}`);
                this.broadcast(message);
                // The Hub must also emit the message to its own extension logic
                this.emit('message', message);
                break;
            case 'memoryUpdate':
                this.sharedState[message.key] = message.value;
                this.broadcast({ type: 'memorySync', state: this.sharedState });
                this.emit('message', { type: 'memorySync', state: this.sharedState });
                break;
            case 'status_request':
                // Respond directly to the requesting socket with current windows
                if (socket) {
                    const statusResponse = {
                        type: 'response',
                        id: message.id,
                        content: this.windows.length > 0
                            ? `Connected windows:\n${this.windows.map(w => `- ${w.name} (${w.workspaceRoot || 'unknown path'})`).join('\n')}`
                            : 'No windows currently connected.'
                    };
                    socket.send(JSON.stringify(statusResponse));
                }
                break;
        }
    }
    handleClientMessage(message) {
        if (message.type === 'windowList') {
            this.windows = message.windows;
        }
        else if (message.type === 'memorySync') {
            this.sharedState = message.state;
        }
        this.emit('message', message);
    }
    getSharedState() {
        return this.sharedState;
    }
    broadcastWindowList() {
        outputChannel.appendLine(`[Hub] Broadcasting window list. Total connected: ${this.windows.length}`);
        this.broadcast({ type: 'windowList', windows: this.windows });
    }
    broadcast(message) {
        const data = JSON.stringify(message);
        outputChannel.appendLine(`[Router] Broadcasting ${message.type}`);
        if (this.server) {
            // Send to all connected clients
            this.connections.forEach((socket, id) => {
                if (socket.readyState === ws_1.WebSocket.OPEN) {
                    socket.send(data);
                }
            });
        }
        else if (this.client && this.client.readyState === ws_1.WebSocket.OPEN) {
            // Send to Hub
            this.client.send(data);
        }
    }
    send(message) {
        if (this.server) {
            // If we are the hub, process it through the hub logic
            this.handleHubMessage(null, message, () => { });
        }
        else if (this.client && this.client.readyState === ws_1.WebSocket.OPEN) {
            this.client.send(JSON.stringify(message));
        }
        else {
            outputChannel.appendLine(`[Error] Cannot send message: No connection available.`);
        }
    }
    getConnectedWindows() {
        return this.windows;
    }
    getWindowInfo() {
        return this.windowInfo;
    }
    isHub() {
        return !!this.server;
    }
}
exports.ClaudeTeamCommunication = ClaudeTeamCommunication;
//# sourceMappingURL=communication.js.map