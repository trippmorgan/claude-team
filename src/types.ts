import * as vscode from 'vscode';

export interface ClaudeQuery {
    id: string;
    senderId: string;
    senderName: string;
    query: string;
    context?: string;
    timestamp: number;
}

export interface ClaudeResponse {
    queryId: string;
    responderId: string;
    responderName: string;
    response: string;
    timestamp: number;
}

export interface WindowInfo {
    id: string;
    name: string;
    workspaceRoot?: string;
}

export interface TeamContext {
    windowId: string;
    projectName: string;
    currentFile?: string;
    recentFiles: string[];
    gitBranch?: string;
    openProblems: vscode.Diagnostic[];
}

export interface ClaudeTask {
    id: string;
    title: string;
    description: string;
    assigneeId: string;
    assigneeName: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    result?: string;
    timestamp: number;
}

export type Message = 
    | { type: 'register'; window: WindowInfo }
    | { type: 'query'; query: ClaudeQuery }
    | { type: 'response'; response: ClaudeResponse }
    | { type: 'broadcastContext'; context: string; senderName: string }
    | { type: 'windowList'; windows: WindowInfo[] }
    | { type: 'taskAssign'; task: ClaudeTask }
    | { type: 'taskUpdate'; task: ClaudeTask }
    | { type: 'memoryUpdate'; key: string, value: any }
    | { type: 'memorySync'; state: Record<string, any> }
    | { type: 'mcpQuery'; content: string; senderId: string }
    | { type: 'chromeQuery'; content: string; senderId: string }
    | { type: 'status_request'; id: string };
