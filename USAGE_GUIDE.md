# Claude Team - Complete Usage Guide

## Table of Contents
1. [Startup](#startup)
2. [Basic Utilization](#basic-utilization)
3. [Moderated Use](#moderated-use)
4. [Advanced Use](#advanced-use)

---

## Startup

### Prerequisites
- VS Code with Claude Team extension installed
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18+

### Step 1: First Window (Becomes Hub)

1. Open VS Code in your first project
2. The extension activates automatically via `onStartupFinished`
3. Check the **Output** panel → select **"Claude Team"** from dropdown
4. You should see:
   ```
   ========== INIT START ==========
   [CONNECT] Trying ws://localhost:4847...
   [HUB] Starting...
   [HUB] STARTED on 4847
   ========== INIT COMPLETE ==========
   ```
5. Status bar shows: `Claude Team: hub`

### Step 2: Additional Windows (Connect as Clients)

1. Open another VS Code window in a different project
2. Extension activates and connects to existing hub
3. Logs show:
   ```
   ========== INIT START ==========
   [CONNECT] Trying ws://localhost:4847...
   [CONNECT] SUCCESS
   ========== INIT COMPLETE ==========
   ```
4. Status bar shows: `Claude Team: connected`

### Step 3: Verify MCP Connection

In either window, Claude Code can now use the team tools:
```
get_team_status
```
Should return list of connected windows.

### Troubleshooting Startup

| Symptom | Cause | Solution |
|---------|-------|----------|
| "Claude Team" not in Output | Extension not activated | Reload window (Cmd+Shift+P → "Reload Window") |
| Port conflict on 4847 | Another service using port | Change port in Settings → `claudeTeam.hubPort` |
| Windows not seeing each other | Hub not running | Check first window's Output log for errors |

---

## Basic Utilization

### Tool 1: `get_team_status`
**Purpose**: See who's connected

**Usage**: Simply invoke:
```
get_team_status
```

**Output Example**:
```
Connected windows:
- my-frontend (/Users/you/projects/frontend)
- my-backend (/Users/you/projects/backend)
```

**When to use**:
- Starting a session to see who's available
- Verifying all relevant projects are connected
- Before sending targeted messages

---

### Tool 2: `share_with_team`
**Purpose**: Broadcast information to all team members

**Parameters**:
- `message` (required): The information to share
- `category` (required): One of `decision`, `blocker`, `update`, `api_change`, `heads_up`

**Usage Example**:
```
share_with_team(
  message: "Refactored the auth module - now exports AuthService instead of auth functions",
  category: "api_change"
)
```

**Categories Explained**:

| Category | Use For |
|----------|---------|
| `decision` | Architecture choices, technology selections |
| `blocker` | Issues preventing progress that others should know |
| `update` | General progress updates |
| `api_change` | Interface changes that affect other codebases |
| `heads_up` | Warnings about upcoming changes |

---

### Tool 3: `ask_team_claude`
**Purpose**: Ask another Claude instance a question

**Parameters**:
- `question` (required): What you want to know
- `target_window` (optional): Specific window to ask
- `context` (optional): Additional context to include

**Usage Example**:
```
ask_team_claude(
  question: "What authentication method is the backend using?",
  target_window: "my-backend"
)
```

**Notes**:
- If no `target_window`, broadcasts to all
- Other window needs Claude Code running to respond
- Enable auto-respond in settings for automatic replies

---

### Tool 4: `request_code_review`
**Purpose**: Get code reviewed by another Claude instance

**Parameters**:
- `code` (required): The code to review
- `focus_areas` (optional): What to focus on

**Usage Example**:
```
request_code_review(
  code: "function validateUser(user) { return user.id && user.email; }",
  focus_areas: "Security, edge cases, type safety"
)
```

---

## Moderated Use

### Scenario 1: Coordinating API Changes

**Frontend window discovers backend API change needed**:

```
# Frontend Claude shares the need
share_with_team(
  message: "Need new endpoint POST /api/users/preferences for user settings feature",
  category: "api_change"
)

# Then asks backend for timeline
ask_team_claude(
  question: "Can you add POST /api/users/preferences endpoint? What's the expected request/response format you'd prefer?",
  target_window: "backend-service"
)
```

### Scenario 2: Debugging Across Services

**Frontend seeing errors from backend**:

```
# Share the blocker
share_with_team(
  message: "Getting 500 errors on /api/auth/refresh - started after recent deploy",
  category: "blocker"
)

# Ask for help
ask_team_claude(
  question: "I'm getting 500 errors on /api/auth/refresh. The request payload is {refreshToken: string}. Can you check the handler and recent changes?",
  context: "Error response: {error: 'Internal server error', trace: 'AuthService.refresh:45'}"
)
```

### Scenario 3: Sharing Decisions

**After making architecture decision**:

```
share_with_team(
  message: "Decision: Using React Query for server state instead of Redux. This means all API calls should go through useQuery/useMutation hooks.",
  category: "decision"
)
```

### Scenario 4: Pre-Merge Review

**Before merging cross-cutting changes**:

```
request_code_review(
  code: "<paste your code here>",
  focus_areas: "Integration with backend types, breaking changes, error handling"
)
```

---

## Advanced Use

### Multi-Service Development Workflow

#### Setup (3 terminals/windows):
1. **API Gateway** (`/projects/gateway`) - Routes and auth
2. **User Service** (`/projects/user-service`) - User management
3. **Frontend** (`/projects/web-app`) - React frontend

#### Coordinated Feature Development:

**Step 1: Frontend initiates feature**
```
share_with_team(
  message: "Starting work on user profile page. Will need: GET /users/:id, PATCH /users/:id",
  category: "update"
)
```

**Step 2: Ask for interface specs**
```
ask_team_claude(
  question: "What's the current User type definition? I need to build the profile form.",
  target_window: "user-service"
)
```

**Step 3: Gateway shares routing info**
```
share_with_team(
  message: "User routes are at /api/v2/users/*. Auth required via Bearer token. Rate limit: 100/min",
  category: "heads_up"
)
```

**Step 4: Cross-service code review**
```
request_code_review(
  code: "// Your new API client code",
  focus_areas: "Does this match the actual backend contract? Error handling correct?"
)
```

### Custom Window Names

For clearer team status, set custom window names:

**Settings** → `claudeTeam.windowName`:
```json
{
  "claudeTeam.windowName": "frontend-team"
}
```

Now `get_team_status` shows:
```
Connected windows:
- frontend-team (/Users/you/frontend)
- backend-team (/Users/you/backend)
```

### Auto-Response Configuration

Enable automatic query handling:

**Settings** → `claudeTeam.autoRespond`: `true`

With auto-respond enabled:
- Simple queries (status, context) answered automatically
- Complex queries still shown for review
- Useful for background coordination

### Shared Memory (Experimental)

Set team-wide key-value state:

**VS Code Command Palette** → `Claude Team: Set Shared Memory`
- Key: `api-version`
- Value: `v2`

Other windows can read this shared state for coordination.

### Monitoring Communication

**View all messages**: Command Palette → `Claude Team: Show Communication Log`

**View connected windows**: Command Palette → `Claude Team: Show Connected Windows`

### VS Code Commands Reference

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Claude Team: Send Query` | - | Send question to team |
| `Claude Team: Assign Task` | - | Delegate work item |
| `Claude Team: Broadcast Context` | - | Share workspace state |
| `Claude Team: Share Selection` | - | Share selected code |
| `Claude Team: Show Windows` | - | View connected windows |
| `Claude Team: Show Log` | - | View message history |
| `Claude Team: Set Memory` | - | Set shared state |
| `Claude Team: Request Help` | - | Broadcast help request |

---

## Test Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Hub startup | Working | First window becomes hub on port 4847 |
| Client connection | Working | Subsequent windows connect automatically |
| `get_team_status` | Working | Returns all connected windows |
| `share_with_team` | Working | Broadcasts to all windows |
| `ask_team_claude` | Partial | Needs Claude CLI in receiving window |
| `request_code_review` | Partial | Needs Claude CLI in receiving window |
| Auto-respond | Config | Enable in settings |
| Shared memory | Working | Via VS Code commands |

---

## Architecture Summary

```
                    VS Code Window 1 (HUB)
                    ┌─────────────────────┐
                    │  Extension (4847)   │
                    │  ┌───────────────┐  │
                    │  │  WebSocket    │  │
                    │  │  Server       │  │
                    │  └───────┬───────┘  │
                    └──────────┼──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ VS Code Win 2 │    │ VS Code Win 3 │    │  MCP Server   │
│   (Client)    │    │   (Client)    │    │ (Claude CLI)  │
└───────────────┘    └───────────────┘    └───────────────┘
```

The MCP server bridges Claude Code CLI to the hub, enabling Claude-to-Claude communication.
