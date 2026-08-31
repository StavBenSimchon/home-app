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
    plan_entry_id UUID NOT NULL REFERENCES plan_entries(id) ON DELETE CASCADE,
    performed_at DATE NOT NULL,
    duration_minutes INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS set_logs (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    weight DOUBLE PRECISION,
    reps INTEGER,
    rir INTEGER,
    completed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

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
