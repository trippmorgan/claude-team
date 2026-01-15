# Claude Team - Multi-Agent Collaboration System

Enable multiple Claude Code instances to talk to each other across VS Code windows.

---

## Quickstart

### 1. Install Extension
```bash
code --install-extension claude-team-1.0.0.vsix
```

### 2. Add MCP Server to Claude Code
```bash
claude mcp add --transport stdio claude-team -- node /Users/trippmorgan/claude-team/out/claude-team-mcp-server.js --scope user
```

### 3. Reload
Run `/mcp` in Claude Code or restart.

---

## Simple Commands

Once set up, you have these tools:

| Tool | What it does | Example |
|------|--------------|---------|
| `get_team_status` | See who's online | "Check team status" |
| `ask_team_claude` | Ask another Claude a question | "Ask the backend team about the API" |
| `share_with_team` | Broadcast an update | "Tell the team I finished the login feature" |
| `request_code_review` | Get code reviewed | "Review this function for bugs" |

### Quick Examples

**Ask a question:**
```
Use ask_team_claude to ask: "What database are you using?"
```

**Share an update:**
```
Use share_with_team to say: "Auth module complete" with category "update"
```

**Check who's connected:**
```
Use get_team_status
```

---

## System Status (Verified 2025-01-12)

| Component | Status | Verification |
|-----------|--------|--------------|
| Hub (WebSocket :4847) | **Working** | `lsof -i :4847` shows LISTEN |
| Client Connections | **Working** | Multiple VS Code windows connect |
| MCP Server Bridge | **Working** | Claude CLI tools functional |
| `get_team_status` | **Working** | Returns connected windows |
| `share_with_team` | **Working** | Broadcasts to all windows |
| `ask_team_claude` | **Working** | Auto-respond returns context |
| `request_code_review` | **Working** | Same mechanism as ask |
| Sidebar (Windows) | **Working** | TreeDataProvider registered |
| Sidebar (Messages) | **Working** | Last 50 messages displayed |

---

## Architecture

### System Topology

```
                                 ┌─────────────────────────────────────┐
                                 │     VS Code Window (HUB)            │
                                 │  ┌─────────────────────────────┐    │
                                 │  │  ClaudeTeamHub              │    │
                                 │  │  ├── WebSocketServer :4847  │    │
                                 │  │  ├── windows: Map<id,Window>│    │
                                 │  │  ├── pendingQuerySockets    │    │
                                 │  │  └── TreeDataProviders      │    │
                                 │  └─────────────────────────────┘    │
                                 └──────────────┬────────────────────-─┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
        ┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
        │ VS Code Client 1  │       │ VS Code Client 2  │       │   MCP Server      │
        │ (socket → hub)    │       │ (socket → hub)    │       │ (claude-code-mcp) │
        │                   │       │                   │       │                   │
        │ windowId:         │       │ windowId:         │       │ Bridges Claude    │
        │ "proj-a-x7k2"     │       │ "proj-b-m3n9"     │       │ CLI to WebSocket  │
        └───────────────────┘       └───────────────────┘       └───────────────────┘
```

### Message Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            QUERY LIFECYCLE                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Claude CLI invokes ask_team_claude                                       │
│     ↓                                                                        │
│  2. MCP Server creates query message:                                        │
│     { id: "mcp-{timestamp}", fromWindow: "claude-code-mcp",                  │
│       type: "query", content: "...", toWindow?: "target" }                   │
│     ↓                                                                        │
│  3. MCP sends via WebSocket to Hub                                           │
│     ↓                                                                        │
│  4. Hub handleHubMessage():                                                  │
│     a. Stores MCP socket in pendingQuerySockets[msg.id]                      │
│     b. If toWindow specified: route to target                                │
│     c. Else: broadcast to all + handle locally                               │
│     ↓                                                                        │
│  5. Hub/Client handleIncomingQuery():                                        │
│     a. Check autoRespond setting (default: true)                             │
│     b. Generate context response via generateContextResponse()               │
│     c. Call sendResponse(queryId, fromWindow, response)                      │
│     ↓                                                                        │
│  6. Response routed back:                                                    │
│     a. Hub looks up pendingQuerySockets[msg.id]                              │
│     b. Sends response JSON to original MCP socket                            │
│     c. Removes from pending                                                  │
│     ↓                                                                        │
│  7. MCP Server receives response, resolves Promise                           │
│     ↓                                                                        │
│  8. Claude CLI displays result                                               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Structures

