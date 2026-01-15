"use strict";
// claudeStrategy.ts - Strategy for complex queries requiring Claude CLI
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeStrategy = void 0;
const queryClassifier_1 = require("../queryClassifier");
const responseStrategy_1 = require("../responseStrategy");
/**
 * Strategy for handling complex queries that require Claude CLI
 * Handles: REVIEW_REQUEST, HELP_REQUEST, TASK_DELEGATION, GENERAL_QUESTION, UNKNOWN
 * This is the fallback strategy for queries that can't be handled by simpler strategies
 */
class ClaudeStrategy extends responseStrategy_1.BaseStrategy {
    bridge;
    name = 'claude';
    description = 'Uses Claude CLI for complex queries requiring AI reasoning';
    priority = 10; // Low priority - fallback strategy
    supportedIntents = [
        queryClassifier_1.QueryIntent.REVIEW_REQUEST,
        queryClassifier_1.QueryIntent.HELP_REQUEST,
        queryClassifier_1.QueryIntent.TASK_DELEGATION,
        queryClassifier_1.QueryIntent.GENERAL_QUESTION,
        queryClassifier_1.QueryIntent.UNKNOWN
    ];
    constructor(bridge) {
        super();
        this.bridge = bridge;
    }
    /**
     * Override canHandle to always accept if no other strategy matched
     */
    canHandle(_query, _context) {
        // Claude strategy is the fallback - always can handle
        return true;
    }
    async generate(query, context) {
        const intent = query.classification.intent;
        // Build appropriate prompt based on intent
        const claudeQuery = {
            id: query.id,
            query: this.buildPromptForIntent(query, context, intent),
            fromWindow: query.fromWindow,
            context: query.additionalContext
        };
        try {
            const response = await this.bridge.executeQuery(claudeQuery);
            return this.formatClaudeResponse(response, query, context);
        }
        catch (error) {
            return this.handleClaudeError(error, query, context);
        }
    }
    estimateResponseTime() {
        return 30000; // Claude CLI can take up to 30 seconds
    }
    buildPromptForIntent(query, context, intent) {
        const baseContext = `
[TEAM COLLABORATION CONTEXT]
From: ${query.fromWindowName || query.fromWindow}
Project: ${context.projectName}
Current File: ${context.currentFile || 'None'}
Branch: ${context.gitBranch || 'Unknown'}
`;
        switch (intent) {
            case queryClassifier_1.QueryIntent.REVIEW_REQUEST:
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
            case queryClassifier_1.QueryIntent.HELP_REQUEST:
                return `${baseContext}

[HELP REQUEST]
A team member is asking for assistance. Please provide helpful guidance.

Their question:
${query.content}

Please provide a clear, actionable response that helps them move forward.`;
            case queryClassifier_1.QueryIntent.TASK_DELEGATION:
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
            case queryClassifier_1.QueryIntent.GENERAL_QUESTION:
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
    formatClaudeResponse(response, query, context) {
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
    handleClaudeError(error, query, context) {
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
        }
        else if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
            response += `_Claude CLI may not be installed or configured. Check your claudeTeam.claudePath setting._\n`;
        }
        response += `\n**Your Query:** ${query.content.substring(0, 200)}...\n`;
        response += `\n_Please try again or rephrase your query._`;
        return response;
    }
    getIntentLabel(intent) {
        const labels = {
            [queryClassifier_1.QueryIntent.REVIEW_REQUEST]: '📝 Code Review Response',
            [queryClassifier_1.QueryIntent.HELP_REQUEST]: '💡 Help Response',
            [queryClassifier_1.QueryIntent.TASK_DELEGATION]: '✅ Task Acknowledgment',
            [queryClassifier_1.QueryIntent.GENERAL_QUESTION]: '❓ Question Response'
        };
        return labels[intent] || null;
    }
}
exports.ClaudeStrategy = ClaudeStrategy;
//# sourceMappingURL=claudeStrategy.js.map