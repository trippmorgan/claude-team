/**
 * MCP Browser Bridge Server
 *
 * Enables Claude Code to communicate with Chrome extensions and control browser operations.
 * Integrates with claude-team hub for multi-agent coordination.
 *
 * Architecture:
 * - MCP Server (stdio) ← Claude Code
 * - WebSocket Server ← Chrome extensions
 * - HTTP Client → claude-team hub (port 4847)
 */
export {};
