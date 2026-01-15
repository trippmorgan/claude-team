/**
 * Claude Team Orchestration Layer
 *
 * Coordinates multiple Claude agents across VS Code windows and browser extensions.
 * Provides task delegation, workflow management, and unified communication.
 */

import WebSocket from 'ws';
import http from 'http';

// =============================================================================
// TYPES
// =============================================================================

export interface Agent {
  id: string;
  name: string;
  type: 'claude-code' | 'browser' | 'observer' | 'custom';
  capabilities: string[];
  status: 'idle' | 'busy' | 'offline';
  projectPath?: string;
  lastSeen: number;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  assignedTo?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'critical';
  dependencies: string[];
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Workflow {
  id: string;
  name: string;
  tasks: Task[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  context: Record<string, any>;
  createdAt: number;
}

export interface Message {
  id: string;
  type: 'task' | 'query' | 'response' | 'broadcast' | 'status';
  from: string;
  to?: string;
  content: any;
  timestamp: number;
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export class Orchestrator {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private workflows: Map<string, Workflow> = new Map();
  private hubSocket: WebSocket | null = null;
  private server: http.Server | null = null;
  private wss: WebSocket.Server | null = null;
  private messageHandlers: Map<string, (msg: Message) => void> = new Map();

  constructor(private config: {
    hubUrl?: string;
    port?: number;
    name?: string;
  } = {}) {
    this.config = {
      hubUrl: config.hubUrl || 'ws://localhost:4847',
      port: config.port || 8888,
      name: config.name || 'orchestrator'
    };
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async start() {
    console.log('[Orchestrator] Starting...');

    // Connect to Claude Team hub
    await this.connectToHub();

    // Start orchestrator server
    await this.startServer();

    // Start agent discovery
    this.startAgentDiscovery();

    console.log('[Orchestrator] Ready');
  }

  private async connectToHub(): Promise<void> {
    return new Promise((resolve) => {
      this.hubSocket = new WebSocket(this.config.hubUrl!);

      this.hubSocket.on('open', () => {
        console.log('[Orchestrator] Connected to hub');

        // Register as orchestrator
        this.hubSocket!.send(JSON.stringify({
          fromWindow: 'orchestrator',
          type: 'status',
          content: 'Orchestrator',
          timestamp: Date.now(),
          metadata: { capabilities: ['task-delegation', 'workflow-management'] }
        }));

        resolve();
      });

      this.hubSocket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleHubMessage(msg);
        } catch (err) {
          console.error('[Orchestrator] Error parsing hub message:', err);
        }
      });

      this.hubSocket.on('close', () => {
        console.log('[Orchestrator] Disconnected from hub, reconnecting...');
        setTimeout(() => this.connectToHub(), 5000);
      });

      this.hubSocket.on('error', (err) => {
        console.error('[Orchestrator] Hub error:', err);
        resolve(); // Continue without hub
      });
    });
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        this.handleHttpRequest(req, res);
      });

      this.wss = new WebSocket.Server({ server: this.server });

