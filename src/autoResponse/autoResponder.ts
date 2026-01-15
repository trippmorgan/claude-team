// autoResponder.ts - Improved AutoResponder that coordinates all strategies

import * as vscode from 'vscode';
import { TeamContext } from '../types';
import { ClaudeCodeBridge } from '../claudeCodeIntegration';
import { QueryClassifier, QueryIntent, ClassificationResult } from './queryClassifier';
import { AutoResponseManager, ResponseQuery, ResponseResult } from './responseStrategy';
import { ContextStrategy } from './strategies/contextStrategy';
import { ErrorsStrategy } from './strategies/errorsStrategy';
import { CodeStrategy } from './strategies/codeStrategy';
import { ClaudeStrategy } from './strategies/claudeStrategy';

/**
 * Configuration options for the auto-responder
 */
export interface AutoResponderConfig {
  /** Enable auto-response */
  enabled: boolean;
  /** Response mode: 'off' | 'context-only' | 'smart' | 'full' */
  mode: 'off' | 'context-only' | 'smart' | 'full';
  /** Timeout for Claude CLI responses in ms */
  claudeTimeout: number;
  /** Enable logging of classifications */
  logClassifications: boolean;
  /** Intents that require user approval */
  requireApprovalFor: QueryIntent[];
}

/**
 * Incoming query from another window
 */
export interface IncomingQuery {
  id: string;
  content: string;
  fromWindow: string;
  fromWindowName?: string;
  additionalContext?: string;
  timestamp?: number;
}

/**
 * Improved AutoResponder that uses strategy pattern and query classification
 */
export class ImprovedAutoResponder {
  private classifier: QueryClassifier;
  private manager: AutoResponseManager;
  private config: AutoResponderConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private bridge: ClaudeCodeBridge,
    outputChannel: vscode.OutputChannel,
    config?: Partial<AutoResponderConfig>
  ) {
    this.outputChannel = outputChannel;
    this.classifier = new QueryClassifier();
    this.manager = new AutoResponseManager();

    // Default configuration
    this.config = {
      enabled: true,
      mode: 'smart',
      claudeTimeout: 120000,
      logClassifications: true,
      requireApprovalFor: [QueryIntent.TASK_DELEGATION],
      ...config
    };

    // Register strategies
    this.initializeStrategies();
  }

  /**
   * Initialize and register all response strategies
   */
  private initializeStrategies(): void {
    // Register strategies in priority order (highest first)
    this.manager.register(new ContextStrategy());
    this.manager.register(new ErrorsStrategy());
    this.manager.register(new CodeStrategy());
    this.manager.register(new ClaudeStrategy(this.bridge));

    this.log('Strategies registered: ' +
      this.manager.getStrategies().map(s => s.name).join(', '));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoResponderConfig>): void {
    this.config = { ...this.config, ...config };
    this.log('Configuration updated');
  }

  /**
   * Check if auto-response is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.config.mode !== 'off';
  }

  /**
   * Determine if a query should be auto-responded to
   */
  shouldAutoRespond(query: IncomingQuery): {
    shouldRespond: boolean;
    requiresApproval: boolean;
    classification: ClassificationResult;
    reason: string;
  } {
    // Check if enabled
    if (!this.isEnabled()) {
      return {
        shouldRespond: false,
        requiresApproval: false,
        classification: { intent: QueryIntent.UNKNOWN, confidence: 0 },
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
  async generateResponse(
    query: IncomingQuery,
    context: TeamContext
  ): Promise<ResponseResult> {
    const classification = this.classifier.classify(query.content);

    const responseQuery: ResponseQuery = {
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
  async process(query: IncomingQuery, context: TeamContext): Promise<{
    response: string;
    wasAutomatic: boolean;
    strategy: string;
    classification: ClassificationResult;
  } | null> {
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
  getClassifier(): QueryClassifier {
    return this.classifier;
  }

  /**
   * Get the response manager for external use
   */
  getManager(): AutoResponseManager {
    return this.manager;
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoResponderConfig {
    return { ...this.config };
  }

  /**
   * Log a message to the output channel
   */
  private log(message: string): void {
    this.outputChannel.appendLine(`[AutoResponder] ${message}`);
  }

  /**
   * Generate a quick context response (for simple status queries)
   */
  quickContextResponse(context: TeamContext): string {
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
  classifyOnly(query: string): ClassificationResult {
    return this.classifier.classify(query);
  }
}
