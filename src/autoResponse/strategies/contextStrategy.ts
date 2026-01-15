// contextStrategy.ts - Strategy for context and status queries

import * as vscode from 'vscode';
import { TeamContext } from '../../types';
import { QueryIntent } from '../queryClassifier';
import { BaseStrategy, ResponseQuery } from '../responseStrategy';

/**
 * Strategy for handling context-related queries
 * Handles: STATUS_CHECK, CONTEXT_REQUEST, SYNC_REQUEST, DEPENDENCY_CHECK
 */
export class ContextStrategy extends BaseStrategy {
  readonly name = 'context';
  readonly description = 'Provides workspace context and status information';
  readonly priority = 100; // High priority - fast responses
  readonly supportedIntents = [
    QueryIntent.STATUS_CHECK,
    QueryIntent.CONTEXT_REQUEST,
    QueryIntent.SYNC_REQUEST,
    QueryIntent.DEPENDENCY_CHECK
  ];

  async generate(query: ResponseQuery, context: TeamContext): Promise<string> {
    const intent = query.classification.intent;

    switch (intent) {
      case QueryIntent.STATUS_CHECK:
        return this.generateStatusResponse(query, context);
      case QueryIntent.CONTEXT_REQUEST:
        return this.generateContextResponse(query, context);
      case QueryIntent.SYNC_REQUEST:
        return this.generateSyncResponse(query, context);
      case QueryIntent.DEPENDENCY_CHECK:
        return this.generateDependencyResponse(query, context);
      default:
        return this.generateContextResponse(query, context);
    }
  }

  estimateResponseTime(): number {
    return 50; // Very fast - no external calls
  }

  private generateStatusResponse(_query: ResponseQuery, context: TeamContext): string {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.selection;
    const hasSelection = selection && !selection.isEmpty;

    let response = this.formatHeader(context);
    response += `### Current Status\n\n`;
    response += `**Working on:** ${context.currentFile || 'No file currently open'}\n`;
    response += `**Project:** ${context.projectName}\n`;
    response += `**Branch:** ${context.gitBranch || 'Not in a git repository'}\n\n`;

    if (hasSelection && editor) {
      const lineCount = selection.end.line - selection.start.line + 1;
      response += `**Currently editing:** Lines ${selection.start.line + 1}-${selection.end.line + 1} (${lineCount} lines selected)\n\n`;
    }

    if (context.openProblems.length > 0) {
      response += `**Open Issues:** ${context.openProblems.length} error(s) to address\n`;
    } else {
      response += `**Status:** No errors in current workspace\n`;
    }

    response += `\n_Auto-generated status at ${this.formatTimestamp()}_`;
    return response;
  }

  private generateContextResponse(_query: ResponseQuery, context: TeamContext): string {
    const editor = vscode.window.activeTextEditor;

    let response = this.formatHeader(context);
    response += `### Workspace Context\n\n`;
    response += `| Property | Value |\n`;
    response += `|----------|-------|\n`;
    response += `| Project | ${context.projectName} |\n`;
    response += `| Current File | ${context.currentFile || 'None'} |\n`;
    response += `| Git Branch | ${context.gitBranch || 'N/A'} |\n`;
    response += `| Open Errors | ${context.openProblems.length} |\n\n`;

    if (context.recentFiles.length > 0) {
      response += `**Recent Files:**\n`;
      context.recentFiles.slice(0, 8).forEach(f => {
        response += `- ${f}\n`;
      });
      response += '\n';
    }

    // Add current selection if relevant
    if (editor?.selection && !editor.selection.isEmpty) {
      const selectedText = editor.document.getText(editor.selection);
      if (selectedText.length < 800) {
        response += `**Currently Selected:**\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
      } else {
        response += `**Currently Selected:** ${selectedText.length} characters (too long to include)\n\n`;
      }
    }

    response += `_Context captured at ${this.formatTimestamp()}_`;
    return response;
  }

  private generateSyncResponse(_query: ResponseQuery, context: TeamContext): string {
    let response = this.formatHeader(context);
    response += `### Sync Update\n\n`;

    response += `**Current Focus:**\n`;
    response += `- File: ${context.currentFile || 'None'}\n`;
    response += `- Branch: ${context.gitBranch || 'Unknown'}\n\n`;

    if (context.recentFiles.length > 0) {
      response += `**Recently Touched Files:**\n`;
      context.recentFiles.slice(0, 5).forEach(f => {
        response += `- ${f}\n`;
      });
      response += '\n';
    }

    if (context.openProblems.length > 0) {
      response += `**Current Blockers (${context.openProblems.length}):**\n`;
      context.openProblems.slice(0, 3).forEach(p => {
        response += `- ${p.message.substring(0, 100)}\n`;
      });
      response += '\n';
    } else {
      response += `**Blockers:** None\n\n`;
    }

    response += `**Breaking Changes:** None to report\n\n`;
    response += `_Sync at ${this.formatTimestamp()}_`;
    return response;
  }

  private async generateDependencyResponse(query: ResponseQuery, context: TeamContext): Promise<string> {
    let response = this.formatHeader(context);
    response += `### Dependency Information\n\n`;

    // Try to extract dependency name from query
    const depMatch = query.content.match(/using\s+(\S+)|(?:library|package|framework)\s+(\S+)/i);
    const requestedDep = depMatch?.[1] || depMatch?.[2];

    // Try to read package.json
    const packageInfo = await this.getPackageInfo();

    if (packageInfo) {
      response += `**Project Dependencies:**\n\n`;

      if (requestedDep) {
        const version = packageInfo.dependencies?.[requestedDep] ||
          packageInfo.devDependencies?.[requestedDep];
        if (version) {
          response += `✅ **${requestedDep}:** ${version}\n\n`;
        } else {
          response += `❌ **${requestedDep}:** Not found in dependencies\n\n`;
        }
      }

      // List key dependencies
      const deps = Object.entries(packageInfo.dependencies || {}).slice(0, 10);
      if (deps.length > 0) {
        response += `**Main Dependencies:**\n`;
        deps.forEach(([name, version]) => {
          response += `- ${name}: ${version}\n`;
        });
        response += '\n';
      }

      const devDeps = Object.entries(packageInfo.devDependencies || {}).slice(0, 5);
      if (devDeps.length > 0) {
        response += `**Dev Dependencies (sample):**\n`;
        devDeps.forEach(([name, version]) => {
          response += `- ${name}: ${version}\n`;
        });
      }
    } else {
      response += `_Could not read package.json - dependency information unavailable_\n`;
    }

    response += `\n_Generated at ${this.formatTimestamp()}_`;
    return response;
  }

  private async getPackageInfo(): Promise<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceRoot) return null;

      const packageJsonUri = vscode.Uri.joinPath(workspaceRoot, 'package.json');
      const content = await vscode.workspace.fs.readFile(packageJsonUri);
      return JSON.parse(content.toString());
    } catch {
      return null;
    }
  }
}
