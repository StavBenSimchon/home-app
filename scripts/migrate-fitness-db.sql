-- Idempotent production fitness schema upgrade.
-- This script is additive: it never deletes, truncates, or rewrites user data.
BEGIN;

ALTER TABLE plan_entries
    ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE goals
    ADD COLUMN IF NOT EXISTS ai_response JSONB;

CREATE TABLE IF NOT EXISTS exercises (
    id UUID PRIMARY KEY,
    plan_entry_id UUID NOT NULL REFERENCES plan_entries(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sets INTEGER,
    reps INTEGER,
    weight DOUBLE PRECISION,
    duration_seconds INTEGER,
    order_index INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS reps_max INTEGER;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS rir_target INTEGER;

CREATE TABLE IF NOT EXISTS weight_entries (
    id UUID PRIMARY KEY,
    weight_kg DOUBLE PRECISION NOT NULL,
    fat_percentage DOUBLE PRECISION,
    muscle_percentage DOUBLE PRECISION,
    measured_at DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workout_sessions (
    id UUID PRIMARY KEY,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    plan_entry_id UUID REFERENCES plan_entries(id) ON DELETE SET NULL,
    activity_name VARCHAR(255) NOT NULL,
    performed_at DATE NOT NULL,
    duration_minutes INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Upgrade sessions created by the old plan-coupled schema.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS goal_id UUID;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS activity_name VARCHAR(255);
UPDATE workout_sessions ws
SET goal_id = pe.goal_id,
    activity_name = pe.activity
FROM plan_entries pe
WHERE pe.id = ws.plan_entry_id
  AND (ws.goal_id IS NULL OR ws.activity_name IS NULL);
ALTER TABLE workout_sessions ALTER COLUMN goal_id SET NOT NULL;
ALTER TABLE workout_sessions ALTER COLUMN activity_name SET NOT NULL;
ALTER TABLE workout_sessions ALTER COLUMN plan_entry_id DROP NOT NULL;
ALTER TABLE workout_sessions DROP CONSTRAINT IF EXISTS workout_sessions_plan_entry_id_fkey;
ALTER TABLE workout_sessions
    ADD CONSTRAINT workout_sessions_plan_entry_id_fkey
    FOREIGN KEY (plan_entry_id) REFERENCES plan_entries(id) ON DELETE SET NULL;
ALTER TABLE workout_sessions DROP CONSTRAINT IF EXISTS workout_sessions_goal_id_fkey;
ALTER TABLE workout_sessions
    ADD CONSTRAINT workout_sessions_goal_id_fkey
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS workout_exercise_logs (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    source_exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
    exercise_name VARCHAR(255) NOT NULL,
    performed_at DATE NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    target_sets INTEGER,
    target_reps INTEGER,
    target_reps_max INTEGER,
    target_weight DOUBLE PRECISION,
    target_rir INTEGER,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS set_logs (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_log_id UUID REFERENCES workout_exercise_logs(id) ON DELETE CASCADE,
    exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
    set_number INTEGER NOT NULL,
    weight DOUBLE PRECISION,
    reps INTEGER,
    rir INTEGER,
    completed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS exercise_log_id UUID;

-- Snapshot all existing logs before relaxing their mutable source FK.
INSERT INTO workout_exercise_logs (
    id, session_id, source_exercise_id, exercise_name, performed_at,
    order_index, target_sets, target_reps, target_reps_max, target_weight,
    target_rir, completed_at, created_at, updated_at
)
SELECT
    gen_random_uuid(),
    sl.session_id,
    sl.exercise_id,
    ex.name,
    ws.performed_at,
    ex.order_index,
    ex.sets,
    ex.reps,
    ex.reps_max,
    ex.weight,
    ex.rir_target,
    CASE WHEN ex.completed OR ws.status = 'completed' THEN MAX(sl.updated_at) ELSE NULL END,
    MIN(sl.created_at),
    MAX(sl.updated_at)
FROM set_logs sl
JOIN workout_sessions ws ON ws.id = sl.session_id
JOIN exercises ex ON ex.id = sl.exercise_id
WHERE sl.exercise_log_id IS NULL
GROUP BY sl.session_id, sl.exercise_id, ex.name, ws.performed_at, ex.order_index,
         ex.sets, ex.reps, ex.reps_max, ex.weight, ex.rir_target,
         ex.completed, ws.status
ON CONFLICT (id) DO NOTHING;

UPDATE set_logs sl
SET exercise_log_id = wel.id
FROM workout_exercise_logs wel
WHERE wel.session_id = sl.session_id
  AND wel.source_exercise_id = sl.exercise_id
  AND sl.exercise_log_id IS NULL;

ALTER TABLE set_logs ALTER COLUMN exercise_id DROP NOT NULL;
ALTER TABLE set_logs DROP CONSTRAINT IF EXISTS set_logs_exercise_id_fkey;
ALTER TABLE set_logs
    ADD CONSTRAINT set_logs_exercise_id_fkey
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE SET NULL;
ALTER TABLE set_logs DROP CONSTRAINT IF EXISTS set_logs_exercise_log_id_fkey;
ALTER TABLE set_logs
    ADD CONSTRAINT set_logs_exercise_log_id_fkey
    FOREIGN KEY (exercise_log_id) REFERENCES workout_exercise_logs(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS coach_messages (
    id UUID PRIMARY KEY,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_insights (
    id UUID PRIMARY KEY,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL DEFAULT 'daily',
    severity VARCHAR(20) NOT NULL DEFAULT 'good',
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    action JSONB,
    payload JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS payload JSONB;

COMMIT;
