"use strict";
// errorsStrategy.ts - Strategy for error and diagnostic queries
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorsStrategy = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const queryClassifier_1 = require("../queryClassifier");
const responseStrategy_1 = require("../responseStrategy");
/**
 * Strategy for handling error and diagnostic queries
 * Handles: ERROR_HELP
 */
class ErrorsStrategy extends responseStrategy_1.BaseStrategy {
    name = 'errors';
    description = 'Provides error diagnostics and troubleshooting context';
    priority = 80;
    supportedIntents = [queryClassifier_1.QueryIntent.ERROR_HELP];
    async generate(query, context) {
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
            }
            else {
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
        }
        else {
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
    estimateResponseTime() {
        return 100; // Fast - only reads VS Code diagnostics
    }
    gatherDiagnostics() {
        const results = [];
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
    extractErrorFromQuery(query) {
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
    findMatchingDiagnostics(errorText, diagnostics) {
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
    severityToString(severity) {
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
    generateSuggestions(errors, query) {
        const suggestions = [];
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
exports.ErrorsStrategy = ErrorsStrategy;
//# sourceMappingURL=errorsStrategy.js.map