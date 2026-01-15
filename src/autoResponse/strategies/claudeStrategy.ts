// claudeStrategy.ts - Strategy for complex queries requiring Claude CLI

import { TeamContext } from '../../types';
import { QueryIntent } from '../queryClassifier';
import { BaseStrategy, ResponseQuery } from '../responseStrategy';
import { ClaudeCodeBridge, ClaudeQuery } from '../../claudeCodeIntegration';

/**
 * Strategy for handling complex queries that require Claude CLI
 * Handles: REVIEW_REQUEST, HELP_REQUEST, TASK_DELEGATION, GENERAL_QUESTION, UNKNOWN
 * This is the fallback strategy for queries that can't be handled by simpler strategies
 */
export class ClaudeStrategy extends BaseStrategy {
  readonly name = 'claude';
  readonly description = 'Uses Claude CLI for complex queries requiring AI reasoning';
  readonly priority = 10; // Low priority - fallback strategy
  readonly supportedIntents = [
    QueryIntent.REVIEW_REQUEST,
    QueryIntent.HELP_REQUEST,
    QueryIntent.TASK_DELEGATION,
    QueryIntent.GENERAL_QUESTION,
    QueryIntent.UNKNOWN
  ];

  constructor(private bridge: ClaudeCodeBridge) {
    super();
  }

  /**
   * Override canHandle to always accept if no other strategy matched
   */
  canHandle(_query: ResponseQuery, _context: TeamContext): boolean {
    // Claude strategy is the fallback - always can handle
    return true;
  }

  async generate(query: ResponseQuery, context: TeamContext): Promise<string> {
    const intent = query.classification.intent;

    // Build appropriate prompt based on intent
    const claudeQuery: ClaudeQuery = {
      id: query.id,
      query: this.buildPromptForIntent(query, context, intent),
      fromWindow: query.fromWindow,
      context: query.additionalContext
    };

    try {
      const response = await this.bridge.executeQuery(claudeQuery);
      return this.formatClaudeResponse(response, query, context);
    } catch (error) {
      return this.handleClaudeError(error, query, context);
    }
  }

  estimateResponseTime(): number {
    return 30000; // Claude CLI can take up to 30 seconds
  }

  private buildPromptForIntent(
    query: ResponseQuery,
    context: TeamContext,
    intent: QueryIntent
  ): string {
    const baseContext = `
[TEAM COLLABORATION CONTEXT]
From: ${query.fromWindowName || query.fromWindow}
Project: ${context.projectName}
Current File: ${context.currentFile || 'None'}
Branch: ${context.gitBranch || 'Unknown'}
`;

    switch (intent) {
      case QueryIntent.REVIEW_REQUEST:
        return `${baseContext}

[CODE REVIEW REQUEST]
Another team member has asked for a code review. Please provide constructive feedback.

Their request:
${query.content}

Please:
1. Analyze the code for correctness, efficiency, and style
2. Point out any potential issues or bugs
3. Suggest improvements if applicable
4. Consider how this code might integrate with the broader system`;

      case QueryIntent.HELP_REQUEST:
        return `${baseContext}

[HELP REQUEST]
A team member is asking for assistance. Please provide helpful guidance.

Their question:
${query.content}

Please provide a clear, actionable response that helps them move forward.`;

      case QueryIntent.TASK_DELEGATION:
        return `${baseContext}

[TASK REQUEST]
A team member has delegated a task. Please acknowledge and provide your approach.

Task:
${query.content}

Please:
1. Confirm understanding of the task
2. Outline your planned approach
3. Identify any questions or clarifications needed
4. Note any dependencies or prerequisites`;

      case QueryIntent.GENERAL_QUESTION:
        return `${baseContext}

[TEAM QUESTION]
A team member has a question about the project or codebase.

Question:
${query.content}

Please provide a helpful response based on your current context and knowledge of the project.`;

      default:
        return `${baseContext}

[TEAM QUERY]
${query.content}

Please provide a helpful response.`;
    }
  }

  private formatClaudeResponse(
    response: string,
    query: ResponseQuery,
    context: TeamContext
  ): string {
    let formatted = `## Response from ${context.projectName}\n\n`;

    // Add intent indicator
    const intentLabel = this.getIntentLabel(query.classification.intent);
    if (intentLabel) {
      formatted += `*${intentLabel}*\n\n`;
    }

    formatted += response;

    formatted += `\n\n---\n_Response generated via Claude CLI at ${this.formatTimestamp()}_`;

    return formatted;
  }

  private handleClaudeError(
    error: unknown,
    query: ResponseQuery,
    context: TeamContext
  ): string {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    let response = this.formatHeader(context);
    response += `### Unable to Process Query\n\n`;
    response += `I encountered an error while processing your request using Claude CLI.\n\n`;
    response += `**Error:** ${errorMessage}\n\n`;

    // Provide helpful context even on error
    response += `**However, here's my current context:**\n`;
    response += `- Project: ${context.projectName}\n`;
    response += `- Current File: ${context.currentFile || 'None'}\n`;
    response += `- Branch: ${context.gitBranch || 'Unknown'}\n\n`;

    if (errorMessage.includes('timeout')) {
      response += `_The query may have been too complex. Try breaking it into smaller questions._\n`;
    } else if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
      response += `_Claude CLI may not be installed or configured. Check your claudeTeam.claudePath setting._\n`;
    }

    response += `\n**Your Query:** ${query.content.substring(0, 200)}...\n`;
    response += `\n_Please try again or rephrase your query._`;

    return response;
  }

  private getIntentLabel(intent: QueryIntent): string | null {
    const labels: Partial<Record<QueryIntent, string>> = {
      [QueryIntent.REVIEW_REQUEST]: '📝 Code Review Response',
      [QueryIntent.HELP_REQUEST]: '💡 Help Response',
      [QueryIntent.TASK_DELEGATION]: '✅ Task Acknowledgment',
      [QueryIntent.GENERAL_QUESTION]: '❓ Question Response'
    };
    return labels[intent] || null;
  }
}