      this.wss.on('connection', (socket) => {
        console.log('[Orchestrator] New agent connected');

        socket.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleAgentMessage(msg, socket);
          } catch (err) {
            console.error('[Orchestrator] Error parsing agent message:', err);
          }
        });
      });

      this.server.listen(this.config.port, () => {
        console.log(`[Orchestrator] Server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  private startAgentDiscovery() {
    // Periodically request status from hub
    setInterval(() => {
      if (this.hubSocket?.readyState === WebSocket.OPEN) {
        this.hubSocket.send(JSON.stringify({
          id: `status-req-${Date.now()}`,
          fromWindow: 'orchestrator',
          type: 'status_request',
          timestamp: Date.now()
        }));
      }
    }, 30000);
  }

  // ---------------------------------------------------------------------------
  // MESSAGE HANDLERS
  // ---------------------------------------------------------------------------

  private handleHubMessage(msg: any) {
    switch (msg.type) {
      case 'windowList':
        this.updateAgentsFromWindowList(msg.windows);
        break;

      case 'response':
        const handler = this.messageHandlers.get(msg.id);
        if (handler) {
          handler(msg);
          this.messageHandlers.delete(msg.id);
        }
        break;

      case 'broadcast':
        console.log('[Orchestrator] Broadcast:', msg.content);
        break;

      case 'task_update':
        this.handleTaskUpdate(msg);
        break;
    }
  }

  private handleAgentMessage(msg: any, socket: WebSocket) {
    switch (msg.type) {
      case 'register':
        this.registerAgent({
          id: msg.agentId,
          name: msg.name,
          type: msg.agentType || 'custom',
          capabilities: msg.capabilities || [],
          status: 'idle',
          lastSeen: Date.now()
        });
        socket.send(JSON.stringify({ type: 'registered', agentId: msg.agentId }));
        break;

      case 'task_complete':
        this.completeTask(msg.taskId, msg.result);
        break;

      case 'task_failed':
        this.failTask(msg.taskId, msg.error);
        break;

      case 'status_update':
        const agent = this.agents.get(msg.agentId);
        if (agent) {
          agent.status = msg.status;
          agent.lastSeen = Date.now();
        }
        break;
    }
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url!, `http://localhost:${this.config.port}`);

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        agents: this.agents.size,
        tasks: this.tasks.size,
        workflows: this.workflows.size
      }));
      return;
    }

    // Get agents
    if (req.method === 'GET' && url.pathname === '/agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: Array.from(this.agents.values()) }));
      return;
    }

    // Get tasks
    if (req.method === 'GET' && url.pathname === '/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tasks: Array.from(this.tasks.values()) }));
      return;
    }

    // Create task
    if (req.method === 'POST' && url.pathname === '/tasks') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const taskData = JSON.parse(body);
          const task = await this.createTask(taskData);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Create workflow
    if (req.method === 'POST' && url.pathname === '/workflows') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const workflowData = JSON.parse(body);
          const workflow = await this.createWorkflow(workflowData);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ workflow }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Run workflow
    if (req.method === 'POST' && url.pathname.startsWith('/workflows/') && url.pathname.endsWith('/run')) {
      const workflowId = url.pathname.split('/')[2];
      this.runWorkflow(workflowId).then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  // ---------------------------------------------------------------------------
  // AGENT MANAGEMENT
  // ---------------------------------------------------------------------------

  private updateAgentsFromWindowList(windows: any[]) {
    for (const w of windows) {
      if (w.id === 'claude-code-mcp' || w.id === 'orchestrator') continue;

      this.agents.set(w.id, {
        id: w.id,
        name: w.name,
        type: 'claude-code',
        capabilities: ['code', 'query', 'task'],
        status: w.status || 'idle',
        projectPath: w.projectPath,
        lastSeen: Date.now()
      });
    }
  }

  registerAgent(agent: Agent) {
    this.agents.set(agent.id, agent);
    console.log(`[Orchestrator] Registered agent: ${agent.name} (${agent.type})`);
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAgentsByCapability(capability: string): Agent[] {
    return Array.from(this.agents.values())
      .filter(a => a.capabilities.includes(capability) && a.status !== 'offline');
  }

  // ---------------------------------------------------------------------------
  // TASK MANAGEMENT
  // ---------------------------------------------------------------------------

  async createTask(data: Partial<Task>): Promise<Task> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: data.name || 'Unnamed Task',
      description: data.description || '',
      status: 'pending',
      priority: data.priority || 'normal',
      dependencies: data.dependencies || [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.tasks.set(task.id, task);

    // Auto-assign if agent specified
    if (data.assignedTo) {
      await this.assignTask(task.id, data.assignedTo);
    }

    return task;
  }

  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    task.assignedTo = agentId;
    task.status = 'in_progress';
    task.updatedAt = Date.now();

    // Send task to agent via hub
    if (this.hubSocket?.readyState === WebSocket.OPEN) {
      this.hubSocket.send(JSON.stringify({
        id: `task-${task.id}`,
        fromWindow: 'orchestrator',
        toWindow: agentId,
        type: 'query',
        content: JSON.stringify({
          type: 'task_assignment',
          task: task
        }),
        timestamp: Date.now()
      }));
    }

    console.log(`[Orchestrator] Assigned task ${task.name} to ${agent.name}`);
  }

  private handleTaskUpdate(msg: any) {
    const task = this.tasks.get(msg.taskId);
    if (!task) return;

    task.status = msg.status;
    task.result = msg.result;
    task.error = msg.error;
    task.updatedAt = Date.now();

    console.log(`[Orchestrator] Task ${task.name} updated: ${task.status}`);
  }

  completeTask(taskId: string, result: any) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.result = result;
    task.updatedAt = Date.now();

    console.log(`[Orchestrator] Task ${task.name} completed`);

    // Check if this unblocks other tasks in any workflow
    this.checkWorkflowProgress();
  }

  failTask(taskId: string, error: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.error = error;
    task.updatedAt = Date.now();

    console.log(`[Orchestrator] Task ${task.name} failed: ${error}`);
  }

  // ---------------------------------------------------------------------------
  // WORKFLOW MANAGEMENT
  // ---------------------------------------------------------------------------

  async createWorkflow(data: {
    name: string;
    tasks: Partial<Task>[];
    context?: Record<string, any>;
  }): Promise<Workflow> {
    const workflow: Workflow = {
      id: `workflow-${Date.now()}`,
      name: data.name,
      tasks: [],
      status: 'pending',
      context: data.context || {},
      createdAt: Date.now()
    };

    // Create tasks
    for (const taskData of data.tasks) {
      const task = await this.createTask(taskData);
      workflow.tasks.push(task);
    }

    this.workflows.set(workflow.id, workflow);
    console.log(`[Orchestrator] Created workflow: ${workflow.name} with ${workflow.tasks.length} tasks`);

    return workflow;
  }

  async runWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflow.status = 'running';
    console.log(`[Orchestrator] Running workflow: ${workflow.name}`);

    // Start tasks with no dependencies
    for (const task of workflow.tasks) {
      if (task.dependencies.length === 0 && task.status === 'pending') {
        await this.executeTask(task);
      }
    }

    return workflow;
  }

  private async executeTask(task: Task): Promise<void> {
    // Find best agent for task
    const agents = this.getAgentsByCapability('task');
    const idleAgents = agents.filter(a => a.status === 'idle');

    if (idleAgents.length > 0) {
      await this.assignTask(task.id, idleAgents[0].id);
    } else if (agents.length > 0) {
      // Queue for first available
      await this.assignTask(task.id, agents[0].id);
    } else {
      console.log(`[Orchestrator] No agents available for task: ${task.name}`);
    }
  }

  private checkWorkflowProgress() {
    for (const workflow of this.workflows.values()) {
      if (workflow.status !== 'running') continue;

      // Check if all tasks completed
      const allCompleted = workflow.tasks.every(t => t.status === 'completed');
      const anyFailed = workflow.tasks.some(t => t.status === 'failed');

      if (allCompleted) {
        workflow.status = 'completed';
        console.log(`[Orchestrator] Workflow ${workflow.name} completed`);
      } else if (anyFailed) {
        workflow.status = 'failed';
        console.log(`[Orchestrator] Workflow ${workflow.name} failed`);
      } else {
        // Start any unblocked tasks
        for (const task of workflow.tasks) {
          if (task.status !== 'pending') continue;

          const depsCompleted = task.dependencies.every(depId => {
            const depTask = workflow.tasks.find(t => t.id === depId);
            return depTask?.status === 'completed';
          });

          if (depsCompleted) {
            this.executeTask(task);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // MESSAGING
  // ---------------------------------------------------------------------------

  async sendQuery(to: string, query: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `query-${Date.now()}`;

      this.messageHandlers.set(id, (msg) => {
        resolve(msg.content);
      });

      setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error('Query timeout'));
      }, 60000);

      if (this.hubSocket?.readyState === WebSocket.OPEN) {
        this.hubSocket.send(JSON.stringify({
          id,
          fromWindow: 'orchestrator',
          toWindow: to,
          type: 'query',
          content: query,
          timestamp: Date.now()
        }));
      }
    });
  }

  broadcast(message: string, category: string = 'update') {
    if (this.hubSocket?.readyState === WebSocket.OPEN) {
      this.hubSocket.send(JSON.stringify({
        id: `broadcast-${Date.now()}`,
        fromWindow: 'orchestrator',
        type: 'broadcast',
        content: `[${category.toUpperCase()}] ${message}`,
        timestamp: Date.now()
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // SHUTDOWN
  // ---------------------------------------------------------------------------

  async stop() {
    console.log('[Orchestrator] Shutting down...');

    if (this.hubSocket) {
      this.hubSocket.close();
    }

    if (this.wss) {
      this.wss.close();
    }

    if (this.server) {
      this.server.close();
    }
  }
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const orchestrator = new Orchestrator();
  orchestrator.start();

  process.on('SIGINT', async () => {
    await orchestrator.stop();
    process.exit(0);
  });
}

export default Orchestrator;