```typescript
interface TeamMessage {
  id: string;                    // Unique: "{windowId}-{timestamp}" or "mcp-{timestamp}"
  fromWindow: string;            // Source window ID
  toWindow?: string;             // Target (undefined = broadcast)
  type: 'query' | 'response' | 'status' | 'broadcast' | 'status_request' | 'windowList';
  content: string;               // Message payload
  timestamp: number;             // Unix timestamp
  metadata?: {
    projectContext?: string;     // Workspace path
    priority?: 'low' | 'normal' | 'high';
    expectsResponse?: boolean;
  };
}

interface ClaudeWindow {
  id: string;                    // "{workspaceName}-{randomSuffix}"
  name: string;                  // Workspace name
  projectPath: string;           // Filesystem path
  status: 'idle' | 'thinking' | 'busy';
  capabilities: string[];
  socket?: WebSocket;            // Only on hub, undefined for hub's own entry
}
```

---

## Known Limitations

### 1. Window Targeting by Name vs ID (HIGH)

**Issue:** `target_window` parameter uses workspace name (e.g., "claude-team") but the registry uses full IDs (e.g., "claude-team-x7k2").

**Current Behavior:** Targeting fails silently, falls back to local handling.

**Workaround:** Use broadcast (no target) or get exact ID from `get_team_status`.

### 2. Duplicate Window Entries (MEDIUM)

**Issue:** `get_team_status` may show duplicate entries.

**Cause:** Multiple MCP server instances connect when multiple Claude CLI sessions are active.

**Impact:** Cosmetic - functionality unaffected.

### 3. Hub Self-Routing (MEDIUM)

