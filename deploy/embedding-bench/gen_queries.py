"""Write benchmark questions for sampled Textus passages with the local chat model (private, on monster)."""
import json, random, urllib.request
OLLAMA = 'http://localhost:11434'
rows = [json.loads(l) for l in open('corpus.jsonl')]
random.seed(7)
targets = random.sample([r for r in rows if r['lang'] == 'en'], 30) + random.sample([r for r in rows if r['lang'] == 'tr'], 15) + random.sample([r for r in rows if r['lang'] == 'de'], 15)
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
