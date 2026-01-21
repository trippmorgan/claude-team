# SCC → PlaudAI Migration Specification

**Created:** 2026-01-21
**Status:** IN PROGRESS
**Decision:** Retire SCC Node server, consolidate all backend functionality into PlaudAI

---

## Executive Summary

The Surgical Command Center (SCC) Node.js backend on port 3001 is being retired. All backend functionality will be consolidated into PlaudAI (port 8001) on Server1. ORCC becomes the primary frontend, replacing the SCC React dashboard.

### Key Decision Points

| Question | Decision | Rationale |
|----------|----------|-----------|
| Keep SCC Node? | **NO - RETIRE** | Broken DB auth, redundant with PlaudAI |
| Keep React Dashboard? | **NO - RETIRE** | User prefers ORCC |
| Keep PostgreSQL? | **YES** | All data preserved |
| Keep PlaudAI? | **YES - EXPAND** | Working DB connection, AI processing |
| Keep ORCC? | **YES - PRIMARY UI** | User-preferred interface |

---

## Architecture Comparison

### Before (Broken)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT STATE (BROKEN)                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

  Client Machine                         Server1 (100.75.237.36)
  ──────────────                         ──────────────────────────

  ORCC Frontend                          SCC Node (Port 3001)
  ┌─────────────────────┐                ┌─────────────────────────────────┐
  │ HTML/JS             │───────────────▶│ Express.js                      │
  │ localStorage        │                │ └── DB: scc_user (WRONG PWD!)   │──────X
  └─────────────────────┘                └─────────────────────────────────┘
                                                                              │
                                         PlaudAI (Port 8001)                  │
                                         ┌─────────────────────────────────┐  │
                                         │ FastAPI                         │  │
                                         │ └── DB: (CORRECT PASSWORD)      │──┼──▶ PostgreSQL
                                         └─────────────────────────────────┘  │     :5432
                                                                              │
                                                                              X
                                                          (SCC can't connect to DB)
```

### After (Clean)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TARGET STATE (CLEAN)                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

  Client Machine                         Server1 (100.75.237.36)
  ──────────────                         ──────────────────────────

  ORCC Frontend                          PlaudAI (Port 8001) - UNIFIED BACKEND
  ┌─────────────────────┐                ┌─────────────────────────────────┐
  │ Patient Lists       │───────────────▶│ GET  /api/patients              │
  │ Task Manager        │───────────────▶│ GET  /api/tasks                 │
  │ Workspaces          │───────────────▶│ GET  /api/procedures            │
  │ Planning Pages      │───────────────▶│ POST /api/planning/{caseId}     │
  │                     │                │                                  │
  │ js/api-client.js    │                │ AI Processing:                   │
  │ (fetch to :8001)    │───────────────▶│ POST /api/parse                 │
  │                     │                │ POST /api/synopsis              │
  │ js/websocket.js     │◀─────────────▶│ WebSocket /ws                   │
  └─────────────────────┘                │                                  │
                                         │ Shadow Coder (migrated):        │
                                         │ POST /api/shadow-coder/*        │
                                         └─────────────────────────────────┘
                                                        │
                                                        ▼
                                         ┌─────────────────────────────────┐
                                         │ PostgreSQL (Port 5432)          │
                                         │ ├── patients (28 records)       │
                                         │ ├── procedures (24 records)     │
                                         │ ├── tasks (NEW)                 │
                                         │ ├── case_planning (NEW)         │
                                         │ └── audit_logs (897 HIPAA)      │
                                         └─────────────────────────────────┘

  SCC Node (Port 3001) = STOPPED
```

---

## Migration Phases

### Phase 1: PlaudAI Backend Expansion
**Owner:** Server1 Claude (PlaudAI)
**Estimated Effort:** Medium
**Dependencies:** None

| Task ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| P1-1 | Add `/api/tasks` GET endpoint | ⬜ Pending | List all tasks, filter by status/patient |
| P1-2 | Add `/api/tasks` POST endpoint | ⬜ Pending | Create new task |
| P1-3 | Add `/api/tasks/{id}` PUT endpoint | ⬜ Pending | Update task |
| P1-4 | Add `/api/tasks/{id}/complete` PATCH | ⬜ Pending | Mark task complete |
| P1-5 | Add `/api/tasks/patient/{patientId}` GET | ⬜ Pending | Tasks for specific patient |
| P1-6 | Create `tasks` database table | ⬜ Pending | See schema below |
| P1-7 | Create `case_planning` database table | ⬜ Pending | See schema below |
| P1-8 | Add `/api/planning/{caseId}` GET | ⬜ Pending | Get planning data |
| P1-9 | Add `/api/planning/{caseId}` POST/PUT | ⬜ Pending | Save planning data |
| P1-10 | Add WebSocket server `/ws` | ⬜ Pending | Real-time sync |
| P1-11 | Migrate Shadow Coder to `/api/shadow-coder/*` | ⬜ Pending | From SCC codebase |

### Phase 2: ORCC Frontend Update
**Owner:** ORCC Claude (local machine)
**Estimated Effort:** Low
**Dependencies:** Phase 1 completion

| Task ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| O2-1 | Verify `api-client.js` points to :8001 | ✅ Done | Already configured |
| O2-2 | Add TaskAPI to api-client | ⬜ Pending | Wait for P1-1..P1-5 |
| O2-3 | Add PlanningAPI to api-client | ⬜ Pending | Wait for P1-8..P1-9 |
| O2-4 | Add `websocket-client.js` | ⬜ Pending | Wait for P1-10 |
| O2-5 | Test patient list with live data | ⬜ Pending | |
| O2-6 | Test workspace save via API | ⬜ Pending | |
| O2-7 | Create Larry Taylor test patient | ⬜ Pending | Waiting on POST fix |

### Phase 3: SCC Node Retirement
**Owner:** Server1 Claude
**Estimated Effort:** Low
**Dependencies:** Phase 1 & 2 complete, all tests passing

| Task ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| R3-1 | Stop SCC Node service | ⬜ Pending | `sudo systemctl stop scc` |
| R3-2 | Disable SCC Node service | ⬜ Pending | `sudo systemctl disable scc` |
| R3-3 | Archive SCC codebase | ⬜ Pending | Keep for reference |
| R3-4 | Update all documentation | ⬜ Pending | Remove SCC references |

---

## Database Schema Changes

### New Table: `tasks`

```sql
CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID REFERENCES patients(id),
    case_id         UUID,  -- References procedures.id
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    task_type       VARCHAR(20),  -- 'call', 'schedule', 'order', 'review'
    due_date        DATE,
    status          VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'completed'
    urgency         VARCHAR(20) DEFAULT 'normal',   -- 'normal', 'urgent'
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tasks_patient ON tasks(patient_id);
CREATE INDEX idx_tasks_case ON tasks(case_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
```

### New Table: `case_planning`

```sql
CREATE TABLE case_planning (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure_id    UUID UNIQUE REFERENCES procedures(id),
    vessel_data     JSONB,        -- Full vessel status map from ORCC
    procedure_params JSONB,       -- side, rutherford, access, anesthesia
    interventions   JSONB,        -- Array of planned interventions
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_case_planning_procedure ON case_planning(procedure_id);
```

### vessel_data JSONB Structure

```json
{
  "r_cia": { "status": "patent", "notes": "" },
  "r_eia": { "status": "patent", "notes": "" },
  "r_cfa": { "status": "patent", "notes": "" },
  "r_sfa": { "status": "occluded", "notes": "CTO 8cm" },
  "r_popliteal": { "status": "stenosis", "stenosis_percent": "70%", "notes": "" },
  "r_at": { "status": "patent", "notes": "" },
  "r_pt": { "status": "occluded", "notes": "" },
  "r_peroneal": { "status": "patent", "notes": "" },
  "l_cia": { "status": "patent", "notes": "" },
  // ... left side
}
```

### procedure_params JSONB Structure

```json
{
  "side": "right",
  "rutherford": "r4",
  "accessSite": "l_cfa",
  "anesthesia": "mac_local",
  "outflow": {
    "at": "patent",
    "pt": "occluded",
    "peroneal": "patent"
  }
}
```

### interventions JSONB Structure

```json
[
  {
    "vessel": "SFA",
    "intervention": "pta_stent",
    "device": "6mm x 100mm stent",
    "notes": ""
  },
  {
    "vessel": "Popliteal",
    "intervention": "pta",
    "balloon": "5mm x 80mm",
    "notes": ""
  }
]
```

---

## API Specifications

### Tasks API

#### GET /api/tasks
List all tasks with optional filters.

**Query Parameters:**
- `status`: Filter by status ('pending', 'completed')
- `urgency`: Filter by urgency ('normal', 'urgent')
- `patient_id`: Filter by patient
- `case_id`: Filter by case/procedure

**Response:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "patient_id": "uuid",
      "case_id": "uuid",
      "title": "Call for cardiac clearance",
      "description": "Contact cardiology for pre-op clearance",
      "task_type": "call",
      "due_date": "2026-01-25",
      "status": "pending",
      "urgency": "normal",
      "completed_at": null,
      "created_at": "2026-01-21T12:00:00Z",
      "updated_at": "2026-01-21T12:00:00Z"
    }
  ],
  "count": 1
}
```

#### POST /api/tasks
Create a new task.

**Request Body:**
```json
{
  "patient_id": "uuid",
  "case_id": "uuid",
  "title": "Call for cardiac clearance",
  "description": "Contact cardiology for pre-op clearance",
  "task_type": "call",
  "due_date": "2026-01-25",
  "urgency": "normal"
}
```

#### PATCH /api/tasks/{id}/complete
Mark a task as completed.

**Response:**
```json
{
  "id": "uuid",
  "status": "completed",
  "completed_at": "2026-01-21T14:30:00Z"
}
```

### Planning API

#### GET /api/planning/{caseId}
Get planning data for a case.

**Response:**
```json
{
  "id": "uuid",
  "procedure_id": "uuid",
  "vessel_data": { ... },
  "procedure_params": { ... },
  "interventions": [ ... ],
  "created_at": "2026-01-21T12:00:00Z",
  "updated_at": "2026-01-21T12:00:00Z"
}
```

#### POST /api/planning/{caseId}
Create or update planning data.

**Request Body:**
```json
{
  "vessel_data": { ... },
  "procedure_params": { ... },
  "interventions": [ ... ]
}
```

---

## WebSocket Protocol

### Connection
```javascript
const ws = new WebSocket('ws://100.75.237.36:8001/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'register',
    clientType: 'orcc-ui',
    clientId: 'unique-client-id'
  }));
};
```

### Message Types

**Client → Server:**
```json
{ "type": "register", "clientType": "orcc-ui", "clientId": "xxx" }
{ "type": "subscribe_procedure", "procedureId": "uuid" }
{ "type": "field_update", "procedureId": "uuid", "field": "sfa_stenosis", "value": "80%" }
{ "type": "procedure_update", "procedureId": "uuid", "updates": {...} }
```

**Server → Client:**
```json
{ "type": "registered", "clientId": "xxx" }
{ "type": "subscribed", "procedureId": "uuid" }
{ "type": "field_updated", "procedureId": "uuid", "field": "xxx", "value": "xxx" }
{ "type": "procedure_saved", "procedureId": "uuid" }
```

---

## Shadow Coder Migration

### Current Location (SCC)
```
/home/tripp/surgical-command-center/backend/scc-shadow-coder/
├── index.js
├── README.md
├── INTEGRATION.js
└── test/
```

### Target Location (PlaudAI)
```
/home/server1/plaudai_uploader/routers/shadow_coder.py
```

### Endpoints to Migrate

| SCC Endpoint | PlaudAI Endpoint |
|--------------|------------------|
| `/shadow-coder/prompt` | `/api/shadow-coder/prompt` |
| `/shadow-coder/validate` | `/api/shadow-coder/validate` |
| `/shadow-coder/submit` | `/api/shadow-coder/submit` |

---

## Port Reference

### Final Port Mapping

| Port | Service | Location | Status |
|------|---------|----------|--------|
| 8001 | PlaudAI (Primary Backend) | Server1 | ✅ Active |
| 5432 | PostgreSQL | Server1 | ✅ Active |
| 4847 | Claude Team Hub | Local | ✅ Active |
| 8080 | Browser Bridge (CPT/ICD-10) | Local | ✅ Active |
| 3001 | ~~SCC Node~~ | Server1 | 🚫 RETIRED |

---

## Rollback Plan

If migration fails, we can restore SCC by:

1. Fix the `scc_user` password in PostgreSQL:
   ```sql
   ALTER USER scc_user PASSWORD 'new_correct_password';
   ```

2. Update SCC's `.env`:
   ```
   DB_PASSWORD=new_correct_password
   ```

3. Restart SCC:
   ```bash
   sudo systemctl start scc
   ```

However, the goal is to complete the PlaudAI consolidation and NOT need this rollback.

---

## Success Criteria

- [ ] All ORCC pages load data from PlaudAI
- [ ] Task management works (CRUD)
- [ ] Case planning saves and loads correctly
- [ ] WebSocket real-time sync works
- [ ] Shadow Coder functions in PlaudAI
- [ ] SCC Node service stopped and disabled
- [ ] All tests passing
- [ ] Larry Taylor test case works end-to-end

---

## Team Communication

### Channels
- **Primary:** `SHARED_WORKSPACE.md` files in each project
- **Secondary:** Claude Team Hub (port 4847)

### Progress Updates
All team members should update their respective `SHARED_WORKSPACE.md` files when:
- Starting a task
- Completing a task
- Encountering blockers
- Needing help from another team member

---

*Document Version: 1.0*
*Created: 2026-01-21*
*Author: Claude Team Coordinator*
