"use strict";
// queryClassifier.ts - Intent detection for incoming queries
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryClassifier = exports.QueryIntent = void 0;
/**
 * Query intent categories for routing to appropriate response strategies
 */
var QueryIntent;
(function (QueryIntent) {
    QueryIntent["STATUS_CHECK"] = "status_check";
    QueryIntent["CONTEXT_REQUEST"] = "context_request";
    QueryIntent["CODE_REQUEST"] = "code_request";
    QueryIntent["ERROR_HELP"] = "error_help";
    QueryIntent["INTERFACE_REQUEST"] = "interface_request";
    QueryIntent["DEPENDENCY_CHECK"] = "dependency_check";
    QueryIntent["REVIEW_REQUEST"] = "review_request";
    QueryIntent["HELP_REQUEST"] = "help_request";
    QueryIntent["TASK_DELEGATION"] = "task_delegation";
    QueryIntent["SYNC_REQUEST"] = "sync_request";
    QueryIntent["GENERAL_QUESTION"] = "general_question";
    QueryIntent["UNKNOWN"] = "unknown";
})(QueryIntent || (exports.QueryIntent = QueryIntent = {}));
/**
 * Query classifier using pattern matching and keyword analysis
 */
class QueryClassifier {
    intentPatterns = [
        {
            intent: QueryIntent.STATUS_CHECK,
            patterns: [
                /what (are you|is your|r u) (working on|doing|up to)/i,
                /status( update)?/i,
                /how('s| is) (it going|progress|work)/i,
                /update me/i,
                /where are you( at)?/i,
            ],
            keywords: ['status', 'progress', 'working', 'doing', 'update'],
            weight: 90
        },
        {
            intent: QueryIntent.CONTEXT_REQUEST,
            patterns: [
                /share.*(context|state|info)/i,
                /what('s| is) (your|the) (context|environment|setup)/i,
                /tell me about your (project|workspace|environment)/i,
                /give me.*(context|overview)/i,
            ],
            keywords: ['context', 'environment', 'workspace', 'setup', 'share'],
            weight: 85
        },
        {
            intent: QueryIntent.CODE_REQUEST,
            patterns: [
                /show (me )?(the |your )?(code|implementation|function|class|method)/i,
                /what does.*(look like|do)/i,
                /can (i |you )?(see|share|show).*(code|implementation)/i,
                /how (is|did you) implement/i,
                /share.*(code|snippet|implementation)/i,
            ],
            keywords: ['show', 'code', 'implementation', 'function', 'class', 'method'],
            weight: 75
        },
        {
            intent: QueryIntent.ERROR_HELP,
            patterns: [
                /error|exception|crash|bug|issue|problem/i,
                /i('m| am) (seeing|getting|having)/i,
                /something('s| is) (wrong|broken|not working)/i,
                /failing|failed/i,
                /stack trace/i,
            ],
            keywords: ['error', 'exception', 'bug', 'issue', 'problem', 'crash', 'failing'],
            weight: 80
        },
        {
            intent: QueryIntent.INTERFACE_REQUEST,
            patterns: [
                /what('s| is) the (interface|type|definition|schema|api)/i,
                /share.*(interface|type|definition|api)/i,
                /(interface|type|api) (for|of)/i,
                /how (do i|should i|to) (use|call|interact)/i,
            ],
            keywords: ['interface', 'type', 'definition', 'schema', 'api', 'signature'],
            weight: 85
        },
        {
            intent: QueryIntent.DEPENDENCY_CHECK,
            patterns: [
                /are you using/i,
                /do you (use|have|need)/i,
                /what (version|library|package|framework)/i,
                /which.*(library|package|framework|tool)/i,
                /dependency|dependencies/i,
            ],
            keywords: ['using', 'version', 'library', 'package', 'dependency', 'framework'],
            weight: 70
        },
        {
            intent: QueryIntent.REVIEW_REQUEST,
            patterns: [
                /review (this|my|the)/i,
                /can you (check|look at|review)/i,
                /what do you think (of|about)/i,
                /feedback (on|for)/i,
                /does this look (right|ok|correct)/i,
            ],
            keywords: ['review', 'check', 'feedback', 'opinion', 'think'],
            weight: 75
        },
        {
            intent: QueryIntent.HELP_REQUEST,
            patterns: [
                /can you help/i,
                /i need help/i,
                /help me (with|understand|figure)/i,
                /i('m| am) stuck/i,
                /how (do|can|should) (i|we)/i,
                /any (ideas|suggestions|thoughts)/i,
            ],
            keywords: ['help', 'stuck', 'assist', 'guidance', 'suggestion'],
            weight: 60
        },
        {
            intent: QueryIntent.TASK_DELEGATION,
            patterns: [
                /please (implement|create|add|fix|update|change)/i,
                /can you (implement|create|add|fix|build|make)/i,
                /i need you to/i,
                /would you (implement|create|build)/i,
                /take care of/i,
            ],
            keywords: ['implement', 'create', 'build', 'fix', 'change', 'update'],
            weight: 65
        },
        {
            intent: QueryIntent.SYNC_REQUEST,
            patterns: [
                /sync( up)?/i,
                /let('s| us) (sync|align|coordinate)/i,
                /quick (sync|update|check-in)/i,
                /catch me up/i,
                /what (have i|did i) miss/i,
            ],
            keywords: ['sync', 'align', 'coordinate', 'catch up'],
            weight: 80
        },
        {
            intent: QueryIntent.GENERAL_QUESTION,
            patterns: [
                /^(what|how|why|when|where|who|which|can|do|does|is|are)\b/i,
            ],
            keywords: [],
            weight: 30
        }
    ];
    /**
     * Classify a query and return the detected intent with confidence
     */
    classify(query) {
        const normalizedQuery = query.trim().toLowerCase();
        const results = [];
        for (const intentDef of this.intentPatterns) {
            let score = 0;
            let matchedPattern;
            // Check regex patterns (high confidence)
            for (const pattern of intentDef.patterns) {
                if (pattern.test(query)) {
                    score += 50;
                    matchedPattern = pattern.source;
                    break;
                }
            }
            // Check keywords (additive confidence)
            const keywordMatches = intentDef.keywords.filter(kw => normalizedQuery.includes(kw.toLowerCase()));
            score += keywordMatches.length * 10;
            // Apply weight
            score = (score * intentDef.weight) / 100;
            if (score > 0) {
                results.push({ intent: intentDef.intent, score, pattern: matchedPattern });
            }
        }
        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        if (results.length === 0) {
            return {
                intent: QueryIntent.UNKNOWN,
                confidence: 0,
                suggestedStrategy: 'claude'
            };
        }
        const best = results[0];
        const confidence = Math.min(best.score / 100, 1);
        return {
            intent: best.intent,
            confidence,
            matchedPattern: best.pattern,
            suggestedStrategy: this.getStrategyForIntent(best.intent)
        };
    }
    /**
     * Map intent to suggested response strategy
     */
    getStrategyForIntent(intent) {
        const strategyMap = {
            [QueryIntent.STATUS_CHECK]: 'context',
            [QueryIntent.CONTEXT_REQUEST]: 'context',
            [QueryIntent.CODE_REQUEST]: 'code',
            [QueryIntent.ERROR_HELP]: 'errors',
            [QueryIntent.INTERFACE_REQUEST]: 'code',
            [QueryIntent.DEPENDENCY_CHECK]: 'context',
            [QueryIntent.REVIEW_REQUEST]: 'claude',
            [QueryIntent.HELP_REQUEST]: 'claude',
            [QueryIntent.TASK_DELEGATION]: 'claude',
            [QueryIntent.SYNC_REQUEST]: 'context',
            [QueryIntent.GENERAL_QUESTION]: 'claude',
            [QueryIntent.UNKNOWN]: 'claude'
        };
        return strategyMap[intent];
    }
    /**
     * Check if intent requires user approval before auto-responding
     */
    requiresApproval(intent) {
        const approvalRequired = new Set([
            QueryIntent.TASK_DELEGATION,
            QueryIntent.REVIEW_REQUEST
        ]);
        return approvalRequired.has(intent);
    }
    /**
     * Check if intent can be handled with instant (no external calls) response
     */
    isInstantResponse(intent) {
        const instantIntents = new Set([
            QueryIntent.STATUS_CHECK,
            QueryIntent.CONTEXT_REQUEST,
            QueryIntent.SYNC_REQUEST,
            QueryIntent.DEPENDENCY_CHECK
        ]);
        return instantIntents.has(intent);
    }
}
exports.QueryClassifier = QueryClassifier;
//# sourceMappingURL=queryClassifier.js.map