import json
from collections import Counter

data = json.load(open('/opt/open-pencil/data/ds-structure.json'))
entities = data['entities']

print('=== итог ===')
for key in sorted(data['progress'], key=int):
    p = data['progress'][key]
    print(f"уровень {p['level']}: {p['marked']}/{p['total']}")

print()
print('=== примеры по уровням (свои сущности) ===')
for level in range(1, 12):
    items = [e for e in entities if e['level'] == level and not e['internal']]
    if not items:
        continue
    print(f"-- уровень {level} --")
    for e in items[:6]:
        props = f" | свойства: {', '.join(e['properties'].keys())}" if e.get('properties') else ''
        uses = f" ← {', '.join(e['uses'][:4])}" if e['uses'] else ''
        print(f"   {e['kind']:9s} {e['name'][:30]:30s}{(' → токены ' + e['tokenGroup']) if e['tokenGroup'] else ''}{props}{uses}")
    print()

print('=== сверка с токенами (свои сущности с токен-группой) ===')
own = [e for e in entities if not e['internal']]
with_tokens = [e for e in own if e['tokenGroup']]
print(f"своих сущностей: {len(own)} | с токен-группой: {len(with_tokens)}")
for e in with_tokens[:10]:
    axes = e.get('tokenAxes') or []
    ax = ' | '.join('/'.join(a[:4]) for a in axes[:4])
    print(f"   {e['name'][:26]:26s} token={e['tokenGroup'][:18]:18s} свойства={','.join((e['properties'] or {}).keys())[:40]:40s} оси токенов: {ax[:60]}")

print()
print('=== копии из внешних библиотек ===')
copies = [e for e in entities if e['external']]
libs = Counter(e['external']['libraryKey'][:16] for e in copies)
print(f"копий: {len(copies)} | библиотек-источников: {len(libs)}")
for key, count in libs.most_common(6):
    print(f"   {key}…: {count}")
