# CLAUDE.md — Technical Specification and Architectural Analysis

## Abstract

Claude Team is a distributed multi-agent orchestration system implemented as a Visual Studio Code extension. The system enables heterogeneous Claude Code instances operating in isolated process spaces to communicate via a WebSocket-mediated message-passing protocol. This document provides a comprehensive technical specification of the system architecture, communication protocols, failure semantics, and implementation details suitable for researchers and advanced practitioners in distributed systems and human-AI collaboration.

---

## 1. Introduction and Motivation

### 1.1 Problem Domain

Modern software development increasingly involves managing multiple codebases, microservices, and domain-specific contexts simultaneously. When augmented by AI assistants like Claude Code, practitioners face a fundamental isolation problem: each Claude instance operates within the bounded context of a single VS Code window, lacking awareness of related work occurring in parallel sessions.

This architectural constraint creates several suboptimal conditions:
- **Information Asymmetry**: Knowledge acquired in one session remains siloed
- **Redundant Computation**: Multiple instances may solve identical subproblems
- **Coordination Overhead**: Human operators must manually relay information between contexts
- **Context Fragmentation**: Holistic understanding of multi-service systems requires mental aggregation

### 1.2 Solution Approach

Claude Team addresses these constraints through a **hub-and-spoke distributed messaging architecture** that enables:
1. **Inter-process communication** between Claude instances via WebSocket channels
2. **Shared state synchronization** through a distributed blackboard pattern
3. **Task delegation** with asynchronous completion semantics
4. **Automatic fault tolerance** via leader election on hub failure

---

## 2. System Architecture

### 2.1 Topological Overview

The system implements a **star topology** with dynamic hub election:

```
                    ┌─────────────────────────────────────┐
                    │         WebSocket Hub               │
                    │    (Dynamically Elected Leader)     │
                    │                                     │
                    │  ┌─────────────┐ ┌──────────────┐  │
                    │  │   Window    │ │   Message    │  │
                    │  │  Registry   │ │   Router     │  │
                    │  └─────────────┘ └──────────────┘  │
                    │                                     │
                    │  ┌─────────────┐ ┌──────────────┐  │
                    │  │   Shared    │ │   Message    │  │
                    │  │   State     │ │   Queue      │  │
                    │  └─────────────┘ └──────────────┘  │
                    └──────────┬──────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │   Window 1   │   │   Window 2   │   │   Window N   │
    │   (Client)   │   │   (Client)   │   │   (Client)   │
    │              │   │              │   │              │
    │ ┌──────────┐ │   │ ┌──────────┐ │   │ ┌──────────┐ │
    │ │Extension │ │   │ │Extension │ │   │ │Extension │ │
    │ └──────────┘ │   │ └──────────┘ │   │ └──────────┘ │
    │ ┌──────────┐ │   │ ┌──────────┐ │   │ ┌──────────┐ │
    │ │  Bridge  │ │   │ │  Bridge  │ │   │ │  Bridge  │ │
    │ └──────────┘ │   │ └──────────┘ │   │ └──────────┘ │
    └──────────────┘   └──────────────┘   └──────────────┘
```

### 2.2 Component Decomposition

#### 2.2.1 Extension Layer (`extension.ts`)

The extension module serves as the **compositional root** and **event dispatcher**. Key responsibilities:

| Responsibility | Implementation |
|----------------|----------------|
| Lifecycle Management | `activate()` / `deactivate()` hooks |
| Command Registration | 8 VS Code commands bound to handlers |
| View Providers | 4 TreeDataProvider implementations |
| Event Routing | EventEmitter subscription patterns |

**Command Surface Area:**

| Command | Semantics | Side Effects |
|---------|-----------|--------------|
| `sendQuery` | Initiates cross-window query | Network I/O, UI update |
| `assignTask` | Delegates work item | State mutation, notification |
| `broadcastContext` | Shares workspace state | Multicast transmission |
| `requestHelp` | Broadcasts assistance request | Multicast transmission |
| `shareSelection` | Transmits editor selection | Network I/O |
| `setMemory` | Mutates shared state | State synchronization |
| `showWindows` | Renders window registry | UI update |
| `showLog` | Displays message history | UI update |

#### 2.2.2 Communication Layer (`communication.ts`)

Implements the **WebSocket transport** with dual-mode operation:

**Hub Mode (Server)**:
- Binds to configurable port (default: 3847)
- Maintains `Map<string, WebSocket>` for client connections
- Routes messages based on type discriminant
- Manages shared state authoritative copy

