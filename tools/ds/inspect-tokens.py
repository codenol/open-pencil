import json
from collections import Counter

light = json.load(open('/root/.hermes/cache/documents/doc_5b952e51eaf4_Light.tokens.json'))
dark = json.load(open('/root/.hermes/cache/documents/doc_ea6811808e1f_Dark.tokens.json'))


def leaves(obj, path=''):
    out = {}
    for k, v in obj.items():
        if k == '$extensions':
            continue
        p = f'{path}.{k}' if path else k
        if isinstance(v, dict) and '$value' in v:
            out[p] = v
        elif isinstance(v, dict):
            out.update(leaves(v, p))
    return out


L, D = leaves(light), leaves(dark)

prim_light = {}
conflicts = 0
for k, v in L.items():
    a = v.get('$extensions', {}).get('com.figma.aliasData')
    if not a:
        continue
    name = a.get('targetVariableName')
    hexv = v['$value'].get('hex')
    if name in prim_light and prim_light[name] != hexv:
        conflicts += 1
        if conflicts < 4:
            print('КОНФЛИКТ Light:', name, prim_light[name], 'vs', hexv, 'у', k)
    prim_light[name] = hexv
print('примитивов (Light):', len(prim_light), '| конфликтов:', conflicts)

prim_dark = {}
for k, v in D.items():
    a = v.get('$extensions', {}).get('com.figma.aliasData')
    if not a:
        continue
    prim_dark[a.get('targetVariableName')] = v['$value'].get('hex')
print('примитивов (Dark):', len(prim_dark))

common = set(prim_light).intersection(prim_dark)
diffs = [n for n in common if prim_light[n] != prim_dark[n]]
print('примитивов с разными значениями в Light/Dark:', len(diffs), diffs[:6])

for k in ['button.filled.accent.background.default', 'button.filled.accent.background.hover']:
    a1 = L[k]['$extensions']['com.figma.aliasData']['targetVariableName']
    a2 = D[k]['$extensions']['com.figma.aliasData']['targetVariableName']
    print(f'{k}: Light->{a1} | Dark->{a2}')

print('примеры примитивов:', list(prim_light.items())[:8])
print('пути компонентных токенов (пример):', [k for k in list(L)[:3]])
# уникальные имена слэш-палитр
print('палитр:', sorted(set(n.split('/')[0] for n in prim_light)))
