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
exports.SharedContextManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const TEAM_DIR = '.claude-team';
class SharedContextManager {
    teamDir;
    watcher = null;
    constructor(workspaceRoot) {
        this.teamDir = path.join(workspaceRoot, TEAM_DIR);
        this.ensureTeamDir();
    }
    ensureTeamDir() {
        if (!fs.existsSync(this.teamDir)) {
            fs.mkdirSync(this.teamDir, { recursive: true });
            // Create .gitignore for team dir
            fs.writeFileSync(path.join(this.teamDir, '.gitignore'), '*\n!.gitignore\n');
        }
    }
    /**
     * Write a query that other windows can see
     * Claude Code can read this when you tell it to!
     */
    async postQuery(fromWindow, query) {
        const id = `query-${Date.now()}`;
        const message = {
            id,
            from: fromWindow,
            timestamp: Date.now(),
            type: 'query',
            content: query,
            status: 'pending'
        };
        const filePath = path.join(this.teamDir, `${id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
        // Also update the inbox file that's easy for Claude Code to read
        this.updateInbox();
        return id;
    }
    /**
     * Creates a human-readable inbox file
     * You can tell Claude Code: "Read .claude-team/INBOX.md and respond to queries"
     */
    updateInbox() {
        const files = fs.readdirSync(this.teamDir)
            .filter(f => f.startsWith('query-') && f.endsWith('.json'));
        let inbox = `# Claude Team Inbox\n\n`;
        inbox += `*Last updated: ${new Date().toISOString()}*\n\n`;
        for (const file of files) {
            const msg = JSON.parse(fs.readFileSync(path.join(this.teamDir, file), 'utf-8'));
            if (msg.status === 'pending') {
                inbox += `## Query from ${msg.from}\n`;
                inbox += `**ID:** ${msg.id}\n`;
                inbox += `**Time:** ${new Date(msg.timestamp).toLocaleString()}\n\n`;
                inbox += `${msg.content}\n\n`;
                inbox += `---\n\n`;
            }
        }
        inbox += `\n## How to Respond\n`;
        inbox += `Create a file named \`response-{query-id}.md\` with your answer.\n`;
        fs.writeFileSync(path.join(this.teamDir, 'INBOX.md'), inbox);
    }
    /**
     * Share your current context for other windows
     */
    shareContext(windowName, context) {
        const contextFile = path.join(this.teamDir, `context-${windowName}.md`);
        fs.writeFileSync(contextFile, context);
        // Update the team overview
        this.updateTeamOverview();
    }
    updateTeamOverview() {
        const contextFiles = fs.readdirSync(this.teamDir)
            .filter(f => f.startsWith('context-') && f.endsWith('.md'));
        let overview = `# Team Overview\n\n`;
        overview += `*Use this to understand what other Claude instances are working on*\n\n`;
        for (const file of contextFiles) {
            const windowName = file.replace('context-', '').replace('.md', '');
            const content = fs.readFileSync(path.join(this.teamDir, file), 'utf-8');
            overview += `## ${windowName}\n\n${content}\n\n---\n\n`;
        }
        fs.writeFileSync(path.join(this.teamDir, 'TEAM_OVERVIEW.md'), overview);
    }
    /**
     * Watch for responses from other windows
     */
    watchForResponses(callback) {
        this.watcher = fs.watch(this.teamDir, (event, filename) => {
            if (filename?.startsWith('response-') && filename.endsWith('.md')) {
                const content = fs.readFileSync(path.join(this.teamDir, filename), 'utf-8');
                const queryId = filename.replace('response-', '').replace('.md', '');
                callback({
                    id: queryId,
                    from: 'other-window',
                    timestamp: Date.now(),
                    type: 'response',
                    content,
                    status: 'answered'
                });
            }
        });
    }
    dispose() {
        this.watcher?.close();
    }
}
exports.SharedContextManager = SharedContextManager;
// USAGE WITH CLAUDE CODE:
// 
// In Window 1, the extension posts a query to .claude-team/INBOX.md
// 
// In Window 2, you tell Claude Code:
// "Hey Claude, check .claude-team/INBOX.md for any queries from the team 
//  and respond by creating response files"
//
// Claude Code reads the inbox, sees the query, and creates a response file
// 
// Window 1's extension detects the response file and shows it to you
//# sourceMappingURL=sharedContextApproach.js.map