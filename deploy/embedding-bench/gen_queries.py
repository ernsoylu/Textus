"""Write benchmark questions for sampled Textus passages with the local chat model (private, on monster)."""
import hashlib, json, urllib.request
OLLAMA = 'http://localhost:11434'
rows = [json.loads(l) for l in open('corpus.jsonl')]
# Reproducible spread-out picks: order passages by a hash of their ID (no PRNG needed).
def pick(lang, n):
    return sorted((r for r in rows if r['lang'] == lang), key=lambda r: hashlib.sha256(str(r['id']).encode()).hexdigest())[:n]
targets = pick('en', 30) + pick('tr', 15) + pick('de', 15)
NAMES = {'en': 'English', 'tr': 'Turkish', 'de': 'German'}
def ask(prompt):
    body = json.dumps({'model': 'qwen3.5:4b', 'prompt': prompt, 'format': 'json', 'stream': False, 'think': False, 'options': {'temperature': 0, 'num_ctx': 4096, 'num_predict': 300}}).encode()
    with urllib.request.urlopen(urllib.request.Request(OLLAMA + '/api/generate', body, {'Content-Type': 'application/json'}), timeout=120) as r:
        return json.loads(json.load(r)['response'])
queries = []
for i, t in enumerate(targets):
    langs = ['en', 'tr', 'de'] if t['lang'] == 'en' else [t['lang'], 'en']
    keys = ', '.join(f'"{l}": the question in {NAMES[l]}' for l in langs)
    prompt = (f"Passage ({NAMES[t['lang']]}):\n{t['text'][:1500]}\n\nWrite ONE specific question that a reader could ask and that this passage answers. "
              f"Use your own words; do not copy phrases longer than three words from the passage. Return JSON with keys {{{keys}}}.")
    try:
        out = ask(prompt)
    except Exception as e:
        print('skip', i, e, flush=True); continue
    for l in langs:
        q = out.get(l)
        if isinstance(q, str) and len(q) > 10:
            queries.append({'target': t['id'], 'passage_lang': t['lang'], 'query_lang': l, 'kind': 'same' if l == t['lang'] else 'cross', 'q': q})
    print(f'{i + 1}/60 questions written', flush=True)
json.dump(queries, open('queries.json', 'w'), ensure_ascii=False, indent=1)
print('queries:', len(queries))
