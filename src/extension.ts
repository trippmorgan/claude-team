// extension.ts - Main Extension Entry Point
// EXTENSIVE LOGGING VERSION
import * as vscode from 'vscode';
import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { ClaudeCodeBridge, ClaudeQuery } from './claudeCodeIntegration';
import { SharedContextManager } from './sharedContextApproach';
import { ImprovedAutoResponder, QueryIntent } from './autoResponse';

// ============================================================================
// SIDEBAR TREE DATA PROVIDERS
// ============================================================================

class WindowTreeItem extends vscode.TreeItem {
  constructor(
    public readonly windowId: string,
    public readonly windowName: string,
    public readonly projectPath: string,
    public readonly isHub: boolean
  ) {
    super(windowName, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${windowName}\n${projectPath}`;
    this.description = isHub ? '(hub)' : projectPath.split('/').pop();
    this.iconPath = new vscode.ThemeIcon(isHub ? 'server' : 'window');
    this.contextValue = 'window';
  }
}

class WindowsTreeDataProvider implements vscode.TreeDataProvider<WindowTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WindowTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private windows: Map<string, { name: string; projectPath: string; isHub: boolean }> = new Map();

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  updateWindows(windows: Map<string, any>, hubId?: string): void {
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

  getTreeItem(element: WindowTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): WindowTreeItem[] {
    const items: WindowTreeItem[] = [];
    for (const [id, w] of this.windows) {
      items.push(new WindowTreeItem(id, w.name, w.projectPath, w.isHub));
    }
    return items;
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(
    public readonly messageId: string,
    public readonly from: string,
    public readonly content: string,
    public readonly type: string,
    public readonly timestamp: number
  ) {
    const time = new Date(timestamp).toLocaleTimeString();
    super(`[${time}] ${from}`, vscode.TreeItemCollapsibleState.None);
    this.tooltip = content;
    this.description = content.substring(0, 40) + (content.length > 40 ? '...' : '');
    this.iconPath = new vscode.ThemeIcon(
      type === 'query' ? 'question' :
      type === 'response' ? 'check' :
      type === 'broadcast' ? 'broadcast' : 'mail'
    );
  }
}

class MessagesTreeDataProvider implements vscode.TreeDataProvider<MessageTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MessageTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private messages: Array<{ id: string; from: string; content: string; type: string; timestamp: number }> = [];
  private maxMessages = 50;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  addMessage(msg: { id: string; fromWindow: string; content: string; type: string; timestamp: number }): void {
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

  getTreeItem(element: MessageTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): MessageTreeItem[] {
    return this.messages.map(m => new MessageTreeItem(m.id, m.from, m.content, m.type, m.timestamp));
  }
}

// ============================================================================
// MAIN EXTENSION
// ============================================================================

interface TeamMessage {
  id: string;
  fromWindow: string;
  toWindow?: string;
  type: 'query' | 'response' | 'status' | 'task' | 'windowList' | 'status_request' | 'broadcast';
  content: string;
  timestamp: number;
  metadata?: {
    projectContext?: string;
    priority?: 'low' | 'normal' | 'high';
    expectsResponse?: boolean;
  };
}

interface ClaudeWindow {
  id: string;
  name: string;
  projectPath: string;
  status: 'idle' | 'thinking' | 'busy';
  capabilities: string[];
  socket?: WebSocket;
}

class ClaudeTeamHub {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private windows: Map<string, ClaudeWindow> = new Map();
  private pendingQuerySockets: Map<string, WebSocket> = new Map();
  private outputChannel: vscode.OutputChannel;
  private statusBar: vscode.StatusBarItem;
  private windowId: string;
  private socket: WebSocket | null = null;
  private isHub: boolean = false;
  private bridge: ClaudeCodeBridge;
  private sharedContext: SharedContextManager;
  private autoResponder: ImprovedAutoResponder;

  // Sidebar tree data providers
  private windowsProvider: WindowsTreeDataProvider;
  private messagesProvider: MessagesTreeDataProvider;

  constructor(private context: vscode.ExtensionContext) {
    const workspaceName = vscode.workspace.name || 'unnamed';
    this.windowId = workspaceName + '-' + Math.random().toString(36).substring(7);
    this.outputChannel = vscode.window.createOutputChannel('Claude Team');
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBar.show();
    this.updateStatus('disconnected');
    this.bridge = new ClaudeCodeBridge(this.outputChannel);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    this.sharedContext = new SharedContextManager(workspaceRoot);

    // Initialize improved auto-responder with strategy pattern
    const autoRespondMode = vscode.workspace.getConfiguration('claudeTeam').get<string>('autoRespondMode', 'smart');
    this.autoResponder = new ImprovedAutoResponder(this.bridge, this.outputChannel, {
      enabled: vscode.workspace.getConfiguration('claudeTeam').get<boolean>('autoRespond', true),
      mode: autoRespondMode as 'off' | 'context-only' | 'smart' | 'full',
      logClassifications: true,
      claudeTimeout: 120000,
      requireApprovalFor: [QueryIntent.TASK_DELEGATION]
    });

    // Initialize and register sidebar providers
    this.windowsProvider = new WindowsTreeDataProvider();
    this.messagesProvider = new MessagesTreeDataProvider();
    vscode.window.registerTreeDataProvider('claude-team.windows', this.windowsProvider);
    vscode.window.registerTreeDataProvider('claude-team.messages', this.messagesProvider);

    this.log('[CONSTRUCTOR] Created, windowId=' + this.windowId);
  }

  async initialize() {
    this.log('========== INIT START ==========');
    this.outputChannel.show(true);
    try {
      const connected = await this.tryConnectToHub();
      this.log('[INIT] Connect result: ' + connected);
      if (!connected) await this.startHub();
      this.sharedContext.watchForResponses((r) => this.handleSharedResponse(r));
      this.registerCommands();
      this.log('========== INIT COMPLETE ==========');
    } catch (e: any) {
      this.log('[INIT] ERROR: ' + e.message);
    }
  }

  private async tryConnectToHub(): Promise<boolean> {
    this.log('[CONNECT] Trying ws://localhost:4847...');
    return new Promise((resolve) => {
      try {
        const socket = new WebSocket('ws://localhost:4847');
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
      } catch { resolve(false); }
    });
  }

  private async startHub() {
    this.log('[HUB] Starting...');
    this.isHub = true;
    this.server = http.createServer();
    this.wss = new WebSocketServer({ server: this.server });

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
        } catch(e: any) { this.log('[HUB] Error: ' + e.message); }
      });
      socket.on('close', () => { if (clientId) { this.windows.delete(clientId); this.broadcastWindowList(); } });
    });

    this.server.listen(4847, () => {
      this.log('[HUB] STARTED on 4847');
      this.updateStatus('hub');
      this.registerWindow();
      vscode.window.showInformationMessage('Claude Team Hub on 4847');
    });
  }

  private setupClientHandlers(socket: WebSocket) {
    socket.on('message', (d) => {
      try {
        const raw = d.toString();
        this.log('[CLIENT] <<< ' + raw.substring(0, 150));
        this.handleClientMessage(JSON.parse(raw));
      } catch (e: any) {
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

  private handleHubMessage(msg: any, socket: WebSocket) {
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
        // CRITICAL: Store socket with explicit verification logging
        this.log('[STATUS] Storing window: ' + msg.fromWindow);
        this.log('[STATUS] Socket param exists: ' + !!socket + ', readyState: ' + (socket?.readyState ?? 'N/A'));
        const statusEntry: ClaudeWindow = {
          id: msg.fromWindow,
          name: msg.content,
          projectPath: msg.metadata?.projectContext || '',
          status: 'idle',
          capabilities: [],
          socket
        };
        this.windows.set(msg.fromWindow, statusEntry);
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

      case 'query': case 'task':
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
            // Specific target
            const target = this.windows.get(msg.toWindow);
            this.log('[QUERY] Target: ' + msg.toWindow + ' | found=' + !!target + ' | hasSocket=' + !!target?.socket + ' | readyState=' + (target?.socket?.readyState ?? 'N/A'));
            if (target?.socket && target.socket.readyState === WebSocket.OPEN) {
              try {
                this.log('[QUERY] >>> Sending to target window');
                target.socket.send(JSON.stringify(msg));
                this.log('[QUERY] ✓ Sent to target');
              } catch (e: any) {
                this.log('[QUERY] !!! Send error to target: ' + e.message);
                this.log('[QUERY] >>> Handling LOCALLY (send failed)');
                this.handleIncomingQuery(msg);
              }
            } else {
              // Target not found or socket not open - handle locally
              this.log('[QUERY] >>> Handling LOCALLY (target not found or socket not open)');
              this.handleIncomingQuery(msg);
            }
          } else {
            // Broadcast to all real windows (not MCP)
            this.log('[QUERY] No target, will broadcast + handle locally');
            this.log('[QUERY] Windows in registry: ' + Array.from(this.windows.keys()).join(', '));
            let sentCount = 0;
            for (const [id, w] of this.windows) {
              this.log('[QUERY] Checking ' + id + ': isMCP=' + (id === 'claude-code-mcp') + ', socket=' + !!w.socket + ', readyState=' + (w.socket?.readyState ?? 'N/A'));
              if (id !== 'claude-code-mcp' && id !== this.windowId && w.socket && w.socket.readyState === WebSocket.OPEN) {
                try {
                  this.log('[QUERY] >>> Sending to: ' + id);
                  w.socket.send(JSON.stringify(msg));
                  sentCount++;
                  this.log('[QUERY] ✓ Sent to ' + id);
                } catch (e: any) {
                  this.log('[QUERY] !!! Send error to ' + id + ': ' + e.message);
                }
              }
            }
            this.log('[QUERY] Sent to ' + sentCount + ' client windows');
            // ALWAYS handle locally on hub since hub is also a VS Code window
            this.log('[QUERY] >>> Handling LOCALLY on hub window');
            this.handleIncomingQuery(msg);
          }
        } else {
          // Regular window query
          this.log('[QUERY] Source is regular window');
          if (msg.toWindow) {
            this.windows.get(msg.toWindow)?.socket?.send(JSON.stringify(msg));
          } else {
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

        if (originalSocket && originalSocket.readyState === WebSocket.OPEN) {
          try {
            this.log('[RESPONSE] >>> Routing back via pendingQuerySockets');
            const jsonMsg = JSON.stringify(msg);
            this.log('[RESPONSE] Sending: ' + jsonMsg.substring(0, 150));
            originalSocket.send(jsonMsg);
            this.pendingQuerySockets.delete(msg.id);
            this.log('[RESPONSE] ✓ Sent successfully via pendingQuerySockets');
            responseSent = true;
          } catch (sendErr: any) {
            this.log('[RESPONSE] !!! Send error: ' + sendErr.message);
          }
        }

        // Try fallback if primary path failed
        if (!responseSent && msg.toWindow) {
          this.log('[RESPONSE] Trying fallback via windows map for: ' + msg.toWindow);
          const targetWindow = this.windows.get(msg.toWindow);
          this.log('[RESPONSE] Target window entry: ' + (targetWindow ? 'found' : 'NOT FOUND'));
          if (targetWindow) {
            this.log('[RESPONSE] Target socket: ' + (targetWindow.socket ? 'exists, state=' + targetWindow.socket.readyState : 'NULL'));
          }

          if (targetWindow?.socket && targetWindow.socket.readyState === WebSocket.OPEN) {
            try {
              const jsonMsg = JSON.stringify(msg);
              this.log('[RESPONSE] Sending via fallback: ' + jsonMsg.substring(0, 150));
              targetWindow.socket.send(jsonMsg);
              this.log('[RESPONSE] ✓ Sent successfully via fallback');
              responseSent = true;
            } catch (sendErr: any) {
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
          if (id !== msg.fromWindow && id !== 'claude-code-mcp' && w.socket && w.socket.readyState === WebSocket.OPEN) {
            try {
              w.socket.send(JSON.stringify(msg));
              this.log('[HUB-MSG] ✓ Broadcast sent to ' + id);
            } catch (e: any) {
              this.log('[HUB-MSG] !!! Broadcast error to ' + id + ': ' + e.message);
            }
          }
        }
        // Show notification on hub
        vscode.window.showInformationMessage('[Team] ' + msg.content.substring(0, 100));
        break;
    }
  }

  private handleClientMessage(msg: any) {
    this.log('[CLIENT] Processing message type=' + msg.type);
    if (msg.type === 'windowList') {
      this.log('[CLIENT] Received window list with ' + msg.windows?.length + ' windows');
      this.windows = new Map(msg.windows.map((w: any) => [w.id, w]));
      // Update sidebar with received window list
      this.windowsProvider.updateWindows(this.windows);
    } else if (msg.type === 'query' || msg.type === 'task') {
      this.log('[CLIENT] Received query/task, calling handleIncomingQuery');
      this.messagesProvider.addMessage(msg);
      this.handleIncomingQuery(msg);
    } else if (msg.type === 'response') {
      this.log('[CLIENT] Received response');
      this.messagesProvider.addMessage(msg);
      this.handleIncomingResponse(msg);
    } else if (msg.type === 'broadcast') {
      this.log('[CLIENT] Received broadcast: ' + msg.content?.substring(0, 50));
      this.messagesProvider.addMessage(msg);
      vscode.window.showInformationMessage('[Team] ' + msg.content?.substring(0, 100));
    } else {
      this.log('[CLIENT] Unknown message type: ' + msg.type);
    }
  }

  private async handleIncomingQuery(msg: TeamMessage) {
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
        vscode.window.showInformationMessage(
          `Auto-responded to ${msg.fromWindow} using ${result.strategyUsed} strategy`
        );
      } else {
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
    const action = await vscode.window.showInformationMessage(
      `[${intentLabel}] Query from ${msg.fromWindow}: ${msg.content.substring(0, 40)}...`,
      'Smart Response', 'Quick Context', 'View', 'Ignore'
    );

    if (action === 'View') {
      this.outputChannel.show();
      this.log('Query: ' + msg.content);
    } else if (action === 'Smart Response') {
      // Use full strategy pattern response
      const context = this.bridge.gatherContext();
      context.windowId = this.windowId;
      const result = await this.autoResponder.generateResponse(incomingQuery, context);
      this.sendResponse(msg.id, msg.fromWindow, result.response);
      vscode.window.showInformationMessage(`Response sent (${result.strategyUsed} strategy)`);
    } else if (action === 'Quick Context') {
      // Use quick context response
      const context = this.bridge.gatherContext();
      const response = this.autoResponder.quickContextResponse(context);
      this.sendResponse(msg.id, msg.fromWindow, response);
      vscode.window.showInformationMessage('Quick context response sent!');
    }
  }

  private generateContextResponse(query: string): string {
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

  private handleIncomingResponse(msg: TeamMessage) {
    this.outputChannel.show();
    this.log('Response from ' + msg.fromWindow + ': ' + msg.content);
  }

  private handleSharedResponse(r: any) { this.log('Shared response: ' + r.id); }

  private registerWindow() {
    const msg: TeamMessage = { id: this.windowId + '-' + Date.now(), fromWindow: this.windowId, type: 'status', content: vscode.workspace.name || 'Unnamed', timestamp: Date.now(), metadata: { projectContext: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath } };
    if (this.isHub) this.windows.set(this.windowId, { id: this.windowId, name: msg.content, projectPath: msg.metadata!.projectContext!, status: 'idle', capabilities: [] });
    else this.socket?.send(JSON.stringify(msg));
  }

  private broadcast(msg: TeamMessage, excludeId?: string) {
    this.log('[BROADCAST] Broadcasting msg type=' + msg.type + ', excluding=' + (excludeId || 'none'));
    const data = JSON.stringify(msg);
    for (const [id, w] of this.windows) {
      if (id !== excludeId && w.socket && w.socket.readyState === WebSocket.OPEN) {
        try {
          w.socket.send(data);
          this.log('[BROADCAST] ✓ Sent to ' + id);
        } catch (e: any) {
          this.log('[BROADCAST] !!! Error sending to ' + id + ': ' + e.message);
        }
      }
    }
  }

  private broadcastWindowList() {
    this.log('[BROADCAST-LIST] Starting broadcast to ' + this.windows.size + ' registered windows');
    const list = Array.from(this.windows.values()).map(w => ({ id: w.id, name: w.name, projectPath: w.projectPath, status: w.status }));
    const data = JSON.stringify({ type: 'windowList', windows: list });

    for (const [id, w] of this.windows) {
      this.log('[BROADCAST-LIST] ' + id + ': socket=' + (w.socket ? 'YES' : 'NO') + ', readyState=' + (w.socket?.readyState ?? 'N/A'));
      if (w.socket && w.socket.readyState === WebSocket.OPEN) {
        try {
          w.socket.send(data);
          this.log('[BROADCAST-LIST] ✓ Sent to ' + id);
        } catch (e: any) {
          this.log('[BROADCAST-LIST] !!! Send error to ' + id + ': ' + e.message);
        }
      } else if (w.socket) {
        this.log('[BROADCAST-LIST] !!! Socket for ' + id + ' not OPEN (state=' + w.socket.readyState + ')');
      }
    }
    // Update sidebar
    this.windowsProvider.updateWindows(this.windows, this.isHub ? this.windowId : undefined);
  }

  async sendQuery(targetId: string | undefined, query: string) {
    const msg: TeamMessage = { id: this.windowId + '-' + Date.now(), fromWindow: this.windowId, toWindow: targetId, type: 'query', content: query, timestamp: Date.now() };
    if (this.isHub) this.handleHubMessage(msg, null!); else this.socket?.send(JSON.stringify(msg));
  }

  sendResponse(queryId: string, toWindow: string, response: string) {
    this.log('[SEND-RESPONSE] Sending response for query=' + queryId + ' to=' + toWindow);
    const msg: TeamMessage = { id: queryId, fromWindow: this.windowId, toWindow, type: 'response', content: response, timestamp: Date.now() };
    if (this.isHub) {
      this.log('[SEND-RESPONSE] I am hub, calling handleHubMessage directly');
      this.handleHubMessage(msg, null!);
    } else {
      this.log('[SEND-RESPONSE] I am client, sending via socket');
      this.socket?.send(JSON.stringify(msg));
    }
  }

  private registerCommands() {
    this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.sendQuery', async () => {
      const windows = Array.from(this.windows.values()).filter(w => w.id !== this.windowId);
      const t = await vscode.window.showQuickPick([{ label: 'All', id: undefined }, ...windows.map(w => ({ label: w.name, id: w.id }))]);
      if (!t) return;
      const q = await vscode.window.showInputBox({ prompt: 'Query' });
      if (q) await this.sendQuery((t as any).id, q);
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.showWindows', async () => {
      const list = Array.from(this.windows.values());
      if (!list.length) { vscode.window.showInformationMessage('No windows'); return; }
      await vscode.window.showQuickPick(list.map(w => ({ label: w.name, description: w.projectPath })));
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.broadcastContext', async () => {
      await this.sendQuery(undefined, 'Context: ' + vscode.workspace.name);
      vscode.window.showInformationMessage('Broadcasted');
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.requestHelp', async () => {
      const h = await vscode.window.showInputBox({ prompt: 'Help?' });
      if (h) { await this.sendQuery(undefined, 'HELP: ' + h); vscode.window.showInformationMessage('Sent'); }
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand('claude-team.showLog', () => this.outputChannel.show()));
  }

  private updateStatus(s: string) { this.statusBar.text = '$(organization) Claude Team: ' + s; }
  private log(m: string) { this.outputChannel.appendLine('[' + new Date().toLocaleTimeString() + '] ' + m); }
  dispose() { this.socket?.close(); this.wss?.close(); this.server?.close(); this.sharedContext?.dispose(); }
}

let hub: ClaudeTeamHub;
export function activate(context: vscode.ExtensionContext) {
  hub = new ClaudeTeamHub(context);
  hub.initialize();
  context.subscriptions.push({ dispose: () => hub.dispose() });
}
export function deactivate() { hub?.dispose(); }
