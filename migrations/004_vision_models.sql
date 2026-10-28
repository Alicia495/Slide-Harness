ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS vision_supported boolean NOT NULL DEFAULT false;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS vision_checked_at timestamptz;
