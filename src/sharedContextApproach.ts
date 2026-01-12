// sharedContextApproach.ts - Create shared files Claude Code can read
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const TEAM_DIR = '.claude-team';

interface TeamMessage {
  id: string;
  from: string;
  timestamp: number;
  type: 'query' | 'response' | 'context';
  content: string;
  status: 'pending' | 'answered';
}

export class SharedContextManager {
  private teamDir: string;
  private watcher: fs.FSWatcher | null = null;

  constructor(workspaceRoot: string) {
    this.teamDir = path.join(workspaceRoot, TEAM_DIR);
    this.ensureTeamDir();
  }

  private ensureTeamDir() {
    if (!fs.existsSync(this.teamDir)) {
      fs.mkdirSync(this.teamDir, { recursive: true });
      
      // Create .gitignore for team dir
      fs.writeFileSync(
        path.join(this.teamDir, '.gitignore'),
        '*\n!.gitignore\n'
      );
    }
  }

  /**
   * Write a query that other windows can see
   * Claude Code can read this when you tell it to!
   */
  async postQuery(fromWindow: string, query: string): Promise<string> {
    const id = `query-${Date.now()}`;
    const message: TeamMessage = {
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
  private updateInbox() {
    const files = fs.readdirSync(this.teamDir)
      .filter(f => f.startsWith('query-') && f.endsWith('.json'));
    
    let inbox = `# Claude Team Inbox\n\n`;
    inbox += `*Last updated: ${new Date().toISOString()}*\n\n`;

    for (const file of files) {
      const msg: TeamMessage = JSON.parse(
        fs.readFileSync(path.join(this.teamDir, file), 'utf-8')
      );
      
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
  shareContext(windowName: string, context: string) {
    const contextFile = path.join(this.teamDir, `context-${windowName}.md`);
    fs.writeFileSync(contextFile, context);
    
    // Update the team overview
    this.updateTeamOverview();
  }

  private updateTeamOverview() {
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
  watchForResponses(callback: (response: TeamMessage) => void) {
    this.watcher = fs.watch(this.teamDir, (event, filename) => {
      if (filename?.startsWith('response-') && filename.endsWith('.md')) {
        const content = fs.readFileSync(
          path.join(this.teamDir, filename), 
          'utf-8'
        );
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
