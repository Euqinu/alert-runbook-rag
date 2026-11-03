-- Approximate nearest-neighbour index for cosine distance (the <=> operator).
-- vector_cosine_ops must match the operator used in queries, or the index is never used.
-- Defaults left as-is on purpose: m = 16 (links per vector), ef_construction = 64 (build effort).
CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
