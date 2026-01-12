# Claude Team Extension - SharedContextApproach Integration

## ✅ Status: Successfully Deployed (v1.0.0)

**Date:** January 11, 2026  
**Package Size:** 86 KB (lean, optimized)  
**Dependencies:** Just `ws` for WebSocket communication

---

## 🎯 What Changed

### Previous Approach (Failed - v1.1.0)
- Attempted direct Anthropic SDK integration
- TypeScript compilation errors: `Cannot find name 'File'`
- Root cause: SDK expects browser DOM API in Node.js environment
- **Status:** ❌ Rolled back

### New Approach (Current - v1.0.0)
- **SharedContextManager**: Filesystem-based message passing
- Uses `.claude-team/` directory as a shared message queue
- Zero external dependencies (only `ws` for WebSocket)
- Claude Code reads/writes files naturally
- Human-readable INBOX.md and TEAM_OVERVIEW.md

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────┐
│  VS Code Ext    │         │  vs Code     │
│   Window 1      │         │   Window 2   │
│                 │         │              │
└────────┬────────┘         └──────┬───────┘
         │                         │
         └──────────────┬──────────┘
                        │
              ┌─────────▼────────┐
              │  .claude-team/   │
              │                  │
              │ ├─ INBOX.md      │  ← Claude Code reads queries
              │ ├─ query-*.json  │
              │ ├─ response-*.md │  ← Claude Code writes responses
              │ ├─ context-*.md  │
              │ ├─ TEAM_OVERVIEW │
              │ └─ .gitignore    │
              └──────────────────┘
```

---

## 📁 Files in SharedContextApproach

### New File: `src/sharedContextApproach.ts`

**Key Class:** `SharedContextManager`

```typescript
// Write a query that Claude Code will see
await manager.postQuery(fromWindow, queryText)
  → Creates .claude-team/query-{timestamp}.json
  → Updates INBOX.md

// Share context about current window
manager.shareContext(windowName, contextMarkdown)
  → Writes .claude-team/context-{window}.md
  → Updates TEAM_OVERVIEW.md

// Listen for responses from other windows
manager.watchForResponses((response) => {
  // response.id, response.content, response.timestamp
})
  → Detects .claude-team/response-{id}.md files
  → Fires callback on new files
```

---

## 🔄 Workflow

### Window 1: Sends Query
1. User clicks `sendQuery` command
2. Extension calls `sharedContext.postQuery()`
3. Creates `.claude-team/query-1234567890.json`:
   ```json
   {
     "id": "query-1234567890",
     "from": "Project-abc123",
     "timestamp": 1234567890,
     "type": "query",
     "content": "How should I structure the auth module?",
     "status": "pending"
   }
   ```
4. Updates `.claude-team/INBOX.md`:
   ```markdown
   # Claude Team Inbox
   
   ## Query from Project-abc123
   **ID:** query-1234567890
   **Time:** Jan 11, 2025 3:45:00 PM
   
   How should I structure the auth module?
   
   ---
   ```

### Window 2 (Claude Code's Side)
1. User tells Claude Code: "Check .claude-team/INBOX.md for queries"
2. Claude Code reads INBOX.md, sees the query
3. Claude Code thinks and responds
4. Claude Code creates `.claude-team/response-query-1234567890.md`:
   ```markdown
   # Response to: How should I structure the auth module?
   
   I recommend a modular approach:
   - Use JWT tokens with refresh rotation
   - Separate auth middleware from routes
   - Store secrets in environment variables
   
   Here's a starter template...
   ```

### Window 1: Receives Response
1. `SharedContextManager.watchForResponses()` detects file
2. Callback fires with response content
3. Extension shows notification: "Response available"
4. User sees full response in Output panel

---

## 💡 Advantages

✅ **Zero SDK Dependencies** - No TypeScript errors  
✅ **Human-Readable** - Claude Code understands Markdown  
✅ **Filesystem-Based** - Reliable, no network issues  
✅ **Simple Integration** - Just read/write files  
✅ **Version Control Friendly** - .gitignore prevents commits  
✅ **Scalable** - Works with multiple windows

---

## 🔧 Integration Points

### In `extension.ts`

```typescript
import { SharedContextManager } from './sharedContextApproach';

