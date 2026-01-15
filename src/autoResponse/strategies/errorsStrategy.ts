// errorsStrategy.ts - Strategy for error and diagnostic queries

import * as vscode from 'vscode';
import * as path from 'path';
import { TeamContext } from '../../types';
import { QueryIntent } from '../queryClassifier';
import { BaseStrategy, ResponseQuery } from '../responseStrategy';

/**
 * Strategy for handling error and diagnostic queries
 * Handles: ERROR_HELP
 */
export class ErrorsStrategy extends BaseStrategy {
  readonly name = 'errors';
  readonly description = 'Provides error diagnostics and troubleshooting context';
  readonly priority = 80;
  readonly supportedIntents = [QueryIntent.ERROR_HELP];

  async generate(query: ResponseQuery, context: TeamContext): Promise<string> {
    const diagnostics = this.gatherDiagnostics();
    const queryLower = query.content.toLowerCase();

    let response = this.formatHeader(context);
    response += `### Error Analysis\n\n`;

    // Check if query mentions specific error
    const errorInQuery = this.extractErrorFromQuery(query.content);

    if (errorInQuery) {
      response += `**Your Reported Error:**\n\`\`\`\n${errorInQuery}\n\`\`\`\n\n`;

      // Try to find matching diagnostics
      const matches = this.findMatchingDiagnostics(errorInQuery, diagnostics);
      if (matches.length > 0) {
        response += `**Matching Issues Found (${matches.length}):**\n\n`;
        matches.forEach(({ uri, diagnostic }) => {
          const filename = path.basename(uri.fsPath);
          response += `📍 **${filename}:${diagnostic.range.start.line + 1}**\n`;
          response += `   ${diagnostic.message}\n`;
          response += `   Severity: ${this.severityToString(diagnostic.severity)}\n\n`;
        });
      } else {
        response += `_No exact matches found in current diagnostics._\n\n`;
      }
    }

    // List current workspace errors
    const errors = diagnostics.filter(d => d.diagnostic.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diagnostics.filter(d => d.diagnostic.severity === vscode.DiagnosticSeverity.Warning);

    if (errors.length > 0) {
      response += `**Current Errors (${errors.length}):**\n\n`;
      errors.slice(0, 10).forEach(({ uri, diagnostic }) => {
        const filename = path.basename(uri.fsPath);
        response += `❌ **${filename}:${diagnostic.range.start.line + 1}**\n`;
        response += `   ${diagnostic.message.substring(0, 150)}\n`;
        if (diagnostic.source) {
          response += `   Source: ${diagnostic.source}\n`;
        }
        response += '\n';
      });

      if (errors.length > 10) {
        response += `_...and ${errors.length - 10} more errors_\n\n`;
      }
    } else {
      response += `✅ **No errors in current workspace**\n\n`;
    }

    if (warnings.length > 0 && queryLower.includes('warning')) {
      response += `**Warnings (${warnings.length}):**\n`;
      warnings.slice(0, 5).forEach(({ uri, diagnostic }) => {
        const filename = path.basename(uri.fsPath);
        response += `⚠️ ${filename}:${diagnostic.range.start.line + 1} - ${diagnostic.message.substring(0, 80)}\n`;
      });
      response += '\n';
    }

    // Add suggestions based on common error patterns
    const suggestions = this.generateSuggestions(errors, query.content);
    if (suggestions.length > 0) {
      response += `**Suggestions:**\n`;
      suggestions.forEach(s => {
        response += `- ${s}\n`;
      });
      response += '\n';
    }

    response += `_Diagnostics captured at ${this.formatTimestamp()}_`;
    return response;
  }

  estimateResponseTime(): number {
    return 100; // Fast - only reads VS Code diagnostics
  }

  private gatherDiagnostics(): { uri: vscode.Uri; diagnostic: vscode.Diagnostic }[] {
    const results: { uri: vscode.Uri; diagnostic: vscode.Diagnostic }[] = [];
    const allDiagnostics = vscode.languages.getDiagnostics();

    for (const [uri, diagnostics] of allDiagnostics) {
      for (const diagnostic of diagnostics) {
        results.push({ uri, diagnostic });
      }
    }

    // Sort by severity (errors first)
    results.sort((a, b) => (a.diagnostic.severity || 0) - (b.diagnostic.severity || 0));

    return results;
  }

  private extractErrorFromQuery(query: string): string | null {
    // Look for code blocks with errors
    const codeBlockMatch = query.match(/```[\s\S]*?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[0].replace(/```/g, '').trim();
    }

    // Look for error patterns
    const errorPatterns = [
      /error[:\s]+(.+?)(?:\n|$)/i,
      /exception[:\s]+(.+?)(?:\n|$)/i,
      /failed[:\s]+(.+?)(?:\n|$)/i,
      /cannot\s+(.+?)(?:\n|$)/i,
      /unable\s+to\s+(.+?)(?:\n|$)/i,
    ];

    for (const pattern of errorPatterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  private findMatchingDiagnostics(
    errorText: string,
    diagnostics: { uri: vscode.Uri; diagnostic: vscode.Diagnostic }[]
  ): { uri: vscode.Uri; diagnostic: vscode.Diagnostic }[] {
    const errorLower = errorText.toLowerCase();
    const keywords = errorLower.split(/\s+/).filter(w => w.length > 3);

    return diagnostics.filter(({ diagnostic }) => {
      const msgLower = diagnostic.message.toLowerCase();

      // Direct substring match
      if (msgLower.includes(errorLower.substring(0, 50))) {
        return true;
      }

      // Keyword matching
      const matchCount = keywords.filter(kw => msgLower.includes(kw)).length;
      return matchCount >= Math.min(3, keywords.length / 2);
    });
  }

  private severityToString(severity: vscode.DiagnosticSeverity | undefined): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'Error';
      case vscode.DiagnosticSeverity.Warning:
        return 'Warning';
      case vscode.DiagnosticSeverity.Information:
        return 'Info';
      case vscode.DiagnosticSeverity.Hint:
        return 'Hint';
      default:
        return 'Unknown';
    }
  }

  private generateSuggestions(
    errors: { uri: vscode.Uri; diagnostic: vscode.Diagnostic }[],
    query: string
  ): string[] {
    const suggestions: string[] = [];
    const errorMessages = errors.map(e => e.diagnostic.message.toLowerCase()).join(' ');

    // Type errors
    if (errorMessages.includes('type') || errorMessages.includes('typescript')) {
      suggestions.push('Run `npm run build` or `tsc` to see full type errors');
    }

    // Import errors
    if (errorMessages.includes('import') || errorMessages.includes('module not found')) {
      suggestions.push('Check that all dependencies are installed with `npm install`');
      suggestions.push('Verify import paths are correct');
    }

    // Missing property errors
    if (errorMessages.includes('property') && errorMessages.includes('does not exist')) {
      suggestions.push('Check interface definitions for missing properties');
    }

    // Syntax errors
    if (errorMessages.includes('syntax') || errorMessages.includes('unexpected token')) {
      suggestions.push('Check for missing brackets, parentheses, or semicolons');
    }

    // If query mentions specific technologies
    if (query.toLowerCase().includes('react')) {
      suggestions.push('Ensure React components follow JSX rules');
    }

    return suggestions.slice(0, 4);
  }
}
