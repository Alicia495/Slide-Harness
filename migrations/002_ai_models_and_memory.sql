CREATE TABLE IF NOT EXISTS ai_models (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  label text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('azure', 'vllm')),
  model_name text NOT NULL,
  base_url text,
  resource_name text,
  api_version text,
  legacy_urls boolean NOT NULL DEFAULT false,
  api_key_encrypted text,
  context_window integer NOT NULL CHECK (context_window BETWEEN 512 AND 2000000),
  context_source text NOT NULL CHECK (context_source IN ('detected', 'manual')),
  temperature real NOT NULL DEFAULT 0.2,
  top_p real NOT NULL DEFAULT 1,
  max_output_tokens integer NOT NULL DEFAULT 4096,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_models_workspace_idx ON ai_models(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_memory (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  reflection text NOT NULL DEFAULT '',
  last_compacted_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  compaction_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
