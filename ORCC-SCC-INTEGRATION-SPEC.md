# ORCC ↔ SCC Integration Specification
## Connecting OR Command Center WebUI to Surgical Command Center Backend

**Created:** 2026-01-20
**Author:** Claude Team Coordinator
**Status:** READY FOR IMPLEMENTATION

---

## Executive Summary

This document specifies how to:
1. **Connect ORCC** (static HTML prototype) to **SCC backend** (Node.js/Express/PostgreSQL)
2. **Retire the legacy SCC/VAI UI** and replace with ORCC as the primary interface
3. **Preserve existing data flows** while upgrading the user interface

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT STATE (TWO SEPARATE SYSTEMS)                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ORCC (UI Prototype)                     SCC/VAI (Production)                   │
│  ─────────────────────                   ───────────────────────                │
│  /home/tripp/ORCommandCenter             /home/tripp/surgical-command-center    │
│                                                                                  │
│  ┌─────────────────────┐                 ┌─────────────────────────────────┐   │
│  │ 11 Static HTML Files│                 │ Backend (Server1:3001)          │   │
│  │ • Patient Lists     │                 │ • Express.js API                │   │
│  │ • Task Manager      │                 │ • WebSocket server              │   │
│  │ • Workspaces (4)    │                 │ • PostgreSQL connection         │   │
│  │ • Planning Pages    │                 │                                 │   │
│  └─────────────────────┘                 │ Legacy UI (frontend_legacy/)    │   │
│           │                              │ • index.html                    │   │
│           │                              │ • patient-lookup.html           │   │
│           │                              │ • patient-input.html            │   │
│           ▼                              │                                 │   │
│  ┌─────────────────────┐                 │ VAI Iframes (100.75.237.36:8001)│   │
│  │    localStorage     │                 │ • Upload, Query, Synopsis, EMR  │   │
│  │  • selectedPatient  │                 └─────────────────────────────────┘   │
│  │  • planningData     │                              │                         │
│  │  • orcc_patients    │                              ▼                         │
│  └─────────────────────┘                 ┌─────────────────────────────────┐   │
│                                          │ PostgreSQL (100.101.184.20:5432)│   │
│         NO CONNECTION                    │ • patients (28 records)         │   │
│                                          │ • procedures                    │   │
│                                          │ • voice_transcripts             │   │
│                                          └─────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TARGET STATE (UNIFIED SYSTEM)                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ORCC (New Primary UI)                                                          │
│  Served from: localhost:3001 or Server1:3001                                    │
│  ───────────────────────────────────────────────                                │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        ORCC Frontend (Vite + React)                      │   │
│  │                                                                          │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │   │
│  │  │  Patient Lists  │  │  Task Manager   │  │      Workspaces         │  │   │
│  │  │  • Pre-op Queue │  │  • By Patient   │  │  • PAD (LE)             │  │   │
│  │  │  • Today's OR   │  │  • By Type      │  │  • Carotid              │  │   │
│  │  │  • Unsigned     │  │  • Urgency      │  │  • Aortic               │  │   │
│  │  └────────┬────────┘  └────────┬────────┘  │  • Venous               │  │   │
│  │           │                    │           └───────────┬─────────────┘  │   │
│  │           └────────────────────┴───────────────────────┘                │   │
│  │                                │                                         │   │
│  │                                ▼                                         │   │
│  │           ┌─────────────────────────────────────────────────────────┐   │   │
│  │           │              API Service Layer (fetch/axios)             │   │   │
│  │           │  • /api/patients, /api/procedures, /api/tasks            │   │   │
│  │           │  • WebSocket for real-time sync                          │   │   │
│  │           └─────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                        │
│                                        ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    SCC Backend (Express.js :3001)                        │   │
│  │                                                                          │   │
│  │  Existing Endpoints (Keep):         New Endpoints (Add):                 │   │
│  │  ─────────────────────────          ────────────────────                 │   │
│  │  GET  /api/patients                 GET  /api/tasks                      │   │
│  │  GET  /api/patients/search          POST /api/tasks                      │   │
│  │  POST /api/patients                 PUT  /api/tasks/:id                  │   │
│  │  PUT  /api/patients/:id             DELETE /api/tasks/:id                │   │
│  │  GET  /api/procedures               GET  /api/planning/:caseId           │   │
│  │  POST /api/procedures               POST /api/planning/:caseId           │   │
│  │  PUT  /api/procedures/:id           PUT  /api/planning/:caseId           │   │
│  │  GET  /api/vai/*                    GET  /api/vqi/:caseId                │   │
│  │  GET  /api/ultralinq/*              POST /api/vqi/:caseId                │   │
│  │  WebSocket (existing)                                                    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                        │
│                                        ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    PostgreSQL (100.101.184.20:5432)                      │   │
│  │                                                                          │   │
│  │  Existing Tables:                   New Tables (Add):                    │   │
│  │  ────────────────                   ─────────────────                    │   │
│  │  patients (28 records)              tasks                                │   │
│  │  procedures                         case_planning                        │   │
│  │  voice_transcripts                  vqi_submissions                      │   │
│  │                                     operative_notes                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  VAI/PlaudAI (100.75.237.36:8001) - KEEP AS-IS, access via /api/vai proxy      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### 1. Patient Object (SCC → ORCC)

**SCC Database Schema (existing):**
```sql
patients:
  id              UUID PRIMARY KEY
  mrn             STRING UNIQUE NOT NULL  -- "MRN-123456"
  first_name      STRING NOT NULL
  last_name       STRING NOT NULL
  date_of_birth   DATE NOT NULL
  gender          ENUM (male/female/other/unknown)
  -- ... additional demographics
```

**ORCC localStorage Format (current):**
```javascript
selectedPatient = {
  id: "p1",                           // Internal ID
  mrn: "MRN-001234",                  // MRN
  name: "Smith, John",                // Last, First format
  dos: "01/15/2026",                  // Date of Surgery
  procedure: "RIGHT SFA Angioplasty", // Planned procedure
  diagnosis: "I70.25 - CLI",          // ICD code + description
  anatomy: "SFA Occlusion, 2-vessel", // Anatomy summary
  ready: true,                        // Ready for surgery
  location: "asc" | "hospital"        // Facility
}
```

**Mapping Required:**
```javascript
// Transform SCC patient → ORCC format
function sccToOrcc(sccPatient, sccProcedure) {
  return {
    id: sccPatient.id,
    mrn: sccPatient.mrn,
    name: `${sccPatient.last_name}, ${sccPatient.first_name}`,
    dos: formatDate(sccProcedure?.procedure_date),
    procedure: sccProcedure?.procedure_type || '',
    diagnosis: sccPatient.medical_history || '',
    anatomy: getAnatomySummary(sccProcedure),
    ready: sccProcedure?.status === 'scheduled',
    location: determineLocation(sccProcedure?.procedure_type)
  };
}
```

---

### 2. Planning Data Structure

**ORCC planningData (current localStorage):**
```javascript
planningData = {
  procDate: "2026-01-20",
  vesselData: {
    "r_cia": { status: "patent" | "stenosis" | "occluded", notes: "" },
    "r_eia": { status: "patent", notes: "" },
    "r_cfa": { status: "patent", notes: "" },
    "r_sfa": { status: "occluded", notes: "CTO 8cm" },
    "r_popliteal": { status: "patent", notes: "" },
    "r_at": { status: "patent", notes: "" },
    "r_pt": { status: "occluded", notes: "" },
    "r_peroneal": { status: "patent", notes: "" },
    // ... left side vessels
  },
  procedure: {
    side: "right" | "left" | "bilateral",
    rutherford: "r1" | "r2" | "r3" | "r4" | "r5" | "r6",
    accessSite: "l_cfa" | "r_cfa" | "radial" | "brachial",
    anesthesia: "mac_local" | "moderate" | "general",
    outflow: { at: "patent", pt: "occluded", peroneal: "patent" }
  },
  interventions: [
    { vessel: "SFA", intervention: "pta_stent" },
    { vessel: "Popliteal", intervention: "pta" }
  ]
}
```

**SCC procedures table JSONB columns (existing):**
```sql
procedures:
  -- Vessel JSONB columns (one per vessel)
  common_iliac     JSONB  -- {stenosis, occlusion, treatment, tasc}
  external_iliac   JSONB
  common_femoral   JSONB
  superficial_femoral JSONB  -- {stenosis, occlusion_length, treatment, tasc}
  profunda         JSONB
  popliteal        JSONB
  anterior_tibial  JSONB  -- {stenosis, occlusion, runoff_score}
  posterior_tibial JSONB
  peroneal         JSONB
```

**Mapping Required (ORCC vesselData ↔ SCC vessel columns):**
```javascript
// ORCC key → SCC column
const vesselMapping = {
  'r_cia': 'common_iliac',
  'r_eia': 'external_iliac',
  'r_cfa': 'common_femoral',
  'r_sfa': 'superficial_femoral',
  'r_profunda': 'profunda',
  'r_popliteal': 'popliteal',
  'r_at': 'anterior_tibial',
  'r_pt': 'posterior_tibial',
  'r_peroneal': 'peroneal',
  // Left side uses same columns (procedure_side indicates which)
};

// Transform ORCC → SCC
function orccToSccVessel(orccVessel) {
  return {
    stenosis: orccVessel.status === 'stenosis' ? 'present' : null,
    occlusion: orccVessel.status === 'occluded' ? 'CTO' : null,
    occlusion_length: orccVessel.notes?.match(/(\d+)\s*cm/)?.[1] || null,
    treatment: null,  // Updated after procedure
    notes: orccVessel.notes
  };
}

// Transform SCC → ORCC
function sccToOrccVessel(sccVessel) {
  let status = 'patent';
  if (sccVessel?.occlusion) status = 'occluded';
  else if (sccVessel?.stenosis) status = 'stenosis';

  return {
    status,
    notes: sccVessel?.notes || ''
  };
}
```

---

### 3. Tasks Data Structure

**ORCC Task (needed):**
```javascript
task = {
  id: "task-uuid",
  patientId: "patient-uuid",
  caseId: "case-uuid",
  title: "Call for cardiac clearance",
  description: "Obtain clearance from cardiology",
  taskType: "call" | "schedule" | "order" | "review",
  dueDate: "2026-01-22",
  status: "pending" | "completed",
  urgency: "normal" | "urgent",
  completedAt: null
}
```

**New Database Table Required:**
```sql
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID REFERENCES patients(id),
  case_id         UUID REFERENCES procedures(id),
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  task_type       VARCHAR(20),  -- 'call', 'schedule', 'order', 'review'
  due_date        DATE,
  status          VARCHAR(20) DEFAULT 'pending',
  urgency         VARCHAR(20) DEFAULT 'normal',
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tasks_patient ON tasks(patient_id);
CREATE INDEX idx_tasks_case ON tasks(case_id);
CREATE INDEX idx_tasks_status ON tasks(status);
```

---

## API Endpoints

### Existing SCC Endpoints (KEEP)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/patients` | GET | List all patients |
| `/api/patients/search` | GET | Search by lastName |
| `/api/patients/:id` | GET | Get patient by ID |
| `/api/patients` | POST | Create patient |
| `/api/patients/:id` | PUT | Update patient |
| `/api/procedures` | GET | List procedures |
| `/api/procedures/:id` | GET | Get procedure |
| `/api/procedures` | POST | Create procedure |
| `/api/procedures/:id` | PUT | Update procedure |
| `/api/procedures/:id/vessel` | PATCH | Update vessel data |
| `/api/vai/*` | * | Proxy to VAI service |
| `/api/ultralinq/*` | * | UltraLinq integration |
| `/api/workflow/*` | * | Comprehensive workflows |

### New Endpoints Required (ADD)

```javascript
// TASKS
GET    /api/tasks                     // List all tasks (filterable)
GET    /api/tasks/patient/:patientId  // Tasks for patient
GET    /api/tasks/case/:caseId        // Tasks for case
POST   /api/tasks                     // Create task
PUT    /api/tasks/:id                 // Update task
PATCH  /api/tasks/:id/complete        // Mark complete
DELETE /api/tasks/:id                 // Delete task

// PLANNING
GET    /api/planning/:caseId          // Get planning data
POST   /api/planning/:caseId          // Save planning data
PUT    /api/planning/:caseId          // Update planning

// VQI (optional Phase 3)
GET    /api/vqi/:caseId               // Get VQI form
POST   /api/vqi/:caseId               // Create VQI
PUT    /api/vqi/:caseId               // Update VQI
POST   /api/vqi/:caseId/submit        // Submit to registry
```

---

## WebSocket Integration

**Existing SCC WebSocket Protocol:**
```javascript
// Client → Server
{ type: 'register', clientType: 'ui' }
{ type: 'subscribe_procedure', procedureId: 'uuid' }
{ type: 'field_update', procedureId: 'uuid', field: 'sfa_stenosis', value: '80%' }
{ type: 'procedure_update', procedureId: 'uuid', updates: {...} }

// Server → Client
{ type: 'registered', clientId: 'xxx', clientType: 'ui' }
{ type: 'subscribed', procedureId: 'uuid' }
{ type: 'field_updated', field: 'xxx', value: 'xxx', procedureId: 'xxx' }
{ type: 'procedure_saved', procedureId: 'uuid' }
```

**ORCC Integration:**
```javascript
// In ORCC, add websocket-client.js
class SCCWebSocket {
  constructor() {
    this.ws = new WebSocket('ws://localhost:3001');
    this.procedureId = null;
  }

  connect() {
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'register', clientType: 'ui' }));
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };
  }

  subscribeToProcedure(procedureId) {
    this.procedureId = procedureId;
    this.ws.send(JSON.stringify({ type: 'subscribe_procedure', procedureId }));
  }

  sendFieldUpdate(field, value) {
    this.ws.send(JSON.stringify({
      type: 'field_update',
      procedureId: this.procedureId,
      field,
      value
    }));
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'field_updated':
        // Update local form field
        updateFormField(msg.field, msg.value);
        break;
      case 'procedure_saved':
        showNotification('Procedure saved');
        break;
    }
  }
}
```

---

## Implementation Steps

### Phase 1: API Service Layer (ORCC)
Create `/ORCommandCenter/js/api-service.js`:

```javascript
const API_BASE = 'http://localhost:3001/api';

export const PatientAPI = {
  list: () => fetch(`${API_BASE}/patients`).then(r => r.json()),
  search: (lastName) => fetch(`${API_BASE}/patients/search?lastName=${lastName}`).then(r => r.json()),
  get: (id) => fetch(`${API_BASE}/patients/${id}`).then(r => r.json()),
  create: (data) => fetch(`${API_BASE}/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
};

export const ProcedureAPI = {
  list: () => fetch(`${API_BASE}/procedures`).then(r => r.json()),
  get: (id) => fetch(`${API_BASE}/procedures/${id}`).then(r => r.json()),
  create: (data) => fetch(`${API_BASE}/procedures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  updateVessel: (id, vesselData) => fetch(`${API_BASE}/procedures/${id}/vessel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vesselData)
  }).then(r => r.json()),
};

export const TaskAPI = {
  list: (filters) => fetch(`${API_BASE}/tasks?${new URLSearchParams(filters)}`).then(r => r.json()),
  forPatient: (patientId) => fetch(`${API_BASE}/tasks/patient/${patientId}`).then(r => r.json()),
  create: (data) => fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  complete: (id) => fetch(`${API_BASE}/tasks/${id}/complete`, { method: 'PATCH' }).then(r => r.json()),
};
```

### Phase 2: Replace localStorage (ORCC)

```javascript
// Before (localStorage)
function selectPatient(patient) {
  localStorage.setItem('selectedPatient', JSON.stringify(patient));
  window.location.href = 'workspace.html';
}

// After (API + sessionStorage for navigation)
async function selectPatient(patientId) {
  const patient = await PatientAPI.get(patientId);
  const procedure = await ProcedureAPI.getForPatient(patientId);

  // Transform to ORCC format
  const orccPatient = sccToOrcc(patient, procedure);

  // Store in session for page navigation
  sessionStorage.setItem('currentPatient', JSON.stringify(orccPatient));
  sessionStorage.setItem('currentProcedureId', procedure.id);

  window.location.href = routeToWorkspace(orccPatient);
}
```

### Phase 3: Add Task Endpoints (SCC Backend)

Create `/surgical-command-center/backend/routes/tasks.js`:

```javascript
const express = require('express');
const router = express.Router();
const { Task } = require('../models');

// GET /api/tasks
router.get('/', async (req, res) => {
  const { status, urgency, patientId, caseId } = req.query;
  const where = {};
  if (status) where.status = status;
  if (urgency) where.urgency = urgency;
  if (patientId) where.patient_id = patientId;
  if (caseId) where.case_id = caseId;

  const tasks = await Task.findAll({ where, order: [['due_date', 'ASC']] });
  res.json(tasks);
});

// POST /api/tasks
router.post('/', async (req, res) => {
  const task = await Task.create(req.body);
  res.status(201).json(task);
});

// PATCH /api/tasks/:id/complete
router.patch('/:id/complete', async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'completed';
  task.completed_at = new Date();
  await task.save();
  res.json(task);
});

module.exports = router;
```

---

## VAI Integration (Keep Existing)

VAI continues to work through SCC proxy endpoints. No changes needed.

```javascript
// Existing flow (KEEP)
SCC Frontend → /api/vai/* → SCC Backend → VAI (100.75.237.36:8001)

// ORCC uses same proxy
ORCC → /api/vai/patients → SCC Backend → VAI
ORCC → /api/vai/synopsis → SCC Backend → VAI
```

---

## Retiring Legacy SCC UI

### Files to Deprecate
```
/surgical-command-center/backend/frontend_legacy/
├── index.html           → Replaced by ORCC-index.html
├── patient-lookup.html  → Replaced by surgical-command-center-page1.html
├── patient-input.html   → Replaced by Add Patient modal in ORCC
└── js/                  → Replaced by ORCC js/
```

### Migration Steps
1. Add CORS for ORCC domain to SCC backend
2. Test all ORCC pages against SCC API
3. Update SCC to serve ORCC as primary UI
4. Keep legacy UI at `/legacy/*` for transition
5. Remove legacy UI after 30 days

---

## Summary

| Component | Current | Target |
|-----------|---------|--------|
| **UI** | ORCC: localStorage, SCC: legacy HTML | ORCC as primary, connected to SCC API |
| **Backend** | SCC on Server1 | Same, add tasks/planning endpoints |
| **Database** | PostgreSQL (patients, procedures) | Add tasks, case_planning tables |
| **Real-time** | SCC WebSocket | ORCC connects to same WebSocket |
| **VAI** | Iframe + proxy | Keep as-is, ORCC uses same proxy |

---

## Questions for Team

1. **ORCC React Migration:** Should ORCC convert from static HTML to React/Vite to match SCC client architecture?
2. **Task Defaults:** What default tasks should auto-create for each procedure type?
3. **VQI Priority:** Is VQI integration Phase 2 or Phase 3?

---

*Document version 1.0 - Ready for review and implementation*
