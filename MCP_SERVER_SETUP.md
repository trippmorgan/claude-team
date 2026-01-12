# Claude Team MCP Server Setup

## Overview

The Claude Team extension now includes an **MCP (Model Context Protocol) server** that allows Claude Code instances to directly communicate with the team hub using native Claude Code tools.

## Quick Start

### 1. Install the Extension

Install `claude-team-1.0.0.vsix` in your VS Code window.

### 2. Configure Claude Code

**Option A: Use CLI command (Recommended)**

```bash
claude mcp add --transport stdio claude-team -- node /path/to/claude-team/out/claude-team-mcp-server.js
```

**Option B: Create `.mcp.json` in your project root**

```json
{
  "mcpServers": {
    "claude-team": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-team/out/claude-team-mcp-server.js"],
      "env": {
        "TEAM_HUB_PORT": "3847"
      }
    }
  }
}
```

**Option C: Add to `~/.claude.json` for user-wide access**

```json
{
  "mcpServers": {
    "claude-team": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-team/out/claude-team-mcp-server.js"]
    }
  }
}
```

> **Note:** Project-scoped `.mcp.json` servers require one-time approval on first use.

### 3. Start Using Team Tools

Once configured, Claude Code will have access to these tools:

#### `ask_team_claude`
Ask another Claude instance a question:

```
Use the ask_team_claude tool to ask Window 2 about database schema design:
{
  "question": "What's the optimal schema for storing user preferences?",
  "target_window": "window-2",
  "context": "Designing preference system for user profile"
}
```

#### `share_with_team`
Broadcast decisions and updates:

```
{
  "message": "Decided to use PostgreSQL for user data with Redis cache layer",
  "category": "decision"
}
```

#### `get_team_status`
Check what other Claude instances are working on:

```
get_team_status() returns:
- Window 1: Working on API authentication
- Window 2: Building database schema
- Window 3: Frontend components
```

#### `request_code_review`
Ask team for code review:

```
{
  "code": "function handleUserAuth() { ... }",
  "focus_areas": "Security, error handling, performance"
}
```

## Architecture

```
Claude Code Instance 1          Claude Code Instance 2
         |                              |
    MCP Client                    MCP Client
         |                              |
    stdio transport              stdio transport
         |                              |
    ┌────────────────────────────────────┐
    │   MCP Server (this extension)      │
    │  - ask_team_claude                 │
    │  - share_with_team                 │
    │  - get_team_status                 │
    │  - request_code_review             │
    └────────────────────┬───────────────┘
                         |
                    WebSocket
                         |
          VS Code Hub (extension.ts)
                         |
          ┌──────────────┴──────────────┐
          |                             |
    VS Code Window 1            VS Code Window 2
    (Extension Host)            (Extension Host)
```

## How It Works

1. **Claude Code starts** → MCP server initializes via stdio
2. **MCP server connects** → Connects to VS Code Hub at `ws://localhost:3847`
3. **Claude uses tools** → Sends queries through MCP server to hub
4. **Hub routes messages** → Delivers to target window or broadcasts
5. **Responses flow back** → Via WebSocket to MCP server → to Claude Code

## Advantages Over File-Based System

| Feature | Files | MCP Server |
|---------|-------|-----------|
| Speed | Polling-based | Real-time |
| Reliability | File watching varies | Guaranteed delivery |
| Complexity | Simple | Native protocol |
| Integration | Manual | Native Claude Code tools |
| IDE Support | External | First-class |

## Troubleshooting

### "Hub not connected" error

**Cause:** VS Code extension not running or hub on wrong port

**Fix:**
1. Ensure Claude Team extension is activated in VS Code
2. Check VS Code output channel: "Claude Team" 
3. Verify hub port: `claudeTeam.hubPort` setting (default: 3847)

### Tool calls timeout after 60 seconds

**Cause:** Other Claude instance not responding

**Fix:**
1. Check if target window is still running
2. Look at VS Code output channels to see if queries are being received
3. Try broadcasting to all: omit `target_window` parameter

### MCP server won't start

**Cause:** Node.js executable not found or path incorrect

**Fix:**
```bash
# Verify Node.js location
which node

# Update config with full path
node /usr/local/bin/node /path/to/mcp-server.js
```

## Configuration

Add to Claude Code config or environment:

```bash
# Set hub port if different from 3847
export CLAUDE_TEAM_HUB_PORT=3847

# Enable debug logging
export CLAUDE_TEAM_DEBUG=true
```

## File Paths

- **MCP Server**: `/out/claude-team-mcp-server.js`
- **Hub**: VS Code extension (built-in)
- **Communication**: WebSocket on localhost:3847
- **Shared Files**: `.claude-team/` directory (fallback)

## Next Steps

1. **Install extension** in both VS Code windows
2. **Configure MCP server path** in Claude Code settings
3. **Test connectivity**: Ask one Claude instance about the other
4. **Set preferences**: Update `claudeTeam.*` settings as needed
5. **Start building**: Use team tools to coordinate complex tasks

## Full Example Session

```
Window 1 (Frontend Claude):
"I need to know the API endpoints for user management"

↓ ask_team_claude tool ↓

Window 2 (Backend Claude):
"Here are the endpoints:
- POST /api/users (create)
- GET /api/users/:id (read)
- PATCH /api/users/:id (update)
- DELETE /api/users/:id (delete)"

↓ Response back to Claude Code ↓

Window 1 (Frontend Claude):
"Thanks! I'll implement the forms using these endpoints."
[share_with_team with category: "update"]

↓ Broadcast message ↓

Both Windows see: "[UPDATE] Frontend forms being implemented for user management"
```

---

**Version**: 1.0.0  
**Last Updated**: January 2026  
**Status**: Production Ready
