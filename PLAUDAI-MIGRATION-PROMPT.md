# PlaudAI Migration Prompt - Complete SCC Backend Consolidation

**Created:** 2026-01-21
**From:** SCC Claude (surgical-command-center)
**To:** Server1 Claude (PlaudAI)
**Priority:** HIGH

---

## Executive Summary

You need to absorb ALL functionality from the SCC Node.js backend. This includes:
1. **Shadow Charge Coder** - AI-powered surgical coding compliance engine
2. **Voice Note Processing** - Plaud/Zapier transcript ingestion
3. **Clinical Facts System** - Truth map management for cases
4. **Rules Engine** - Compliance prompt generation
5. **Coding Evidence Service** - LCD/SCAI citation database
6. **Patient/Procedure APIs** - Core CRUD (you already have this)
7. **WebSocket Server** - Real-time sync for ORCC

---

## IMMEDIATE BLOCKER - FIX FIRST

**POST /api/patients returns 500 error**

```bash
# This fails with 500:
curl -X POST http://100.75.237.36:8001/api/patients \
  -H "Content-Type: application/json" \
  -d '{"mrn":"32016089","first_name":"Larry","last_name":"Taylor","date_of_birth":"1954-10-28"}'
```

**Action Required:**
1. Check uvicorn logs for traceback:
   ```bash
   journalctl -u plaudai -n 100 --no-pager | grep -i error
   # or wherever uvicorn logs go
   ```
2. Likely causes: unique constraint, missing required field with no default, session issue

---

## Phase 1: Database Schema Additions

