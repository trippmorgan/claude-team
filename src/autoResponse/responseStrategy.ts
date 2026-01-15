// responseStrategy.ts - Strategy pattern for response generation

import { TeamContext } from '../types';
import { QueryIntent, ClassificationResult } from './queryClassifier';

/**
 * Query object passed to response strategies
 */
export interface ResponseQuery {
  id: string;
  content: string;
  fromWindow: string;
  fromWindowName?: string;
  classification: ClassificationResult;
  additionalContext?: string;
}

/**
 * Result from a response strategy
 */
export interface ResponseResult {
  success: boolean;
  response: string;
  strategyUsed: string;
  processingTimeMs: number;
  wasAutomatic: boolean;
  error?: string;
}

/**
 * Base interface for response strategies
 */
export interface ResponseStrategy {
  /** Unique name for this strategy */
  readonly name: string;

  /** Description of what this strategy handles */
  readonly description: string;

  /** Priority for strategy selection (higher = checked first) */
  readonly priority: number;

  /** Intents this strategy can handle */
  readonly supportedIntents: QueryIntent[];

  /**
   * Check if this strategy can handle the given query
   */
  canHandle(query: ResponseQuery, context: TeamContext): boolean;

  /**
   * Generate a response for the query
   */
  generate(query: ResponseQuery, context: TeamContext): Promise<string>;

  /**
   * Estimate response time in milliseconds
   */
  estimateResponseTime(): number;
}

/**
 * Abstract base class with common functionality
 */
export abstract class BaseStrategy implements ResponseStrategy {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly priority: number;
  abstract readonly supportedIntents: QueryIntent[];

  canHandle(query: ResponseQuery, _context: TeamContext): boolean {
    return this.supportedIntents.includes(query.classification.intent);
  }

  abstract generate(query: ResponseQuery, context: TeamContext): Promise<string>;

  estimateResponseTime(): number {
    return 100; // Default: 100ms
  }

  /**
   * Format a standard response header
   */
  protected formatHeader(context: TeamContext): string {
    return `## Response from ${context.projectName}\n\n`;
  }

  /**
   * Format timestamp
   */
  protected formatTimestamp(): string {
    return new Date().toISOString();
  }
}

/**
 * Manager that coordinates multiple response strategies
 */
export class AutoResponseManager {
  private strategies: ResponseStrategy[] = [];
  private responseHistory: Map<string, { query: string; timestamp: number }> = new Map();
  private readonly DEDUP_WINDOW_MS = 5000; // 5 second deduplication window

  constructor(private defaultStrategy?: ResponseStrategy) {}

  /**
   * Register a response strategy
   */
  register(strategy: ResponseStrategy): void {
    this.strategies.push(strategy);
    // Sort by priority descending
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Unregister a strategy by name
   */
  unregister(name: string): boolean {
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
  getStrategies(): ResponseStrategy[] {
    return [...this.strategies];
  }

  /**
   * Find the best strategy for a query
   */
  findStrategy(query: ResponseQuery, context: TeamContext): ResponseStrategy | undefined {
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
  isDuplicate(queryId: string, queryContent: string): boolean {
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
  async respond(query: ResponseQuery, context: TeamContext): Promise<ResponseResult> {
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
    } catch (error) {
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
  private generateFallbackResponse(query: ResponseQuery, context: TeamContext): string {
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
  private generateErrorResponse(query: ResponseQuery, context: TeamContext, error: unknown): string {
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
  private hashQuery(query: string): string {
    // Simple hash: normalize and truncate
    return query.toLowerCase().trim().substring(0, 100);
  }

  /**
   * Remove old entries from response history
   */
  private cleanupHistory(): void {
    const cutoff = Date.now() - this.DEDUP_WINDOW_MS * 2;
    for (const [hash, entry] of this.responseHistory) {
      if (entry.timestamp < cutoff) {
        this.responseHistory.delete(hash);
      }
    }
  }
}
