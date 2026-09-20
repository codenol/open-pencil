import json

data = json.load(open('/opt/open-pencil/data/ds-structure.json'))
components = data['components']

print('=== ИТОГ ===')
for key in sorted(data['progress'], key=int):
    p = data['progress'][key]
    print(f"уровень {p['level']} ({p['name']}): {p['marked']}/{p['total']}")

print()
for level in range(2, 11):
    items = [c for c in components if c['level'] == level]
    content = [c for c in items if not c['internal']]
    internal = [c for c in items if c['internal']]
    print(f"--- уровень {level}: всего {len(items)} (контентных {len(content)}, внутренних копий {len(internal)}) ---")
    for c in content[:6]:
        uses = ', '.join(c['uses'][:6])
        print(f"   {c['source']} {c['name'][:38]:38s} [{c['page'][:28]:28s}] ← {uses[:80]}")
    print()
