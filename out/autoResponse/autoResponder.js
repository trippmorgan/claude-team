"use strict";
// autoResponder.ts - Improved AutoResponder that coordinates all strategies
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImprovedAutoResponder = void 0;
const queryClassifier_1 = require("./queryClassifier");
const responseStrategy_1 = require("./responseStrategy");
const contextStrategy_1 = require("./strategies/contextStrategy");
const errorsStrategy_1 = require("./strategies/errorsStrategy");
const codeStrategy_1 = require("./strategies/codeStrategy");
const claudeStrategy_1 = require("./strategies/claudeStrategy");
/**
 * Improved AutoResponder that uses strategy pattern and query classification
 */
class ImprovedAutoResponder {
    bridge;
    classifier;
    manager;
    config;
    outputChannel;
    constructor(bridge, outputChannel, config) {
        this.bridge = bridge;
        this.outputChannel = outputChannel;
        this.classifier = new queryClassifier_1.QueryClassifier();
        this.manager = new responseStrategy_1.AutoResponseManager();
        // Default configuration
        this.config = {
            enabled: true,
            mode: 'smart',
            claudeTimeout: 120000,
            logClassifications: true,
            requireApprovalFor: [queryClassifier_1.QueryIntent.TASK_DELEGATION],
            ...config
        };
        // Register strategies
        this.initializeStrategies();
    }
    /**
     * Initialize and register all response strategies
     */
    initializeStrategies() {
        // Register strategies in priority order (highest first)
        this.manager.register(new contextStrategy_1.ContextStrategy());
        this.manager.register(new errorsStrategy_1.ErrorsStrategy());
        this.manager.register(new codeStrategy_1.CodeStrategy());
        this.manager.register(new claudeStrategy_1.ClaudeStrategy(this.bridge));
        this.log('Strategies registered: ' +
            this.manager.getStrategies().map(s => s.name).join(', '));
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.log('Configuration updated');
    }
    /**
     * Check if auto-response is enabled
     */
    isEnabled() {
        return this.config.enabled && this.config.mode !== 'off';
    }
    /**
     * Determine if a query should be auto-responded to
     */
    shouldAutoRespond(query) {
        // Check if enabled
        if (!this.isEnabled()) {
            return {
                shouldRespond: false,
                requiresApproval: false,
                classification: { intent: queryClassifier_1.QueryIntent.UNKNOWN, confidence: 0 },
                reason: 'Auto-response is disabled'
            };
        }
        // Classify the query
        const classification = this.classifier.classify(query.content);
        if (this.config.logClassifications) {
            this.log(`Classification: intent=${classification.intent}, ` +
                `confidence=${classification.confidence.toFixed(2)}, ` +
                `strategy=${classification.suggestedStrategy}`);
        }
        // Check mode restrictions
        if (this.config.mode === 'context-only') {
            const isContextIntent = this.classifier.isInstantResponse(classification.intent);
            if (!isContextIntent) {
                return {
                    shouldRespond: false,
                    requiresApproval: false,
                    classification,
                    reason: 'Query requires more than context (mode is context-only)'
                };
            }
        }
        // Check if approval is required
        const requiresApproval = this.config.requireApprovalFor.includes(classification.intent);
        // Low confidence queries might need human review
        if (classification.confidence < 0.3) {
            return {
                shouldRespond: this.config.mode === 'full',
                requiresApproval: true,
                classification,
                reason: 'Low confidence classification'
            };
        }
        return {
            shouldRespond: true,
            requiresApproval,
            classification,
            reason: 'Query can be auto-responded'
        };
    }
    /**
     * Generate a response for a query
     */
    async generateResponse(query, context) {
        const classification = this.classifier.classify(query.content);
        const responseQuery = {
            id: query.id,
            content: query.content,
            fromWindow: query.fromWindow,
            fromWindowName: query.fromWindowName,
            classification,
            additionalContext: query.additionalContext
        };
        this.log(`Processing query: "${query.content.substring(0, 50)}..."`);
        this.log(`Intent: ${classification.intent} (${(classification.confidence * 100).toFixed(0)}%)`);
        const result = await this.manager.respond(responseQuery, context);
        this.log(`Response generated: strategy=${result.strategyUsed}, ` +
            `time=${result.processingTimeMs}ms, success=${result.success}`);
        return result;
    }
    /**
     * Process a query and return the response (convenience method)
     */
    async process(query, context) {
        const decision = this.shouldAutoRespond(query);
        if (!decision.shouldRespond) {
            this.log(`Not auto-responding: ${decision.reason}`);
            return null;
        }
        if (decision.requiresApproval) {
            this.log(`Query requires approval: ${decision.classification.intent}`);
            // Return null to indicate manual handling needed
            return null;
        }
        const result = await this.generateResponse(query, context);
        if (!result.success) {
            this.log(`Response failed: ${result.error}`);
        }
        return {
            response: result.response,
            wasAutomatic: result.wasAutomatic,
            strategy: result.strategyUsed,
            classification: decision.classification
        };
    }
    /**
     * Get the classifier for external use
     */
    getClassifier() {
        return this.classifier;
    }
    /**
     * Get the response manager for external use
     */
    getManager() {
        return this.manager;
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Log a message to the output channel
     */
    log(message) {
        this.outputChannel.appendLine(`[AutoResponder] ${message}`);
    }
    /**
     * Generate a quick context response (for simple status queries)
     */
    quickContextResponse(context) {
        let response = `## Status from ${context.projectName}\n\n`;
        response += `**Current File:** ${context.currentFile || 'None'}\n`;
        response += `**Branch:** ${context.gitBranch || 'Unknown'}\n`;
        response += `**Recent Files:** ${context.recentFiles.slice(0, 5).join(', ') || 'None'}\n`;
        if (context.openProblems.length > 0) {
            response += `**Open Errors:** ${context.openProblems.length}\n`;
        }
        response += `\n_Auto-generated at ${new Date().toISOString()}_`;
        return response;
    }
    /**
     * Classify a query without generating a response (useful for UI decisions)
     */
    classifyOnly(query) {
        return this.classifier.classify(query);
    }
}
exports.ImprovedAutoResponder = ImprovedAutoResponder;
//# sourceMappingURL=autoResponder.js.map