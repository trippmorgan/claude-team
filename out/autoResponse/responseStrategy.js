"use strict";
// responseStrategy.ts - Strategy pattern for response generation
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoResponseManager = exports.BaseStrategy = void 0;
/**
 * Abstract base class with common functionality
 */
class BaseStrategy {
    canHandle(query, _context) {
        return this.supportedIntents.includes(query.classification.intent);
    }
    estimateResponseTime() {
        return 100; // Default: 100ms
    }
    /**
     * Format a standard response header
     */
    formatHeader(context) {
        return `## Response from ${context.projectName}\n\n`;
    }
    /**
     * Format timestamp
     */
    formatTimestamp() {
        return new Date().toISOString();
    }
}
exports.BaseStrategy = BaseStrategy;
/**
 * Manager that coordinates multiple response strategies
 */
class AutoResponseManager {
    defaultStrategy;
    strategies = [];
    responseHistory = new Map();
    DEDUP_WINDOW_MS = 5000; // 5 second deduplication window
    constructor(defaultStrategy) {
        this.defaultStrategy = defaultStrategy;
    }
    /**
     * Register a response strategy
     */
    register(strategy) {
        this.strategies.push(strategy);
        // Sort by priority descending
        this.strategies.sort((a, b) => b.priority - a.priority);
    }
    /**
     * Unregister a strategy by name
     */
    unregister(name) {
        const index = this.strategies.findIndex(s => s.name === name);
        if (index >= 0) {
            this.strategies.splice(index, 1);
            return true;
        }
        return false;
    }
    /**
     * Get all registered strategies
     */
    getStrategies() {
        return [...this.strategies];
    }
    /**
     * Find the best strategy for a query
     */
    findStrategy(query, context) {
        for (const strategy of this.strategies) {
            if (strategy.canHandle(query, context)) {
                return strategy;
            }
        }
        return this.defaultStrategy;
    }
    /**
     * Check if a query is a duplicate (within dedup window)
     */
    isDuplicate(queryId, queryContent) {
        const hash = this.hashQuery(queryContent);
        const existing = this.responseHistory.get(hash);
        if (existing && Date.now() - existing.timestamp < this.DEDUP_WINDOW_MS) {
            return true;
        }
        return false;
    }
    /**
     * Generate a response using the best available strategy
     */
    async respond(query, context) {
        const startTime = Date.now();
        // Check for duplicate
        if (this.isDuplicate(query.id, query.content)) {
            return {
                success: false,
                response: '',
                strategyUsed: 'none',
                processingTimeMs: Date.now() - startTime,
                wasAutomatic: false,
                error: 'Duplicate query detected within deduplication window'
            };
        }
        // Find appropriate strategy
        const strategy = this.findStrategy(query, context);
        if (!strategy) {
            return {
                success: false,
                response: this.generateFallbackResponse(query, context),
                strategyUsed: 'fallback',
                processingTimeMs: Date.now() - startTime,
                wasAutomatic: false,
                error: 'No suitable strategy found'
            };
        }
        try {
            const response = await strategy.generate(query, context);
            // Record successful response for deduplication
            this.responseHistory.set(this.hashQuery(query.content), {
                query: query.content,
                timestamp: Date.now()
            });
            // Cleanup old history entries
            this.cleanupHistory();
            return {
                success: true,
                response,
                strategyUsed: strategy.name,
                processingTimeMs: Date.now() - startTime,
                wasAutomatic: true
            };
        }
        catch (error) {
            return {
                success: false,
                response: this.generateErrorResponse(query, context, error),
                strategyUsed: strategy.name,
                processingTimeMs: Date.now() - startTime,
                wasAutomatic: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Generate a fallback response when no strategy matches
     */
    generateFallbackResponse(query, context) {
        return `## Response from ${context.projectName}

I received your query but I'm not sure how to automatically respond to it.

**Your Query:** ${query.content}

**My Current Context:**
- Project: ${context.projectName}
- Current File: ${context.currentFile || 'None'}
- Git Branch: ${context.gitBranch || 'Unknown'}

_This is an automated fallback response. A more specific response may require manual intervention._`;
    }
    /**
     * Generate an error response
     */
    generateErrorResponse(query, context, error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return `## Response from ${context.projectName}

I encountered an error while processing your query.

**Error:** ${errorMessage}

**Your Query:** ${query.content.substring(0, 200)}...

_Please try again or rephrase your query._`;
    }
    /**
     * Hash a query for deduplication
     */
    hashQuery(query) {
        // Simple hash: normalize and truncate
        return query.toLowerCase().trim().substring(0, 100);
    }
    /**
     * Remove old entries from response history
     */
    cleanupHistory() {
        const cutoff = Date.now() - this.DEDUP_WINDOW_MS * 2;
        for (const [hash, entry] of this.responseHistory) {
            if (entry.timestamp < cutoff) {
                this.responseHistory.delete(hash);
            }
        }
    }
}
exports.AutoResponseManager = AutoResponseManager;
//# sourceMappingURL=responseStrategy.js.map