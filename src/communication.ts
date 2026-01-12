import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { Message, WindowInfo, ClaudeQuery, ClaudeResponse } from './types';
import { EventEmitter } from 'events';

// Create a shared output channel reference
let outputChannel: { appendLine: (text: string) => void } = {
    appendLine: (text: string) => console.log(text)
};

export function setCommsLogger(logger: { appendLine: (text: string) => void }) {
    outputChannel = logger;
}

export class ClaudeTeamCommunication extends EventEmitter {
    private server: WebSocketServer | null = null;
    private client: WebSocket | null = null;
    private port: number;
    private windowInfo: WindowInfo;
    private connections: Map<string, WebSocket> = new Map();
    private windows: WindowInfo[] = [];
    private sharedState: Record<string, any> = {};

    constructor(port: number, windowName: string) {
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

    private async tryBecomeHub() {
        try {
            outputChannel.appendLine(`[System] Attempting to start Hub on port ${this.port}...`);
            this.server = new WebSocketServer({ port: this.port });
            
            this.server.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    outputChannel.appendLine(`[System] Port ${this.port} in use, connecting as client.`);
                    this.connectAsClient();
                } else {
                    outputChannel.appendLine(`[Error] Hub server error: ${err}`);
                    this.emit('error', err);
                }
            });

            this.server.on('connection', (socket) => {
                let socketId = '';

                // Set up message listener for this client
                socket.on('message', (data) => {
                    try {
                        const message: Message = JSON.parse(data.toString());
                        outputChannel.appendLine(`[Hub] Received message: ${message.type}`);
                        this.handleHubMessage(socket, message, (id) => {
                            socketId = id;
                        });
                    } catch (e) {
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
        } catch (err) {
            outputChannel.appendLine(`[System] Could not start server: ${err}. Attempting client connection.`);
            this.connectAsClient();
        }
    }

    private connectAsClient() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }

        this.client = new WebSocket(`ws://localhost:${this.port}`);
        
        this.client.on('open', () => {
            console.log('Connected to Hub as client');
            this.send({ type: 'register', window: this.windowInfo });
            this.emit('ready', false);
        });

        this.client.on('message', (data) => {
            try {
                const message: Message = JSON.parse(data.toString());
                this.handleClientMessage(message);
            } catch (e) {
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

    private handleHubMessage(socket: WebSocket | null, message: Message, setSocketId: (id: string) => void) {
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

    private handleClientMessage(message: Message) {
        if (message.type === 'windowList') {
            this.windows = message.windows;
        } else if (message.type === 'memorySync') {
            this.sharedState = message.state;
        }
        this.emit('message', message);
    }

    getSharedState() {
        return this.sharedState;
    }

    private broadcastWindowList() {
        outputChannel.appendLine(`[Hub] Broadcasting window list. Total connected: ${this.windows.length}`);
        this.broadcast({ type: 'windowList', windows: this.windows });
    }

    private broadcast(message: Message) {
        const data = JSON.stringify(message);
        outputChannel.appendLine(`[Router] Broadcasting ${message.type}`);
        
        if (this.server) {
            // Send to all connected clients
            this.connections.forEach((socket, id) => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(data);
                }
            });
        } else if (this.client && this.client.readyState === WebSocket.OPEN) {
            // Send to Hub
            this.client.send(data);
        }
    }

    send(message: Message) {
        if (this.server) {
            // If we are the hub, process it through the hub logic
            this.handleHubMessage(null, message, () => {});
        } else if (this.client && this.client.readyState === WebSocket.OPEN) {
            this.client.send(JSON.stringify(message));
        } else {
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
