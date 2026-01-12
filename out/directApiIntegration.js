"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectClaudeIntegration = void 0;
// directApiIntegration.ts - Use Anthropic API directly
const vscode = __importStar(require("vscode"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class DirectClaudeIntegration {
    client;
    constructor() {
        // Uses ANTHROPIC_API_KEY from environment or settings
        const apiKey = vscode.workspace.getConfiguration('claudeTeam').get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;
        this.client = new sdk_1.default({ apiKey });
    }
    async processTeamQuery(query, fromWindow, localContext) {
        const systemPrompt = `You are part of a team of Claude instances working on a software project.
Another Claude instance from window "${fromWindow}" has sent you a query.
Your current workspace context:
${localContext}

Respond helpfully with specific, actionable information. Include code examples when relevant.`;
        const response = await this.client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2048,
            system: systemPrompt,
            messages: [
                { role: 'user', content: query }
            ]
        });
        return response.content
            .filter(block => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
    }
}
exports.DirectClaudeIntegration = DirectClaudeIntegration;
//# sourceMappingURL=directApiIntegration.js.map