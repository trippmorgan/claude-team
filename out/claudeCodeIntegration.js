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
exports.AutoResponder = exports.TeamQueryTemplates = exports.ClaudeCodeBridge = void 0;
// claudeCodeIntegration.ts - Deep integration with Claude Code
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
class ClaudeCodeBridge {
    outputChannel;
    onResponse;
    pendingQueries = new Map();
    claudeProcess = null;
    outputBuffer = '';
    constructor(outputChannel, onResponse) {
        this.outputChannel = outputChannel;
        this.onResponse = onResponse;
    }
    /**
     * Execute a query using Claude Code CLI
     * This runs claude code in non-interactive mode with the query
     */
    async executeQuery(query) {
        return new Promise((resolve, reject) => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                reject(new Error('No workspace folder open'));
                return;
            }
            // Build context-aware prompt
            const contextualPrompt = this.buildContextualPrompt(query);
            this.outputChannel.appendLine(`\n[Claude Bridge] Processing query: ${query.query.substring(0, 100)}...`);
            // Spawn Claude Code process
            const claudePath = vscode.workspace.getConfiguration('claudeTeam').get('claudePath') || 'claude';
            const claude = (0, child_process_1.spawn)(claudePath, [
                '-p', contextualPrompt // Print mode: respond and exit
            ], {
                cwd: workspaceRoot,
                env: {
                    ...process.env,
                    CLAUDE_TEAM_MODE: 'true',
                    CLAUDE_TEAM_QUERY_ID: query.id,
                    CLAUDE_TEAM_FROM: query.fromWindow
                }
            });
            let output = '';
            let error = '';
            claude.stdout?.on('data', (data) => {
                output += data.toString();
            });
            claude.stderr?.on('data', (data) => {
                error += data.toString();
            });
            claude.on('close', (code) => {
                if (code === 0 || (code !== 0 && output.trim().length > 0)) {
                    this.outputChannel.appendLine(`[Claude Bridge] Response received (${output.length} chars)`);
                    const result = output.trim();
                    if (query.callback)
                        query.callback(result);
                    if (this.onResponse)
                        this.onResponse(query.id, result);
                    resolve(result);
                }
                else {
                    this.outputChannel.appendLine(`[Claude Bridge] Error: ${error}`);
                    reject(new Error(error || 'Claude process failed'));
                }
            });
            claude.on('error', (err) => {
                reject(err);
            });
            // Timeout after 2 minutes
            setTimeout(() => {
                claude.kill();
                reject(new Error('Query timed out'));
            }, 120000);
        });
    }
    /**
     * Build a context-aware prompt that includes relevant workspace info
     */
    buildContextualPrompt(query) {
        const context = this.gatherContext();
        return `
[TEAM COLLABORATION QUERY]
From: ${query.fromWindow}
Query ID: ${query.id}

[YOUR CURRENT CONTEXT]
Project: ${context.projectName}
Current File: ${context.currentFile || 'None'}
Git Branch: ${context.gitBranch || 'Unknown'}
Recent Files: ${context.recentFiles.slice(0, 5).join(', ')}

[THE QUERY]
${query.query}

${query.context ? `[ADDITIONAL CONTEXT FROM REQUESTER]\n${query.context}` : ''}

Please provide a helpful response that the other Claude instance can use. Be specific and include code examples if relevant.
`.trim();
    }
    /**
     * Gather current workspace context
     */
    gatherContext() {
        const editor = vscode.window.activeTextEditor;
        const diagnostics = vscode.languages.getDiagnostics();
        // Get open problems/errors
        const problems = [];
        diagnostics.forEach(([uri, diags]) => {
            problems.push(...diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error));
        });
        return {
            windowId: '', // Set by caller
            projectName: vscode.workspace.name || 'Unknown',
            currentFile: editor?.document.fileName
                ? path.basename(editor.document.fileName)
                : undefined,
            recentFiles: this.getRecentFiles(),
            gitBranch: this.getGitBranch(),
            openProblems: problems.slice(0, 10)
        };
    }
    getRecentFiles() {
        // Get recently opened files from VS Code
        const tabs = vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .filter(t => t.input instanceof vscode.TabInputText)
            .map(t => t.input.uri.fsPath)
            .map(p => path.basename(p));
        return [...new Set(tabs)].slice(0, 10);
    }
    getGitBranch() {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension?.isActive) {
                const git = gitExtension.exports.getAPI(1);
                const repo = git.repositories[0];
                return repo?.state?.HEAD?.name;
            }
        }
        catch {
            // Git not available
        }
        return undefined;
    }
    /**
     * Create a shareable context summary for other windows
     */
    createContextSummary() {
        const ctx = this.gatherContext();
        const editor = vscode.window.activeTextEditor;
        let summary = `
## Window Context: ${ctx.projectName}

**Current Focus:** ${ctx.currentFile || 'No file open'}
**Git Branch:** ${ctx.gitBranch || 'Not in git repo'}

**Recent Files:**
${ctx.recentFiles.map(f => `- ${f}`).join('\n')}
`;
        // Add current selection if any
        if (editor?.selection && !editor.selection.isEmpty) {
            const selectedText = editor.document.getText(editor.selection);
            if (selectedText.length < 500) {
                summary += `\n**Selected Code:**\n\`\`\`\n${selectedText}\n\`\`\`\n`;
            }
        }
        // Add open problems
        if (ctx.openProblems.length > 0) {
            summary += `\n**Open Errors (${ctx.openProblems.length}):**\n`;
            ctx.openProblems.slice(0, 3).forEach(p => {
                summary += `- ${p.message}\n`;
            });
        }
        return summary;
    }
}
exports.ClaudeCodeBridge = ClaudeCodeBridge;
/**
 * Specialized queries for common team collaboration scenarios
 */
