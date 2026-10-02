"""Compare embedding models on the Textus sample: recall@1/@10 and MRR per query type, speed and VRAM."""
import json, sys, time, urllib.request
import numpy as np
OLLAMA = 'http://localhost:11434'
# Each model's documented query/document prompt format.
MODELS = {
    'nomic-embed-text:latest': (lambda q: f'search_query: {q}', lambda d: f'search_document: {d}'),
    'embeddinggemma:latest': (lambda q: f'task: search result | query: {q}', lambda d: f'title: none | text: {d}'),
    'qwen3-embedding:0.6b': (lambda q: f'Instruct: Given a question, retrieve passages that answer it\nQuery: {q}', lambda d: d),
    'bge-m3:latest': (lambda q: q, lambda d: d),
    'snowflake-arctic-embed2:latest': (lambda q: f'query: {q}', lambda d: d),
}
rows = [json.loads(l) for l in open('corpus.jsonl')]
queries = json.load(open('queries.json'))
ids = [r['id'] for r in rows]
def embed(model, texts):
    out = []
    for i in range(0, len(texts), 16):
        body = json.dumps({'model': model, 'input': texts[i:i + 16], 'truncate': True, 'keep_alive': '10m'}).encode()
        with urllib.request.urlopen(urllib.request.Request(OLLAMA + '/api/embed', body, {'Content-Type': 'application/json'}), timeout=300) as r:
            out += json.load(r)['embeddings']
    m = np.array(out, dtype=np.float32)
    return m / np.linalg.norm(m, axis=1, keepdims=True)
results = {}
for model in (sys.argv[1:] or MODELS):
    q_fmt, d_fmt = MODELS[model]
    started = time.time()
    docs = embed(model, [d_fmt(r['text']) for r in rows])
    doc_secs = time.time() - started
    with urllib.request.urlopen(OLLAMA + '/api/ps') as r:
        vram = next((m['size_vram'] for m in json.load(r)['models'] if m['name'] == model), 0) / 2**30
    qs = embed(model, [q_fmt(q['q']) for q in queries])
    ranks = []
    for q, vec in zip(queries, qs):
        order = np.argsort(-(docs @ vec))
        ranks.append(int(np.where(np.array(ids)[order] == q['target'])[0][0]) + 1)
    groups = {}
    for q, rank in zip(queries, ranks):
        for key in ('all', q['kind'], f"{q['query_lang']}->{q['passage_lang']}"):
            groups.setdefault(key, []).append(rank)
    summary = {k: {'n': len(v), 'r@1': round(sum(r == 1 for r in v) / len(v), 3), 'r@10': round(sum(r <= 10 for r in v) / len(v), 3), 'mrr': round(sum(1 / r for r in v) / len(v), 3)} for k, v in groups.items()}
    results[model] = {'dims': int(docs.shape[1]), 'passages_per_sec': round(len(rows) / doc_secs, 1), 'vram_gib': round(vram, 2), 'scores': summary}
    print(json.dumps({model: results[model]}), flush=True)
    urllib.request.urlopen(urllib.request.Request(OLLAMA + '/api/generate', json.dumps({'model': model, 'keep_alive': 0}).encode(), {'Content-Type': 'application/json'})).read()
json.dump(results, open('results.json', 'w'), indent=1)
