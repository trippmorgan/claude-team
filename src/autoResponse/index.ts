// autoResponse/index.ts - Main exports for the auto-response system

export { QueryClassifier, QueryIntent, ClassificationResult } from './queryClassifier';
export {
  ResponseStrategy,
  BaseStrategy,
  ResponseQuery,
  ResponseResult,
  AutoResponseManager
} from './responseStrategy';

// Strategy exports
export { ContextStrategy } from './strategies/contextStrategy';
export { ErrorsStrategy } from './strategies/errorsStrategy';
export { CodeStrategy } from './strategies/codeStrategy';
export { ClaudeStrategy } from './strategies/claudeStrategy';

// Re-export the improved AutoResponder
export { ImprovedAutoResponder } from './autoResponder';
