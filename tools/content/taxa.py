"""Scientific names for the animals on the game's animal lists (Wikidata, CC0): content/kb/taxa.json maps a common
name to its scientific names, so "Ornithorhynchus anatinus" or "Ornithorhynchus" is the platypus. Only exact English
labels of taxa are matched; a common name shared by many species (e.g. "deer") gets the genus or family when that is
what Wikidata's item for the common name is. Run: python3 tools/content/taxa.py   (about one query a minute)"""
import json, os, glob, re, time, urllib.request, urllib.parse
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
KEYS = {"animals", "birds", "fish", "reptiles", "bugs", "sea", "primates", "wildcats", "dinos", "farm", "aussie", "dogbreeds"}
names = set()
for p in sorted(glob.glob(os.path.join(ROOT, "days", "[0-9]*.json"))):
    for q in json.load(open(p))["questions"]:
        if q["key"] in KEYS: names |= {a["a"] for a in q["answers"] if re.fullmatch(r"[a-z][a-z' -]+", a["a"])}
names = sorted(names)
out_p = os.path.join(ROOT, "content", "kb", "taxa.json")
out = json.load(open(out_p)) if os.path.exists(out_p) else {}
todo = [n for n in names if n not in out]
print(len(names), "names,", len(todo), "to look up")
for i in range(0, len(todo), 250):
    batch = todo[i:i + 250]
    values = " ".join('"%s"@en' % n.replace('"', '') for n in batch)
    q = f'SELECT ?l ?sci WHERE {{ VALUES ?l {{ {values} }} ?item rdfs:label ?l ; wdt:P225 ?sci . }}'
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    for attempt in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "DeepleContentBuild/1.0"}), timeout=90)); break
        except Exception as e:
            print("retry", e); time.sleep(70)
    else: continue
    for b in r["results"]["bindings"]:
        l, s = b["l"]["value"], b["sci"]["value"]
        out.setdefault(l, [])
        if s not in out[l] and len(out[l]) < 4: out[l].append(s)
    for n in batch: out.setdefault(n, [])
    json.dump(out, open(out_p, "w"), separators=(",", ":"), ensure_ascii=False)
    print(i + len(batch), "done,", sum(1 for v in out.values() if v), "with a scientific name")
    time.sleep(62)
