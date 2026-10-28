CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  original_name text NOT NULL,
  size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  theme jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_workspace_created_idx ON templates(workspace_id, created_at DESC);
