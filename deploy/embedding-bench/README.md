# Embedding model benchmark

Compares Ollama embedding models on a sample of the real library, privately on monster. Rerun it before changing `OLLAMA_EMBED_MODEL`.

1. Export a passage sample (`{"id","asset","lang","text"}` JSON lines) from app102 to a `chmod 700` folder on monster as `corpus.jsonl`.
2. Hold the GPU lease on app102 so background embedding pauses: `UPDATE private.ai_lease SET holder=gen_random_uuid(), expires_at=clock_timestamp()+interval '3 hours';`
3. `python gen_queries.py` writes same- and cross-language questions with the local chat model; `python bench.py [model ...]` ranks every passage per question; `python summary.py` prints the table. The scripts need numpy.
4. Release the lease (`SET holder=NULL, expires_at='-infinity'`) and delete `corpus.jsonl`/`queries.json`; they contain library text.

Each model's query/document prompts in `bench.py` must match `EMBED_PROMPTS` in `supabase/functions/_shared/ollama.ts`.