class TeamQueryTemplates {
    static architectureQuestion(component) {
        return `I'm working on a component that needs to interact with ${component}. 
What architecture pattern are you using? Can you share the interface or API structure?`;
    }
    static codeReviewRequest(code) {
        return `Can you review this code from your perspective? 
Looking for potential issues with how it might integrate with your part of the system:

\`\`\`
${code}
\`\`\``;
    }
    static dependencyCheck(dependency) {
        return `Are you using ${dependency} in your project? 
If so, what version and are there any gotchas I should know about?`;
    }
    static interfaceRequest(interfaceName) {
        return `Can you share the current interface/type definition for ${interfaceName}? 
I need to ensure my implementation matches your expectations.`;
    }
    static bugHelp(errorMessage) {
        return `I'm seeing this error and wondering if it might be related to your component:

${errorMessage}

Have you seen anything similar? Any ideas what might cause this?`;
    }
    static syncRequest() {
        return `Can you give me a quick status update?
- What are you currently working on?
- Any breaking changes I should know about?
- Anything blocked or needing my attention?`;
    }
}
exports.TeamQueryTemplates = TeamQueryTemplates;
/**
 * Auto-responder that can handle queries without user intervention
 */
class AutoResponder {
    bridge;
    constructor(bridge) {
        this.bridge = bridge;
    }
    async shouldAutoRespond(query) {
        // Simple heuristics for auto-response
        const autoRespondPatterns = [
            /what (version|interface|type)/i,
            /share.*context/i,
            /status update/i,
            /are you using/i,
            /what.*pattern/i
        ];
        return autoRespondPatterns.some(p => p.test(query));
    }
    async generateAutoResponse(query) {
        // For simple queries, respond with context
        const context = this.bridge.createContextSummary();
        if (/status/i.test(query.query)) {
            return `Here's my current status:\n${context}`;
        }
        if (/context/i.test(query.query)) {
            return context;
        }
        // For complex queries, use Claude
        return this.bridge.executeQuery(query);
    }
}
exports.AutoResponder = AutoResponder;
//# sourceMappingURL=claudeCodeIntegration.js.map