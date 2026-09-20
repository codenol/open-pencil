import json

data = json.load(open('/opt/open-pencil/data/ds-structure.json'))
components = data['components']

print('=== по источникам ===')
for source in data['sources']:
    print(f"{source['id']}: {source['components']} компонентов ({source['internalComponents']} внутренних), страниц: {source['pages']}")

print()
print('=== уровни: контентные (не internal) vs служебные ===')
by_level_content = {}
by_level_internal = {}
for c in components:
    bucket = by_level_internal if c['internal'] else by_level_content
    bucket[c['level']] = bucket.get(c['level'], 0) + 1
for level in sorted(set(by_level_content) | set(by_level_internal)):
    print(f"уровень {level}: контентных {by_level_content.get(level, 0)}, служебных {by_level_internal.get(level, 0)}")

print()
print('=== примеры: уровень 1 (атомы, контентные) ===')
content = [c for c in components if not c['internal']]
for c in [x for x in content if x['level'] == 1][:10]:
    print(f"  {c['source']} {c['name']} [{c['page'][:40]}] status={c['status']}")

print()
print('=== примеры: уровень 2 (молекулы) с составом ===')
for c in [x for x in content if x['level'] == 2][:8]:
    print(f"  {c['name']} ← {', '.join(c['uses'][:5])}")

print()
print('=== примеры: уровень 3 (организмы) с составом ===')
for c in [x for x in content if x['level'] == 3][:8]:
    print(f"  {c['name']} ← {', '.join(c['uses'][:5])}")

print()
print('=== служебные копии: сколько и примеры имён ===')
internal = [c for c in components if c['internal']]
print('всего:', len(internal))
names = [c['name'] for c in internal]
prefixed = [n for n in names if ':' in n]
print('с префиксом семейства (fi:/u: и пр.):', len(prefixed), '| примеры:', prefixed[:8])
