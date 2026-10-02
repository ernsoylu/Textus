import json
for line in open('bench.log'):
    if not line.startswith('{'):
        print(line.strip()[:200]); continue
    for model, r in json.loads(line).items():
        s = r['scores']
        cells = ' '.join('%s=%.2f' % (k, s[k]['mrr']) for k in ('en->en', 'tr->tr', 'de->de', 'tr->en', 'de->en', 'en->tr', 'en->de') if k in s)
        print('%-31s dims=%-5d %6.1f/s vram=%.2fGiB | r@1=%.2f r@10=%.2f MRR=%.3f | same=%.3f cross=%.3f | %s' % (model, r['dims'], r['passages_per_sec'], r['vram_gib'], s['all']['r@1'], s['all']['r@10'], s['all']['mrr'], s['same']['mrr'], s['cross']['mrr'], cells))
