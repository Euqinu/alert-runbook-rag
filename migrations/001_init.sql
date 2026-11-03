CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text        TEXT         NOT NULL,
  embedding   vector(1024) NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,

  source      TEXT NOT NULL,
  title       TEXT,
  alert_name  TEXT,
  url         TEXT NOT NULL,
  license     TEXT NOT NULL,

  doc_hash    TEXT NOT NULL,
  chunk_index INT  NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (url, chunk_index)
);
