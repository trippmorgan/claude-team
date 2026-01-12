"use strict";
// claude-team-mcp-server.ts
// An MCP server that Claude Code can use to communicate with other instances
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const ws_1 = __importDefault(require("ws"));
// Connect to the team hub
let hubSocket = null;
let reconnectTimer = null;
const pendingQueries = new Map();
function connectToHub() {
    // Clear any existing reconnect timer
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    try {
        console.error('[MCP] Connecting to hub at ws://localhost:4847...');
        hubSocket = new ws_1.default('ws://localhost:4847');
        hubSocket.on('open', () => {
            console.error('[MCP] Connected to hub');
            // Register as MCP client
            hubSocket?.send(JSON.stringify({
                fromWindow: 'claude-code-mcp',
                type: 'status',
                content: 'MCP Server',
                timestamp: Date.now()
            }));
        });
        hubSocket.on('message', (data) => {
            try {
                const raw = data.toString();
                const msg = JSON.parse(raw);
                console.error('[MCP] <<< Received message type=' + msg.type + ', id=' + (msg.id || 'none'));
                console.error('[MCP] <<< Full: ' + raw.substring(0, 200));
                console.error('[MCP] Pending query IDs: [' + Array.from(pendingQueries.keys()).join(', ') + ']');
                if (msg.type === 'response') {
                    console.error('[MCP] Got response! Checking if ID matches pending query...');
                    console.error('[MCP] Response ID: "' + msg.id + '", hasPending: ' + pendingQueries.has(msg.id));
                    if (pendingQueries.has(msg.id)) {
                        const handler = pendingQueries.get(msg.id);
                        if (handler) {
                            console.error('[MCP] ✓ Found handler, resolving with content length=' + (msg.content?.length || 0));
                            handler(msg.content);
                            pendingQueries.delete(msg.id);
                            console.error('[MCP] ✓ Handler called, pending query removed');
                        }
                        else {
                            console.error('[MCP] !!! Handler was undefined');
                        }
                    }
                    else {
                        console.error('[MCP] !!! No pending query for this ID');
                    }
                }
                else {
                    console.error('[MCP] Ignoring non-response message type: ' + msg.type);
                }
            }
            catch (parseErr) {
                console.error('[MCP] !!! Parse error: ' + parseErr.message);
            }
        });
        hubSocket.on('error', (err) => {
            console.error('[MCP] Socket error:', err.message);
        });
        hubSocket.on('close', () => {
            console.error('[MCP] Disconnected from hub, reconnecting in 2s...');
            hubSocket = null;
            // Auto-reconnect after 2 seconds
            reconnectTimer = setTimeout(connectToHub, 2000);
        });
    }
    catch (err) {
        console.error('[MCP] Failed to connect:', err.message);
        // Retry connection after 2 seconds
        reconnectTimer = setTimeout(connectToHub, 2000);
    }
}
// Create the MCP server
const server = new index_js_1.Server({ name: 'claude-team', version: '1.0.0' }, { capabilities: { tools: {} } });
// Define available tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'ask_team_claude',
            description: 'Ask another Claude instance working in a different VS Code window a question. Use this to coordinate work, ask about architecture decisions, request code reviews, or get information about other parts of the project.',
            inputSchema: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to ask the other Claude instance'
                    },
                    target_window: {
                        type: 'string',
                        description: 'Optional: specific window name to ask. Leave empty to broadcast to all.'
                    },
                    context: {
                        type: 'string',
                        description: 'Optional: additional context about why you\'re asking'
                    }
                },
                required: ['question']
            }
        },
        {
            name: 'share_with_team',
            description: 'Share information, decisions, or context with other Claude instances on the team.',
            inputSchema: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: 'The information to share with the team'
                    },
                    category: {
                        type: 'string',
                        enum: ['decision', 'blocker', 'update', 'api_change', 'heads_up'],
                        description: 'Category of the message'
                    }
                },
                required: ['message', 'category']
            }
        },
        {
            name: 'get_team_status',
            description: 'Get the current status of all connected Claude instances - what they\'re working on, their project context, etc.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        },
        {
            name: 'request_code_review',
            description: 'Request a code review from another Claude instance',
            inputSchema: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'The code to review'
                    },
                    focus_areas: {
                        type: 'string',
                        description: 'What aspects to focus the review on'
                    }
                },
                required: ['code']
            }
        }
    ]
}));
// Handle tool calls
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const typedArgs = args;
    switch (name) {
        case 'ask_team_claude': {
            const queryId = `mcp-${Date.now()}`;
            console.error('[MCP] ask_team_claude called, queryId=' + queryId);
            console.error('[MCP] Question: ' + typedArgs.question?.substring(0, 100));
            console.error('[MCP] Target window: ' + (typedArgs.target_window || 'ALL'));
            return new Promise((resolve) => {
                // Set up response handler
                console.error('[MCP] Setting up response handler for ' + queryId);
                pendingQueries.set(queryId, (response) => {
                    console.error('[MCP] Response handler triggered for ' + queryId);
                    resolve({
                        content: [{ type: 'text', text: response }]
                    });
                });
                console.error('[MCP] Pending queries after set: [' + Array.from(pendingQueries.keys()).join(', ') + ']');
                // Send query to hub
                if (hubSocket && hubSocket.readyState === ws_1.default.OPEN) {
                    const queryMsg = {
                        id: queryId,
                        fromWindow: 'claude-code-mcp',
                        toWindow: typedArgs.target_window || undefined,
                        type: 'query',
                        content: typedArgs.question,
                        timestamp: Date.now(),
                        metadata: { context: typedArgs.context }
                    };
                    console.error('[MCP] >>> Sending query to hub: ' + JSON.stringify(queryMsg).substring(0, 150));
                    hubSocket.send(JSON.stringify(queryMsg));
                    console.error('[MCP] >>> Query sent, waiting for response...');
                }
                else {
                    console.error('[MCP] !!! Hub not connected, socket state=' + (hubSocket?.readyState ?? 'null'));
                    resolve({
                        content: [{
                                type: 'text',
                                text: 'Hub not connected. Make sure VS Code with Claude Team extension is running.'
                            }]
                    });
                    return;
                }
                // Timeout after 60 seconds
                setTimeout(() => {
                    if (pendingQueries.has(queryId)) {
                        console.error('[MCP] !!! Timeout for query ' + queryId);
                        console.error('[MCP] Pending queries at timeout: [' + Array.from(pendingQueries.keys()).join(', ') + ']');
                        pendingQueries.delete(queryId);
                        resolve({
                            content: [{
                                    type: 'text',
                                    text: 'No response received from team. They may be busy or offline.'
                                }]
                        });
                    }
                }, 60000);
            });
        }
        case 'share_with_team': {
            if (hubSocket && hubSocket.readyState === ws_1.default.OPEN) {
                const category = (typedArgs.category || 'update').toString().toUpperCase();
                hubSocket.send(JSON.stringify({
                    id: `share-${Date.now()}`,
                    fromWindow: 'claude-code-mcp',
                    type: 'broadcast',
                    content: `[${category}] ${typedArgs.message}`,
                    timestamp: Date.now()
                }));
            }
            return {
                content: [{ type: 'text', text: 'Message shared with team.' }]
            };
        }
        case 'get_team_status': {
            // Request status from hub
            return new Promise((resolve) => {
                const statusId = `status-${Date.now()}`;
                pendingQueries.set(statusId, (response) => {
                    resolve({
                        content: [{ type: 'text', text: response }]
                    });
                });
                if (hubSocket && hubSocket.readyState === ws_1.default.OPEN) {
                    hubSocket.send(JSON.stringify({
                        id: statusId,
                        fromWindow: 'claude-code-mcp',
                        type: 'status_request',
                        timestamp: Date.now()
                    }));
                }
                else {
                    resolve({
                        content: [{ type: 'text', text: 'Hub not connected.' }]
                    });
                    return;
                }
                setTimeout(() => {
                    if (pendingQueries.has(statusId)) {
                        pendingQueries.delete(statusId);
                        resolve({
                            content: [{ type: 'text', text: 'Could not retrieve team status.' }]
                        });
                    }
                }, 5000);
            });
        }
        case 'request_code_review': {
            const focusAreas = typedArgs.focus_areas ? ` focusing on: ${typedArgs.focus_areas}` : '';
            const reviewQuery = `Please review this code${focusAreas}:\n\n\`\`\`\n${typedArgs.code}\n\`\`\``;
            // Reuse ask_team_claude logic
            const queryId = `review-${Date.now()}`;
            return new Promise((resolve) => {
                pendingQueries.set(queryId, (response) => {
                    resolve({
                        content: [{ type: 'text', text: response }]
                    });
                });
                if (hubSocket && hubSocket.readyState === ws_1.default.OPEN) {
                    hubSocket.send(JSON.stringify({
                        id: queryId,
                        fromWindow: 'claude-code-mcp',
                        type: 'query',
                        content: reviewQuery,
                        timestamp: Date.now()
                    }));
                }
                else {
                    resolve({
                        content: [{
                                type: 'text',
                                text: 'Hub not connected. Make sure VS Code with Claude Team extension is running.'
                            }]
                    });
                    return;
                }
                setTimeout(() => {
                    if (pendingQueries.has(queryId)) {
                        pendingQueries.delete(queryId);
                        resolve({
                            content: [{ type: 'text', text: 'No review response received.' }]
                        });
                    }
                }, 120000);
            });
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});
// Start the server
async function main() {
    connectToHub();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('Claude Team MCP server running');
}
main().catch(console.error);
//# sourceMappingURL=claude-team-mcp-server.js.map