**Client Mode**:
- Establishes persistent WebSocket connection to hub
- Implements automatic reconnection with randomized backoff
- Participates in leader election on hub failure

**State Machine:**

```
                    ┌─────────┐
                    │  INIT   │
                    └────┬────┘
                         │
                         ▼
                ┌────────────────┐
                │ tryBecomeHub() │
                └───────┬────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
    ┌───────────────┐      ┌───────────────┐
    │   HUB MODE    │      │ CLIENT MODE   │
    │ (EADDRINUSE   │      │ (Port bound)  │
    │   = false)    │      │               │
    └───────────────┘      └───────┬───────┘
                                   │
                           ┌───────┴───────┐
                           │ Hub Failure   │
                           │ Detected      │
                           └───────┬───────┘
                                   │
                                   ▼
                          ┌────────────────┐
                          │ Random Backoff │
                          │ (0-2000ms)     │
                          └───────┬────────┘
                                  │
                                  ▼
                         ┌────────────────┐
                         │ tryBecomeHub() │
                         └────────────────┘
```

#### 2.2.3 Claude Code Bridge (`claudeCodeIntegration.ts`)

The bridge layer provides **process spawning** and **context aggregation** capabilities:

**Process Model:**
- Spawns Claude CLI as child process via `child_process.spawn()`
- Communicates via stdout/stderr pipes
- Enforces 120-second timeout with `SIGTERM` escalation
- Captures response via stream accumulation

**Context Aggregation Pipeline:**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Active Editor  │───►│    File Path    │───►│                 │
│  Document       │    │    Extraction   │    │                 │
└─────────────────┘    └─────────────────┘    │                 │
                                              │    Context      │
┌─────────────────┐    ┌─────────────────┐    │    Object       │
│  Git Extension  │───►│  Branch Name    │───►│                 │
│  API            │    │  Detection      │    │                 │
└─────────────────┘    └─────────────────┘    │                 │
                                              │                 │
┌─────────────────┐    ┌─────────────────┐    │                 │
│  Diagnostics    │───►│  Error/Warning  │───►│                 │
│  Collection     │    │  Aggregation    │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Auto-Responder Heuristics:**

The `AutoResponder` class implements pattern-based query classification:

| Pattern | Detection Regex | Response Strategy |
|---------|-----------------|-------------------|
| Version Query | `/version|what version/i` | Extract from package.json |
| Interface Request | `/interface|types|definition/i` | Return type signatures |
| Context Query | `/context|what.*working|current/i` | Aggregate workspace state |
| Status Request | `/status|progress|update/i` | Return activity summary |

---

## 3. Communication Protocol

### 3.1 Message Type Algebra

The protocol defines a **discriminated union** over message types:

```typescript
type Message =
  | { type: 'register'; window: WindowInfo }
  | { type: 'query'; query: ClaudeQuery }
  | { type: 'response'; response: ClaudeResponse }
  | { type: 'broadcastContext'; context: TeamContext; senderId: string }
  | { type: 'windowList'; windows: WindowInfo[] }
  | { type: 'taskAssign'; task: ClaudeTask }
  | { type: 'taskUpdate'; task: ClaudeTask }
  | { type: 'memoryUpdate'; key: string; value: string }
  | { type: 'memorySync'; state: Record<string, string> }
```

### 3.2 Message Flow Semantics

#### 3.2.1 Query-Response Protocol

```
Client A                    Hub                     Client B
   │                         │                         │
   │  {type: 'query', ...}   │                         │
   │────────────────────────►│                         │
   │                         │  {type: 'query', ...}   │
   │                         │────────────────────────►│
   │                         │                         │
   │                         │                    [Processing]
   │                         │                         │
   │                         │ {type: 'response', ...} │
   │                         │◄────────────────────────│
   │ {type: 'response', ...} │                         │
   │◄────────────────────────│                         │
   │                         │                         │
```

**Delivery Guarantee**: At-most-once delivery. No acknowledgment or retry mechanism. Message loss on network partition results in silent failure.

#### 3.2.2 State Synchronization Protocol

The shared state implements **eventual consistency** with hub as single source of truth:

```
Client                      Hub                    All Clients
   │                         │                         │
   │ {type: 'memoryUpdate',  │                         │
   │  key: 'K', value: 'V'}  │                         │
   │────────────────────────►│                         │
   │                         │  [Update local state]   │
   │                         │                         │
   │                         │ {type: 'memorySync',    │
   │                         │  state: {...}}          │
   │                         │────────────────────────►│
   │                         │                         │
```

**Conflict Resolution**: Last-write-wins. No vector clocks or causal ordering.

