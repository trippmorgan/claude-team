// claudeCodeIntegration.ts - Deep integration with Claude Code
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface ClaudeQuery {
  id: string;
  query: string;
  context?: string;
  fromWindow: string;
  callback?: (response: string) => void;
}

export interface TeamContext {
  windowId: string;
  projectName: string;
  currentFile?: string;
  recentFiles: string[];
  gitBranch?: string;
  openProblems: vscode.Diagnostic[];
}

export class ClaudeCodeBridge {
  private pendingQueries: Map<string, ClaudeQuery> = new Map();
  private claudeProcess: ChildProcess | null = null;
  private outputBuffer: string = '';

  constructor(
    private outputChannel: vscode.OutputChannel,
    private onResponse?: (queryId: string, response: string) => void
  ) {}

  /**
   * Execute a query using Claude Code CLI
   * This runs claude code in non-interactive mode with the query
   */
  async executeQuery(query: ClaudeQuery): Promise<string> {
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
      const claudePath = vscode.workspace.getConfiguration('claudeTeam').get<string>('claudePath') || 'claude';
      const claude = spawn(claudePath, [
        '-p', contextualPrompt  // Print mode: respond and exit
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
          if (query.callback) query.callback(result);
          if (this.onResponse) this.onResponse(query.id, result);
          resolve(result);
        } else {
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
  private buildContextualPrompt(query: ClaudeQuery): string {
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
  gatherContext(): TeamContext {
    const editor = vscode.window.activeTextEditor;
    const diagnostics = vscode.languages.getDiagnostics();
    
    // Get open problems/errors
    const problems: vscode.Diagnostic[] = [];
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

  private getRecentFiles(): string[] {
    // Get recently opened files from VS Code
    const tabs = vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .filter(t => t.input instanceof vscode.TabInputText)
      .map(t => (t.input as vscode.TabInputText).uri.fsPath)
      .map(p => path.basename(p));
    
    return [...new Set(tabs)].slice(0, 10);
  }

  private getGitBranch(): string | undefined {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (gitExtension?.isActive) {
        const git = (gitExtension.exports as any).getAPI(1);
        const repo = git.repositories[0];
        return repo?.state?.HEAD?.name;
      }
    } catch {
      // Git not available
    }
    return undefined;
  }

  /**
   * Create a shareable context summary for other windows
   */
  createContextSummary(): string {
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

/**
 * Specialized queries for common team collaboration scenarios
 */
export class TeamQueryTemplates {
  
  static architectureQuestion(component: string): string {
    return `I'm working on a component that needs to interact with ${component}. 
What architecture pattern are you using? Can you share the interface or API structure?`;
  }

  static codeReviewRequest(code: string): string {
    return `Can you review this code from your perspective? 
Looking for potential issues with how it might integrate with your part of the system:

\`\`\`
${code}
\`\`\``;
  }

  static dependencyCheck(dependency: string): string {
    return `Are you using ${dependency} in your project? 
If so, what version and are there any gotchas I should know about?`;
  }

  static interfaceRequest(interfaceName: string): string {
    return `Can you share the current interface/type definition for ${interfaceName}? 
I need to ensure my implementation matches your expectations.`;
  }

  static bugHelp(errorMessage: string): string {
    return `I'm seeing this error and wondering if it might be related to your component:

${errorMessage}

Have you seen anything similar? Any ideas what might cause this?`;
  }

  static syncRequest(): string {
    return `Can you give me a quick status update?
- What are you currently working on?
- Any breaking changes I should know about?
- Anything blocked or needing my attention?`;
  }
}

/**
 * Auto-responder that can handle queries without user intervention
 */
export class AutoResponder {
  constructor(
    private bridge: ClaudeCodeBridge
  ) {}

  async shouldAutoRespond(query: string): Promise<boolean> {
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

  async generateAutoResponse(query: ClaudeQuery): Promise<string> {
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
