import json
from collections import Counter, defaultdict

d = json.load(open('/opt/open-pencil/data/relink-map.json'))
all_copies = []
for section in ('matched', 'ambiguous', 'unmatched'):
    for item in d[section]:
        copy = item['copy'] if 'copy' in item else item
        all_copies.append(copy)

by_lib = defaultdict(list)
for copy in all_copies:
    by_lib[copy['libraryKey']].append(copy['name'])

print(f"всего копий: {len(all_copies)}, библиотек: {len(by_lib)}")
print()
for key, names in sorted(by_lib.items(), key=lambda kv: -len(kv[1]))[:10]:
    sample = Counter(names).most_common(6)
    print(f"{key[:18]}…: {len(names)} копий")
    print(f"   примеры: {', '.join(f'{n}({c})' if c>1 else n for n, c in sample)}")