---

## 4. Failure Modes and Recovery

### 4.1 Hub Failure Detection

Clients detect hub failure via WebSocket `close` event with non-normal close codes:

| Close Code | Semantics | Recovery Action |
|------------|-----------|-----------------|
| 1000 | Normal closure | No action |
| 1001 | Going away | Trigger election |
| 1006 | Abnormal closure | Trigger election |

### 4.2 Leader Election Algorithm

The system implements a **probabilistic leader election** mechanism:

```javascript
// Pseudocode
on_hub_disconnect:
    delay = random(0, 2000)  // milliseconds
    sleep(delay)

    try:
        bind(PORT)  // Attempt to become hub
        mode = HUB
        notify_success()
    catch EADDRINUSE:
        mode = CLIENT
        connect_to_hub()
```

**Analysis:**
- **Convergence**: With uniform distribution over [0, 2000], probability of collision ≈ 0 for small N
- **Liveness**: At least one client will successfully bind within 2 seconds
- **Fairness**: Equal probability of hub election for all clients

**Limitations:**
- No deterministic ordering (non-Byzantine)
- State loss on hub failure (no replication)
- Network partition causes split-brain potential

### 4.3 State Recovery

On hub failure, shared state is **lost** unless a client maintains a cached copy. New hub starts with empty state. This represents a significant limitation for production deployments.

**Mitigation Strategies** (not currently implemented):
1. Client-side state caching with version vectors
2. Periodic state snapshots to persistent storage
3. Gossip-based state replication between clients

---

## 5. Security Considerations

### 5.1 Threat Model

The current implementation assumes a **trusted network environment**:

| Threat | Current Mitigation | Recommended Enhancement |
|--------|-------------------|------------------------|
| Eavesdropping | None (plaintext WebSocket) | WSS with TLS |
| Message Injection | None | HMAC message authentication |
| DoS on Hub | None | Rate limiting |
| Impersonation | None | Client certificate authentication |