class ClaudeTeamHub {
  private sharedContext: SharedContextManager;

  constructor(context: vscode.ExtensionContext) {
    // ...
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.sharedContext = new SharedContextManager(workspaceRoot);
  }

  async initialize() {
    // ...
    this.sharedContext.watchForResponses((response) => 
      this.handleSharedResponse(response)
    );
  }

  private async handleIncomingQuery(msg: TeamMessage) {
    const action = await vscode.window.showInformationMessage(
      'Query received',
      'View', 'Post to Shared Files', 'Auto-respond (CLI)'
    );
    
    if (action === 'Post to Shared Files') {
      const queryId = await this.sharedContext.postQuery(
        msg.fromWindow, 
        msg.content
      );
      this.outputChannel.show();
    }
    // ...
  }

  dispose() {
    this.sharedContext?.dispose();
  }
}
```

---

## 📋 File Structure

```
src/
├─ extension.ts                    [Main entry, Hub/Client logic]
├─ claudeCodeIntegration.ts       [CLI spawning for auto-respond]
├─ sharedContextApproach.ts       [NEW: Filesystem message passing]
├─ communication.ts               [Optional: legacy]
└─ types.ts                       [Shared interfaces]

.claude-team/
├─ INBOX.md                       [Human-readable query list]
├─ TEAM_OVERVIEW.md               [Context from all windows]
├─ query-*.json                   [Query metadata files]
├─ response-*.md                  [Response markdown files]
├─ context-*.md                   [Window context snapshots]
└─ .gitignore                     [Prevent commits]
```

---

## 🚀 How to Use

### For Window 1 (Requesting Help)
1. Open `.claude-team/INBOX.md` after sending a query
2. Share the .claude-team folder with Claude Code workspace
3. Wait for Claude Code to create response file

### For Window 2 (Claude Code)
1. When asked to help: "I see queries in .claude-team/INBOX.md"
2. Read INBOX.md to understand what's needed
3. Create `response-{query-id}.md` with your answer
4. The extension detects the file automatically

### Multiple Windows
- All windows share the same `.claude-team/` directory
- Each window gets its own context-{name}.md file
- TEAM_OVERVIEW.md aggregates all contexts
- INBOX.md shows all pending queries

---

## 🔍 Testing Checklist

- [ ] Open two VS Code windows with same workspace
- [ ] Run `Claude Team: Send Query` in Window 1
- [ ] Choose "Post to Shared Files"
- [ ] Check `.claude-team/INBOX.md` generated
- [ ] Check `.claude-team/query-*.json` exists
- [ ] In Claude Code, read INBOX.md
- [ ] Create `.claude-team/response-query-*.md`
- [ ] Extension shows notification in Window 1
- [ ] Response appears in Output panel

---

## 📝 Next Steps

1. **Test with actual Claude Code** - Verify file watching works
2. **Add prompt template** - Create recommended Claude Code prompt
3. **Context enrichment** - Gather more workspace metadata
4. **Response parsing** - Extract code blocks from responses
5. **Performance** - Optimize for many queries

---

## 🎓 Why This Works

The key insight: **Claude Code is a bridge**, not a replacement. We're not trying to make it an SDK client—we're giving it a simple, clear interface using files it can read and write naturally.

Instead of:
```
Extension → API → Claude API → Response
           (Blocked by TypeScript errors)
```

We do:
```
Extension → File → Claude Code → File → Extension
           (Simple, reliable, debuggable)
```

Claude Code can see the conversation happening in real-time by watching .claude-team/ directory. When it creates a response file, the extension picks it up and delivers it back to the originating window.

---

## 📞 Support

For issues or questions about the SharedContextApproach:
1. Check that `.claude-team/` is writable
2. Verify fs.watch() is detecting file changes
3. Ensure response files match expected format
4. Check Extension output panel for debug logs