### 1.1 Tasks Table (for ORCC Task Manager)

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
```

### 1.2 Case Planning Table (for ORCC Workspaces)

```sql
CREATE TABLE case_planning (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure_id    UUID UNIQUE REFERENCES procedures(id),
    vessel_data     JSONB,        -- Full vessel status map
    procedure_params JSONB,       -- side, rutherford, access, anesthesia
    interventions   JSONB,        -- Array of planned interventions
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_case_planning_procedure ON case_planning(procedure_id);
```

### 1.3 Shadow Coder Tables

```sql
-- Voice Notes from Plaud/Zapier
CREATE TABLE scc_voice_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID,
    transcript      TEXT NOT NULL,
    mrn             VARCHAR(50),
    patient_name    VARCHAR(200),
    status          VARCHAR(20) DEFAULT 'processing',  -- 'processing', 'extracted', 'failed'
    extracted_facts_raw JSONB,
    content_hash    VARCHAR(64) UNIQUE,  -- SHA-256 for deduplication
    provenance      JSONB,  -- source_type, webhook_id, etc.
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_voice_notes_case ON scc_voice_notes(case_id);
CREATE INDEX idx_voice_notes_mrn ON scc_voice_notes(mrn);
CREATE INDEX idx_voice_notes_status ON scc_voice_notes(status);

-- Clinical Facts (Truth Map)
CREATE TABLE scc_case_facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL,
    fact_type       VARCHAR(100) NOT NULL,  -- 'access_site', 'target_vessel', 'claudication', etc.
    value_json      JSONB NOT NULL,         -- Can store any type
    confidence      DECIMAL(3,2) DEFAULT 0.8,  -- 0.0 to 1.0
    source_type     VARCHAR(20),            -- 'voice_note', 'manual', 'ehr_import'
    source_id       UUID,                   -- Reference to source
    verified        BOOLEAN DEFAULT FALSE,
    verified_by     VARCHAR(100),
    superseded_at   TIMESTAMP,              -- NULL if current
    superseded_by   UUID,                   -- Reference to replacement fact
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_facts_case ON scc_case_facts(case_id);
CREATE INDEX idx_facts_type ON scc_case_facts(fact_type);
CREATE INDEX idx_facts_current ON scc_case_facts(case_id) WHERE superseded_at IS NULL;

-- Compliance Prompts
CREATE TABLE scc_prompt_instances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL,
    rule_id         VARCHAR(100) NOT NULL,  -- From ruleset (e.g., 'pad-access-site-required')
    severity        VARCHAR(10) NOT NULL,   -- 'block', 'warn', 'info'
    status          VARCHAR(20) DEFAULT 'active',  -- 'active', 'resolved', 'snoozed', 'dismissed'
    message         TEXT NOT NULL,
    details         TEXT,
    guideline_ref   VARCHAR(200),           -- LCD/NCD reference
    action_choices  JSONB,                  -- Array of available actions
    snoozed_until   TIMESTAMP,
    resolved_at     TIMESTAMP,
    resolution_type VARCHAR(20),            -- 'fact_added', 'dismissed', 'manual'
    resolution_note TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_prompts_case ON scc_prompt_instances(case_id);
CREATE INDEX idx_prompts_status ON scc_prompt_instances(status);
CREATE INDEX idx_prompts_rule ON scc_prompt_instances(rule_id);
```

---

## Phase 2: API Endpoints to Add

### 2.1 Tasks API (ORCC Task Manager)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | GET | List tasks (filter: status, urgency, patient_id) |
| `/api/tasks` | POST | Create task |
| `/api/tasks/{id}` | GET | Get task |
| `/api/tasks/{id}` | PUT | Update task |
| `/api/tasks/{id}/complete` | PATCH | Mark complete |
| `/api/tasks/patient/{patientId}` | GET | Tasks for patient |

### 2.2 Planning API (ORCC Workspaces)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/planning/{procedureId}` | GET | Get planning data |
| `/api/planning/{procedureId}` | POST | Create/update planning |
| `/api/planning/{procedureId}/vessel/{vesselId}` | PUT | Update single vessel |

### 2.3 Shadow Coder API

#### Voice Note Intake
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/intake/plaud` | POST | Plaud recorder webhook |
| `/api/intake/zapier` | POST | Zapier automation webhook |
| `/api/intake/batch` | POST | Batch import (up to 100) |
| `/api/intake/recent` | GET | Recent voice notes |
| `/api/intake/status/{noteId}` | GET | Processing status |

**Plaud/Zapier Payload:**
```json
{
  "transcript": "Patient is a 71-year-old male with rest pain...",
  "mrn": "32016089",
  "patient_name": "Larry Taylor",
  "source": "plaud_v2",
  "metadata": {}
}
```

#### Clinical Facts
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/facts/{caseId}` | GET | Get current fact map |
| `/api/facts/{caseId}` | POST | Add single fact |
| `/api/facts/{caseId}/batch` | POST | Add multiple facts |
| `/api/facts/{caseId}/history` | GET | Fact history |
| `/api/facts/{factId}/verify` | PUT | Verify fact |
| `/api/facts/{factId}` | DELETE | Supersede fact |

**Fact Payload:**
```json
{
  "fact_type": "claudication",
  "value_json": {"present": true, "distance_feet": 50},
  "confidence": 0.9,
  "source_type": "voice_note",
  "source_id": "uuid-of-voice-note"
}
```

#### Compliance Prompts
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prompts/{caseId}` | GET | Get all prompts for case |
| `/api/prompts/{caseId}/summary` | GET | Prompt counts by severity |
| `/api/prompts/{promptId}/action` | POST | Execute action |
| `/api/prompts/{promptId}/snooze` | POST | Snooze prompt |
| `/api/prompts/{promptId}/resolve` | POST | Resolve manually |
| `/api/prompts/evaluate/{caseId}` | POST | Re-run rules evaluation |

#### Coding Evidence
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/coding/check/{procedureId}` | GET | Pre-procedure doc check |
| `/api/coding/recommend` | POST | Generate CPT/ICD-10 recommendation |
| `/api/coding/cpt/{code}` | GET | CPT lookup with evidence |
| `/api/coding/icd10/{code}` | GET | ICD-10 lookup with evidence |
| `/api/coding/evidence/{ruleId}` | GET | Get LCD citation |

---

## Phase 3: Core Services to Implement

### 3.1 Transcript Extractor Service

Uses Claude API to extract clinical facts from voice transcripts.

**Python Implementation Pattern:**
```python
import anthropic
from typing import List, Dict

class TranscriptExtractorService:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)

    async def extract_pad_facts(self, transcript: str) -> List[Dict]:
        """Extract PAD clinical facts from transcript."""
        prompt = f"""Extract clinical facts from this surgical transcript.

Return JSON array with facts like:
- claudication (present, distance)
- rest_pain (present, location)
- tissue_loss (present, stage, location)
- abi (left, right)
- access_site (location)
- target_vessel (name)
- intervention (type, vessel, device)
- complication (type, severity)

Transcript:
{transcript}

Return only valid JSON array."""

        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse and return facts
        return json.loads(response.content[0].text)
```

### 3.2 Facts Service

Manages the clinical truth map for each case.

```python
class FactsService:
    def __init__(self, db_session):
        self.db = db_session

    async def get_fact_map(self, case_id: str) -> Dict[str, Any]:
        """Get current (non-superseded) facts for case."""
        facts = await self.db.query(SccCaseFact).filter(
            SccCaseFact.case_id == case_id,
            SccCaseFact.superseded_at.is_(None)
        ).all()

        return {f.fact_type: f.value_json for f in facts}

    async def add_fact(self, case_id: str, fact_type: str, value: Any,
                       confidence: float = 0.8, source_type: str = None,
                       source_id: str = None) -> SccCaseFact:
        """Add new fact, superseding any existing fact of same type."""
        # Supersede existing
        await self.db.query(SccCaseFact).filter(
            SccCaseFact.case_id == case_id,
            SccCaseFact.fact_type == fact_type,
            SccCaseFact.superseded_at.is_(None)
        ).update({SccCaseFact.superseded_at: datetime.utcnow()})

        # Create new
        fact = SccCaseFact(
            case_id=case_id,
            fact_type=fact_type,
            value_json=value,
            confidence=confidence,
            source_type=source_type,
            source_id=source_id
        )
        self.db.add(fact)
        await self.db.commit()
        return fact
```

### 3.3 Rules Engine Service

Evaluates clinical facts against compliance rules.

**Rule Format (from pad-2026.json):**
```json
{
  "id": "pad-access-site-required",
  "description": "Access site must be documented",
  "severity": "block",
  "when": {
    "fact": "procedure_started",
    "operator": "equals",
    "value": true
  },
  "require": {
    "fact": "access_site",
    "operator": "exists"
  },
  "prompt": {
    "message": "Document access site before procedure start",
    "guideline_ref": "LCD L35998 Section 4.2"
  },
  "actions": [
    {"type": "fact_set", "fact": "access_site", "label": "Set access site"},
    {"type": "snooze", "duration_minutes": 30, "label": "Remind in 30 min"}
  ]
}
```

```python
class RulesEngineService:
    def __init__(self, facts_service: FactsService):
        self.facts = facts_service
        self.rules = self._load_rules()

    def _load_rules(self) -> List[Dict]:
        """Load PAD-2026 ruleset."""
        # Load from file or database
        with open('rulesets/pad-2026.json') as f:
            return json.load(f)['rules']

    async def evaluate(self, case_id: str) -> List[Dict]:
        """Evaluate all rules against case facts, return triggered prompts."""
        fact_map = await self.facts.get_fact_map(case_id)
        prompts = []

        for rule in self.rules:
            if self._when_matches(rule.get('when'), fact_map):
                if not self._require_satisfied(rule.get('require'), fact_map):
                    prompts.append({
                        'rule_id': rule['id'],
                        'severity': rule['severity'],
                        'message': rule['prompt']['message'],
                        'guideline_ref': rule['prompt'].get('guideline_ref'),
                        'actions': rule.get('actions', [])
                    })

        return prompts

    def _when_matches(self, condition: Dict, facts: Dict) -> bool:
        """Check if 'when' condition is satisfied."""
        if not condition:
            return True  # Always evaluate if no when clause

        fact_value = facts.get(condition['fact'])
        op = condition['operator']
        expected = condition['value']

        if op == 'equals':
            return fact_value == expected
        elif op == 'exists':
            return fact_value is not None
        elif op == 'gt':
            return fact_value is not None and fact_value > expected
        # ... more operators

        return False
```

### 3.4 Coding Evidence Service

LCD/SCAI citation database with CPT/ICD-10 lookup.

```python
class CodingEvidenceService:
    def __init__(self):
        self.evidence = self._load_evidence()

    def _load_evidence(self) -> Dict:
        """Load coding dictionary."""
        with open('rulesets/coding-dictionary.json') as f:
            return json.load(f)

    def get_cpt_code(self, code: str) -> Dict:
        """Get CPT code with LCD evidence."""
        return self.evidence['cpt_codes'].get(code)

    def get_icd10_code(self, code: str) -> Dict:
        """Get ICD-10 code with medical necessity."""
        return self.evidence['icd10_codes'].get(code)

    def get_citation(self, citation_id: str) -> str:
        """Get LCD citation text."""
        return self.evidence['citations'].get(citation_id)

    def generate_coding_recommendation(self, facts: Dict) -> Dict:
        """Generate CPT/ICD-10 recommendation from case facts."""
        # Determine procedure type from facts
        # Match to appropriate codes
        # Return with evidence citations
        pass
```

---

## Phase 4: Load Static Data

### 4.1 PAD-2026 Ruleset

The full ruleset is at:
`/home/tripp/surgical-command-center/backend/scc-shadow-coder/rulesets/pad-2026.json`

Contains 72 rules covering:
- Pre-procedure requirements (access, consent, labs)
- Intra-procedure documentation (devices, measurements)
- Post-procedure (complications, closure, follow-up)

### 4.2 Coding Dictionary

The evidence database is at:
`/home/tripp/surgical-command-center/backend/scc-shadow-coder/rulesets/coding-dictionary.json`

Contains:
- 72 CPT codes (iliac, fem-pop, tibial, carotid, embolization)
- 52 ICD-10 codes (PAD, CLTI, carotid, renal, venous)
- 27 LCD citations from L35998 and CMS NCD 20.7

---

## Phase 5: WebSocket Server

For real-time ORCC sync.

```python
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Set

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}  # procedure_id -> connections

    async def connect(self, websocket: WebSocket, procedure_id: str):
        await websocket.accept()
        if procedure_id not in self.active_connections:
            self.active_connections[procedure_id] = set()
        self.active_connections[procedure_id].add(websocket)

    def disconnect(self, websocket: WebSocket, procedure_id: str):
        self.active_connections[procedure_id].discard(websocket)

    async def broadcast(self, procedure_id: str, message: dict):
        if procedure_id in self.active_connections:
            for connection in self.active_connections[procedure_id]:
                await connection.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/{procedure_id}")
async def websocket_endpoint(websocket: WebSocket, procedure_id: str):
    await manager.connect(websocket, procedure_id)
    try:
        while True:
            data = await websocket.receive_json()
            # Handle message types: field_update, procedure_update, subscribe
            if data['type'] == 'field_update':
                # Update database
                # Broadcast to all connected clients
                await manager.broadcast(procedure_id, {
                    'type': 'field_updated',
                    'field': data['field'],
                    'value': data['value'],
                    'updated_by': data.get('client_id')
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket, procedure_id)
```

---

## Migration Priority

```
CRITICAL (Week 1):
├── Fix POST /api/patients 500 error
├── Create tasks table + CRUD endpoints
├── Create case_planning table + CRUD endpoints
└── Basic WebSocket endpoint

HIGH (Week 2):
├── Shadow Coder tables (voice_notes, facts, prompts)
├── Intake endpoints (plaud, zapier)
├── Facts endpoints (get, add, batch)
└── Load PAD-2026 ruleset

MEDIUM (Week 3):
├── Rules engine service
├── Prompts endpoints
├── Coding evidence service
└── Coding endpoints

OPTIONAL (Later):
├── Batch import
├── Fact history/verification
├── UltraLinq connector
└── Telemetry
```

---

## Environment Variables Needed

```bash
# Required for Shadow Coder
ANTHROPIC_API_KEY=sk-ant-...  # Claude API for TranscriptExtractor

# Database (you have this)
DATABASE_URL=postgresql://...

# Optional
ULTRALINQ_URL=https://app.ultralinq.net
ULTRALINQ_USERNAME=...
ULTRALINQ_PASSWORD=...
```

---

## Reference Files

Copy these from SCC when implementing:

| File | Purpose |
|------|---------|
| `backend/scc-shadow-coder/services/TranscriptExtractor.js` | Claude extraction logic |
| `backend/scc-shadow-coder/services/FactsService.js` | Fact management |
| `backend/scc-shadow-coder/services/RulesEngine.js` | Rules evaluation |
| `backend/scc-shadow-coder/services/CodingEvidenceService.js` | LCD citations |
| `backend/scc-shadow-coder/rulesets/pad-2026.json` | 72 PAD rules |
| `backend/scc-shadow-coder/rulesets/coding-dictionary.json` | CPT/ICD-10 evidence |
| `backend/scc-shadow-coder/routes/intake.js` | Plaud/Zapier webhooks |
| `backend/scc-shadow-coder/routes/prompts.js` | Prompt management |
| `backend/scc-shadow-coder/routes/facts.js` | Fact management |
| `backend/scc-shadow-coder/routes/coding.js` | Coding evidence |

---

## Success Criteria

- [ ] POST /api/patients works (500 error fixed)
- [ ] Tasks CRUD works (ORCC Task Manager)
- [ ] Case planning CRUD works (ORCC Workspaces)
- [ ] WebSocket real-time updates work
- [ ] Voice note intake processes transcripts
- [ ] Facts can be added and queried
- [ ] Rules evaluation generates prompts
- [ ] Coding recommendations work

---

## Questions to Resolve

1. **ANTHROPIC_API_KEY:** Do you have access to a Claude API key for the transcript extractor?
2. **Rulesets:** Should I copy the JSON files to a shared location, or will you read from SCC codebase?
3. **WebSocket Path:** `/ws` or `/ws/{procedureId}`?

---

**Please respond in SHARED_WORKSPACE.md when you begin work.**

---

*Document Version: 1.0*
*Created: 2026-01-21*
*Author: SCC Claude*