### 5.2 Trust Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│                    TRUSTED ZONE                                │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ VS Code      │  │ VS Code      │  │ VS Code      │        │
│  │ Process      │  │ Process      │  │ Process      │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│         │                │                │                   │
│         └────────────────┼────────────────┘                   │
│                          │                                    │
│                          ▼                                    │
│                  ┌──────────────┐                             │
│                  │  localhost   │                             │
│                  │  WebSocket   │                             │
│                  └──────────────┘                             │
└────────────────────────────────────────────────────────────────┘
```

All communication occurs over localhost. No external network exposure by default.

---

## 6. Performance Characteristics

### 6.1 Complexity Analysis

| Operation | Time Complexity | Space Complexity |
|-----------|----------------|------------------|
| Message broadcast | O(N) where N = clients | O(M) where M = message size |
| Window lookup | O(1) hash map access | O(N) registry storage |
| State update | O(N) for sync broadcast | O(K) where K = key count |
| Hub election | O(1) per client | O(1) |

### 6.2 Scalability Bounds

**Theoretical Limits:**
- **Clients**: Limited by OS file descriptor limits (~1024 default, configurable)
- **Message Rate**: Limited by V8 event loop throughput (~10K msgs/sec)
- **State Size**: Limited by process memory (V8 heap)

**Practical Recommendations:**
- Optimal performance: 2-10 concurrent windows
- Degraded performance: 10-50 windows
- Not recommended: >50 windows without architectural changes

---

## 7. Implementation Details

### 7.1 Technology Stack

| Layer | Technology | Version | Rationale |
|-------|------------|---------|-----------|
| Runtime | Node.js | ES2022 | VS Code extension host |
| Language | TypeScript | 5.3+ | Type safety, IDE integration |
| WebSocket | ws | 8.14+ | RFC 6455 compliant, performant |
| Build | tsc | 5.3+ | Native TypeScript compilation |
| Lint | ESLint | 8.0+ | Code quality enforcement |

### 7.2 File Structure

```
claude-team/
├── src/
│   ├── extension.ts          # 283 LOC - Compositional root
│   ├── communication.ts      # 177 LOC - WebSocket layer
│   ├── claudeCodeIntegration.ts  # 286 LOC - CLI bridge
│   └── types.ts              # 55 LOC - Type definitions
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
└── .eslintrc.json            # Linting rules
```

**Total Implementation**: ~801 lines of TypeScript

### 7.3 VS Code Integration Points

| API | Usage | Module |
|-----|-------|--------|
| `vscode.window.createOutputChannel` | Logging | extension.ts |
| `vscode.window.registerTreeDataProvider` | Sidebar views | extension.ts |
| `vscode.commands.registerCommand` | Command binding | extension.ts |
| `vscode.workspace.getConfiguration` | Settings access | extension.ts |
| `vscode.extensions.getExtension` | Git integration | claudeCodeIntegration.ts |
| `vscode.languages.getDiagnostics` | Error collection | claudeCodeIntegration.ts |

---

## 8. Extension Points and Customization

### 8.1 Configuration Schema

```json
{
  "claudeTeam.hubPort": {
    "type": "number",
    "default": 3847,
    "description": "WebSocket hub port"
  },
  "claudeTeam.autoRespond": {
    "type": "boolean",
    "default": false,
    "description": "Enable automatic query processing"
  },
  "claudeTeam.windowName": {
    "type": "string",
    "default": "",
    "description": "Custom window identifier"
  },
  "claudeTeam.shareContext": {
    "type": "boolean",
    "default": true,
    "description": "Include workspace context in messages"
  }
}
```

### 8.2 Query Templates

The `TeamQueryTemplates` class provides extensible query construction:

```typescript
// Architectural patterns
TeamQueryTemplates.architectureQuestion(component: string): string
TeamQueryTemplates.codeReviewRequest(file: string, line?: number): string
TeamQueryTemplates.dependencyCheck(dependency: string): string
TeamQueryTemplates.interfaceRequest(interfaceName: string): string
TeamQueryTemplates.bugHelp(error: string, context: string): string
TeamQueryTemplates.syncRequest(): string
```

---

## 9. Future Research Directions

### 9.1 Distributed Consensus

Current leader election lacks formal correctness guarantees. Future work could implement:
- **Raft consensus** for replicated state machine
- **CRDT-based** shared state for conflict-free synchronization
- **Vector clocks** for causal message ordering

### 9.2 Semantic Query Routing

Current broadcast model is inefficient. Intelligent routing could use:
- **Topic-based subscriptions** for targeted delivery
- **Capability-based routing** based on window context
- **ML-based classification** of query relevance

### 9.3 Multi-Model Orchestration

The architecture could extend to heterogeneous AI backends:
- **Model specialization**: Route queries to domain-specific models
- **Ensemble responses**: Aggregate answers from multiple models
- **Confidence-weighted voting**: Combine responses with uncertainty quantification

---

## 10. Conclusion

Claude Team represents a practical solution to the AI assistant isolation problem in multi-context development environments. The hub-and-spoke WebSocket architecture provides reasonable performance for small teams while maintaining implementation simplicity. Key limitations include lack of persistent state, absence of security mechanisms, and probabilistic (rather than deterministic) failure recovery.

The system serves as a foundation for more sophisticated multi-agent AI collaboration systems, with clear extension points for consensus protocols, intelligent routing, and heterogeneous model integration.

---

## References

1. Lamport, L. (1978). "Time, Clocks, and the Ordering of Events in a Distributed System." *Communications of the ACM*.
2. Ongaro, D., & Ousterhout, J. (2014). "In Search of an Understandable Consensus Algorithm." *USENIX ATC*.
3. Shapiro, M., et al. (2011). "Conflict-free Replicated Data Types." *SSS*.
4. VS Code Extension API Documentation. https://code.visualstudio.com/api
5. WebSocket Protocol RFC 6455. https://tools.ietf.org/html/rfc6455

---

## Appendix A: Message Type Definitions

```typescript
interface ClaudeQuery {
  id: string;
  senderId: string;
  senderName: string;
  query: string;
  context?: TeamContext;
  timestamp: number;
}

interface ClaudeResponse {
  queryId: string;
  responderId: string;
  responderName: string;
  response: string;
  timestamp: number;
}

interface WindowInfo {
  id: string;
  name: string;
  projectPath: string;
  isHub: boolean;
}

interface TeamContext {
  projectName: string;
  currentFile?: string;
  recentFiles: string[];
  gitBranch?: string;
  errors: string[];
}

interface ClaudeTask {
  id: string;
  title: string;
  description: string;
  assignerId: string;
  assignerName: string;
  assigneeId: string;
  assigneeName: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  result?: string;
  timestamp: number;
}
```

---

## Appendix B: Build and Development

```bash
# Development workflow
npm install                 # Install dependencies
npm run watch              # Continuous compilation
F5                         # Launch extension host

# Production build
npm run compile            # One-time build
vsce package              # Create .vsix package

# Quality assurance
npm run lint              # Static analysis
```

---

*Document Version: 1.0*
*Last Updated: January 2026*
*Classification: Technical Specification*
