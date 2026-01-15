# Claude Team Setup & Communication Guide

## Quick Setup (2 minutes)

### Step 1: Register the MCP Server

```bash
claude mcp add --transport stdio claude-team -- node /Users/trippmorgan/claude-team/out/claude-team-mcp-server.js --scope user
```

### Step 2: Reload MCP

Run `/mcp` in Claude Code to reload, or restart Claude Code.

### Step 3: Verify Tools

You should have:
- `mcp__claude-team__ask_team_claude` - Ask questions
- `mcp__claude-team__share_with_team` - Share updates
- `mcp__claude-team__get_team_status` - Check who's online
- `mcp__claude-team__request_code_review` - Request reviews

---

## Communication Protocols

### Message Categories

When using `share_with_team`, use these categories:

| Category | When to Use |
|----------|-------------|
| `update` | Progress updates, completed tasks |
| `decision` | Architectural decisions, design choices |
| `blocker` | Something blocking progress, need help |
| `api_change` | Interface changes affecting other projects |
| `heads_up` | FYI notices, upcoming changes |

### Best Practices

**1. Announce when starting work:**
```
share_with_team: "Starting work on [feature/task]" (category: update)
```

**2. Share decisions that affect others:**
```
share_with_team: "Decided to use [approach] for [reason]" (category: decision)
```

**3. Ask before making breaking changes:**
```
ask_team_claude: "I'm planning to change [X], will this affect your project?"
```

**4. Request reviews for critical code:**
```
request_code_review: [paste code] (focus: "security" or "performance" or "architecture")
```

**5. Check status before asking questions:**
```
get_team_status - see who's online and what they're working on
```

---

## Team Conventions

### Naming
- Window names should be descriptive: `medical-mirror-observer`, `claude-team`, `api-service`
- Use kebab-case for consistency

### Response Expectations
- Queries should be answered promptly when possible
- If busy, share a brief "on it" or "will respond soon" update
- For complex questions, acknowledge receipt then follow up

### Handoffs
When handing off work between instances:
1. Share current state: what's done, what's pending
2. Point to relevant files/code
3. Note any blockers or decisions needed

---

## Troubleshooting

**"Connection refused":**
- Ensure VS Code with Claude Team extension is open
- First window becomes hub on port 3847

**Tools not appearing:**
- Run `/mcp` to reload
- Check `~/.claude.json` has the claude-team entry

**Messages not received:**
- Check VS Code Output > "Claude Team"
- Verify target window name matches exactly

**Hub port conflict:**
- Default is 3847
- Change in VS Code settings: `claudeTeam.hubPort`
- Update `TEAM_HUB_PORT` env in MCP config to match

---

## Manual Configuration (Alternative)

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "claude-team": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/trippmorgan/claude-team/out/claude-team-mcp-server.js"],
      "env": {
        "TEAM_HUB_PORT": "3847"
      }
    }
  }
}
```
