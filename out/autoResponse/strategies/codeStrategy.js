"use strict";
// codeStrategy.ts - Strategy for code and interface queries
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
exports.CodeStrategy = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const queryClassifier_1 = require("../queryClassifier");
const responseStrategy_1 = require("../responseStrategy");
/**
 * Strategy for handling code and interface queries
 * Handles: CODE_REQUEST, INTERFACE_REQUEST
 */
class CodeStrategy extends responseStrategy_1.BaseStrategy {
    name = 'code';
    description = 'Provides code snippets and interface definitions';
    priority = 75;
    supportedIntents = [queryClassifier_1.QueryIntent.CODE_REQUEST, queryClassifier_1.QueryIntent.INTERFACE_REQUEST];
    async generate(query, context) {
        const intent = query.classification.intent;
        switch (intent) {
            case queryClassifier_1.QueryIntent.INTERFACE_REQUEST:
                return this.generateInterfaceResponse(query, context);
            case queryClassifier_1.QueryIntent.CODE_REQUEST:
            default:
                return this.generateCodeResponse(query, context);
        }
    }
    estimateResponseTime() {
        return 500; // May involve file reading
    }
    async generateCodeResponse(query, context) {
        let response = this.formatHeader(context);
        response += `### Code Information\n\n`;
        // Try to extract what symbol/code they're asking about
        const symbolName = this.extractSymbolName(query.content);
        const editor = vscode.window.activeTextEditor;
        if (symbolName) {
            response += `**Searching for:** \`${symbolName}\`\n\n`;
            // Try to find the symbol using VS Code's symbol provider
            const symbolInfo = await this.findSymbol(symbolName);
            if (symbolInfo) {
                response += `**Found:** ${symbolInfo.kind} \`${symbolInfo.name}\`\n`;
                response += `**Location:** ${symbolInfo.location}\n\n`;
                if (symbolInfo.code) {
                    response += `**Code:**\n\`\`\`${symbolInfo.language}\n${symbolInfo.code}\n\`\`\`\n\n`;
                }
            }
            else {
                response += `_Could not find symbol \`${symbolName}\` in workspace._\n\n`;
            }
        }
        // Include current file context
        if (editor) {
            const filename = path.basename(editor.document.fileName);
            response += `**Current File:** ${filename}\n`;
            response += `**Language:** ${editor.document.languageId}\n`;
            response += `**Lines:** ${editor.document.lineCount}\n\n`;
            // If there's a selection, include it
            if (editor.selection && !editor.selection.isEmpty) {
                const selectedText = editor.document.getText(editor.selection);
                if (selectedText.length < 2000) {
                    response += `**Currently Selected Code:**\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\`\n\n`;
                }
            }
            else {
                // Show code around cursor
                const cursorLine = editor.selection.active.line;
                const startLine = Math.max(0, cursorLine - 10);
                const endLine = Math.min(editor.document.lineCount - 1, cursorLine + 10);
                const range = new vscode.Range(startLine, 0, endLine, 999);
                const codeNearCursor = editor.document.getText(range);
                if (codeNearCursor.length < 2000) {
                    response += `**Code Near Cursor (lines ${startLine + 1}-${endLine + 1}):**\n\`\`\`${editor.document.languageId}\n${codeNearCursor}\n\`\`\`\n\n`;
                }
            }
        }
        response += `_Generated at ${this.formatTimestamp()}_`;
        return response;
    }
    async generateInterfaceResponse(query, context) {
        let response = this.formatHeader(context);
        response += `### Interface Information\n\n`;
        const interfaceName = this.extractSymbolName(query.content);
        if (interfaceName) {
            response += `**Looking for interface:** \`${interfaceName}\`\n\n`;
            // Search for interface/type definitions
            const typeInfo = await this.findTypeDefinition(interfaceName);
            if (typeInfo) {
                response += `**Found:** ${typeInfo.kind} \`${typeInfo.name}\`\n`;
                response += `**File:** ${typeInfo.location}\n\n`;
                response += `**Definition:**\n\`\`\`typescript\n${typeInfo.code}\n\`\`\`\n\n`;
            }
            else {
                // Try to find in current file
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const text = editor.document.getText();
                    const interfaceMatch = this.findInterfaceInText(text, interfaceName);
                    if (interfaceMatch) {
                        response += `**Found in current file:**\n\`\`\`typescript\n${interfaceMatch}\n\`\`\`\n\n`;
                    }
                    else {
                        response += `_Interface \`${interfaceName}\` not found in workspace._\n\n`;
                        response += `**Suggestion:** The interface might be:\n`;
                        response += `- In a node_modules package\n`;
                        response += `- Defined with a different name\n`;
                        response += `- In a file not yet opened\n\n`;
                    }
                }
            }
        }
        else {
            // List interfaces in current file
            const editor = vscode.window.activeTextEditor;
            if (editor && (editor.document.languageId === 'typescript' || editor.document.languageId === 'typescriptreact')) {
                const text = editor.document.getText();
                const interfaces = this.findAllInterfacesInText(text);
                if (interfaces.length > 0) {
                    response += `**Interfaces in current file:**\n\n`;
                    interfaces.slice(0, 5).forEach(iface => {
                        response += `\`\`\`typescript\n${iface}\n\`\`\`\n\n`;
                    });
                }
                else {
                    response += `_No interfaces found in current file._\n`;
                }
            }
            else {
                response += `_Please specify which interface you're looking for._\n`;
            }
        }
        response += `_Generated at ${this.formatTimestamp()}_`;
        return response;
    }
    extractSymbolName(query) {
        // Look for quoted names
        const quotedMatch = query.match(/[`"'](\w+)[`"']/);
        if (quotedMatch)
            return quotedMatch[1];
        // Look for patterns like "the X class" or "X interface"
        const patterns = [
            /(?:the\s+)?(\w+)\s+(?:class|interface|type|function|method|component)/i,
            /(?:class|interface|type|function|method|component)\s+(\w+)/i,
            /(?:show|find|get|what is)\s+(?:the\s+)?(\w+)/i,
            /implementation\s+(?:of\s+)?(\w+)/i,
        ];
        for (const pattern of patterns) {
            const match = query.match(pattern);
            if (match && match[1].length > 1) {
                return match[1];
            }
        }
        return null;
    }
    async findSymbol(name) {
        try {
            const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', name);
            if (symbols && symbols.length > 0) {
                // Find best match
                const exactMatch = symbols.find((s) => s.name === name);
                const symbol = exactMatch || symbols[0];
                // Try to get the code
                const doc = await vscode.workspace.openTextDocument(symbol.location.uri);
                const range = symbol.location.range;
                // Expand range to get full definition
                const startLine = range.start.line;
                const endLine = Math.min(range.end.line + 20, doc.lineCount - 1);
                const expandedRange = new vscode.Range(startLine, 0, endLine, 999);
                let code = doc.getText(expandedRange);
                // Try to find the end of the definition
                code = this.trimToDefinition(code);
                return {
                    name: symbol.name,
                    kind: vscode.SymbolKind[symbol.kind],
                    location: path.basename(symbol.location.uri.fsPath),
                    code: code.substring(0, 1500),
                    language: doc.languageId
                };
            }
        }
        catch {
            // Symbol provider not available or failed
        }
        return null;
    }
    async findTypeDefinition(name) {
        // First try workspace symbol search
        const symbol = await this.findSymbol(name);
        if (symbol && symbol.code && (symbol.kind === 'Interface' || symbol.kind === 'TypeAlias' || symbol.kind === 'Class')) {
            return { name: symbol.name, kind: symbol.kind, location: symbol.location, code: symbol.code };
        }
        // Search in TypeScript files
        const files = await vscode.workspace.findFiles('**/*.{ts,tsx}', '**/node_modules/**', 50);
        for (const file of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                const definition = this.findInterfaceInText(text, name);
                if (definition) {
                    return {
                        name,
                        kind: definition.startsWith('interface') ? 'Interface' : 'Type',
                        location: path.basename(file.fsPath),
                        code: definition
                    };
                }
            }
            catch {
                // Skip files that can't be read
            }
        }
        return null;
    }
    findInterfaceInText(text, name) {
        // Match interface or type definition
        const patterns = [
            new RegExp(`(interface\\s+${name}\\s*(?:<[^>]+>)?\\s*(?:extends[^{]+)?\\{[^}]*\\})`, 's'),
            new RegExp(`(type\\s+${name}\\s*(?:<[^>]+>)?\\s*=\\s*[^;]+;)`, 's'),
            new RegExp(`(export\\s+interface\\s+${name}\\s*(?:<[^>]+>)?\\s*(?:extends[^{]+)?\\{[^}]*\\})`, 's'),
            new RegExp(`(export\\s+type\\s+${name}\\s*(?:<[^>]+>)?\\s*=\\s*[^;]+;)`, 's'),
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
        return null;
    }
    findAllInterfacesInText(text) {
        const interfaces = [];
        const pattern = /((?:export\s+)?interface\s+\w+\s*(?:<[^>]+>)?[^{]*\{[^}]*\})/gs;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            interfaces.push(match[1].trim());
        }
        return interfaces;
    }
    trimToDefinition(code) {
        // Try to find matching braces
        let braceCount = 0;
        let started = false;
        let endIndex = code.length;
        for (let i = 0; i < code.length; i++) {
            if (code[i] === '{') {
                braceCount++;
                started = true;
            }
            else if (code[i] === '}') {
                braceCount--;
                if (started && braceCount === 0) {
                    endIndex = i + 1;
                    break;
                }
            }
        }
        return code.substring(0, endIndex);
    }
}
exports.CodeStrategy = CodeStrategy;
//# sourceMappingURL=codeStrategy.js.map