**Issue:** When hub window is the target, `socket` is undefined (hub doesn't connect to itself).

**Current Behavior:** Falls back to local handling, which works correctly.

### 4. First-Response Wins (LOW)

**Issue:** On broadcast queries, the first response received is returned to MCP.

**Impact:** Other windows' responses are logged but discarded.

### 5. No Response Aggregation (LOW)

**Issue:** Cannot collect responses from multiple windows into a single result.

**Workaround:** Query windows individually using `target_window`.

### 6. Extension Update Deployment

**Issue:** `npm run compile` outputs to `./out/` but VS Code loads from `~/.vscode/extensions/`.

**Solution:** After compile, copy files:
```bash
cp out/*.js ~/.vscode/extensions/trippmorgan.claude-team-1.0.0/out/
```

---

## Installation

### Prerequisites

- VS Code 1.85+
- Node.js 18+
- Claude Code CLI

### Setup

```bash
# 1. Clone and install
cd ~/claude-team
npm install

# 2. Compile
npm run compile

# 3. Install to VS Code extensions
cp -r . ~/.vscode/extensions/trippmorgan.claude-team-1.0.0/

# 4. Reload VS Code
```

### MCP Configuration

Create `.mcp.json` in each project root:

```json
{
  "mcpServers": {
    "claude-team": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/claude-team/out/claude-team-mcp-server.js"],
      "env": {
        "TEAM_HUB_PORT": "4847"
      }
    }
  }
}
```

---

## MCP Tools Reference

### get_team_status

Returns list of connected VS Code windows.

```
Parameters: None
Returns: Formatted list of windows with paths
```

### share_with_team

Broadcasts a message to all connected windows.

```
Parameters:
  - message: string (required) - Content to share
  - category: enum (required) - 'decision' | 'blocker' | 'update' | 'api_change' | 'heads_up'

Returns: Confirmation string
```

### ask_team_claude

Sends a query to team windows and waits for response.

```
Parameters:
  - question: string (required) - The query
  - target_window: string (optional) - Specific window ID (not workspace name)
  - context: string (optional) - Additional context

Returns: Context response from target window
Timeout: 60 seconds
```

### request_code_review

Requests code review from team.

```
Parameters:
  - code: string (required) - Code to review
  - focus_areas: string (optional) - Review focus

Returns: Context response with code echoed
Timeout: 120 seconds
```

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeTeam.hubPort` | number | 4847 | WebSocket hub port |
| `claudeTeam.autoRespond` | boolean | true | Auto-respond to queries |
| `claudeTeam.windowName` | string | "" | Custom window name |
| `claudeTeam.shareContext` | boolean | true | Include workspace context |
| `claudeTeam.preferredModel` | enum | "cli" | Response model |
| `claudeTeam.anthropicApiKey` | string | "" | API key for direct calls |

---

## Sidebar Views

### Connected Windows

Shows all connected VS Code windows with:
- Window name
- Project path
- Hub indicator (server icon)
- Client indicator (window icon)

### Recent Messages

Shows last 50 messages with:
- Timestamp
- Source window
- Message preview
- Type icon (question/check/broadcast)

---

## VS Code Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| Claude Team: Send Query | `Cmd+Shift+Q` | Query another window |
| Claude Team: Request Help | `Cmd+Shift+H` | Broadcast help request |
| Claude Team: Show Windows | - | List connected windows |
| Claude Team: Show Log | - | Open output panel |
| Claude Team: Share Context | - | Broadcast workspace state |

---

## Debugging

### Check Hub Status

```bash
# Verify hub is listening
lsof -i :4847

# Expected output:
# Code\x20H  PID  user  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME
# Code\x20H  123  user  59u IPv6  ...     0t0       TCP   *:4847 (LISTEN)
```

### Check MCP Processes

```bash
ps aux | grep claude-team-mcp
```

### View Extension Logs

1. VS Code: View → Output
2. Select "Claude Team" from dropdown
3. Look for:
   - `[HUB] STARTED on 4847` - Hub initialization
   - `[CONNECT] SUCCESS` - Client connection
   - `[QUERY] *** Processing` - Query received
   - `[RESPONSE] >>> Routing back` - Response sent

### Log Format Reference

```
╔══════════════════════════════════════════════════════════════
║ [HUB] INCOMING MESSAGE
║   type: query
║   from: claude-code-mcp
║   to: ALL
║   id: mcp-1234567890
╚══════════════════════════════════════════════════════════════
[HUB] Window registry (3):
  - scc-project-enhanced-x7k2 | socket=NO
  - claude-team-m3n9 | socket=YES(state=1)
  - claude-code-mcp | socket=YES(state=1)
[QUERY] *** Processing query id=mcp-1234567890
[QUERY] Stored MCP socket for response (pending=1)
[QUERY] Source is MCP, routing to windows...
[QUERY] >>> Handling LOCALLY on hub window
┌──────────────────────────────────────────────────────────────
│ [LOCAL] HANDLING QUERY LOCALLY
│   id: mcp-1234567890
│   from: claude-code-mcp
│   content: What project are you working on?
└──────────────────────────────────────────────────────────────
[LOCAL] autoRespond setting = true
[LOCAL] *** AUTO-RESPONDING ***
[LOCAL] Generated response (425 chars)
[SEND-RESPONSE] Sending response for query=mcp-1234567890 to=claude-code-mcp
[SEND-RESPONSE] I am hub, calling handleHubMessage directly
[RESPONSE] *** Processing response for id=mcp-1234567890
[RESPONSE] Pending query IDs: [mcp-1234567890]
[RESPONSE] Original socket found=true | state=1
[RESPONSE] >>> Routing back to MCP
[RESPONSE] Sent! Removed from pending.
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Sidebar empty | Extension not reloaded | Reload VS Code window |
| No response from ask | autoRespond disabled | Set `claudeTeam.autoRespond: true` |
| Timeout on queries | Hub not running | Check first VS Code window has hub |
| Duplicate windows | Multiple MCP connections | Cosmetic, ignore |
| Changes not taking effect | Extension cached | Copy to ~/.vscode/extensions/ |
| Target window fails | Using name not ID | Use broadcast or get exact ID |

---

## Development

```bash
# Watch mode
npm run watch

# Compile
npm run compile

# Deploy to VS Code
cp out/*.js ~/.vscode/extensions/trippmorgan.claude-team-1.0.0/out/

# Package for distribution
npx vsce package
```

---

## File Structure

```
claude-team/
├── src/
│   ├── extension.ts              # Main extension (Hub, TreeProviders)
│   ├── claude-team-mcp-server.ts # MCP server for Claude CLI
│   ├── claudeCodeIntegration.ts  # Context gathering
│   ├── sharedContextApproach.ts  # File-based context sharing
│   ├── communication.ts          # WebSocket utilities
│   └── types.ts                  # TypeScript definitions
├── out/                          # Compiled JavaScript
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
└── README.md                     # This file
```

---

## License

MIT
