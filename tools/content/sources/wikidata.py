"""Wikidata (CC0) -> content/kb/<domain>.json. Each domain is one SPARQL query returning an item, its English label,
its English alternative names, and a few attributes. Run: python3 tools/content/sources/wikidata.py [domain ...]
Wikidata's query service limits heavy queries; these stay small. Labels are checked again when a question is built."""
import json, os, sys, time, datetime, urllib.request, urllib.parse
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "content", "kb")
EP = "https://query.wikidata.org/sparql"
ALIAS = 'OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) = "en") }'
LABEL = '?item rdfs:label ?label . FILTER(LANG(?label) = "en")'
# domain -> (description, WHERE body, extra select vars)
DOMAINS = {
  "countries": ("Sovereign states (current), with continent, landlocked and island flags",
    f'?item wdt:P31 wd:Q3624078 . FILTER NOT EXISTS {{ ?item wdt:P576 ?end }} {LABEL} {ALIAS} OPTIONAL {{ ?item wdt:P30 ?cont . ?cont rdfs:label ?contL . FILTER(LANG(?contL)="en") }} BIND(EXISTS {{ ?item wdt:P31 wd:Q123480 }} AS ?landlocked) BIND(EXISTS {{ ?item wdt:P31 wd:Q112099 }} AS ?island)',
    "?contL ?landlocked ?island"),
  "former_countries": ("Historical countries (no longer existing)",
    f'?item wdt:P31/wdt:P279* wd:Q3024240 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 15)', "?links"),
  "elements": ("Chemical elements", f'?item wdt:P31 wd:Q11344 . ?item wdt:P1086 ?num . {LABEL} {ALIAS} OPTIONAL {{ ?item wdt:P246 ?sym }}', "?num ?sym"),
  "dog_breeds": ("Dog breeds", f'?item wdt:P31 wd:Q39367 . {LABEL} {ALIAS}', ""),
  "cat_breeds": ("Cat breeds", f'?item wdt:P31 wd:Q43577 . {LABEL} {ALIAS}', ""),
  "horse_breeds": ("Horse breeds", f'?item wdt:P31 wd:Q1160573 . {LABEL} {ALIAS}', ""),
  "cheeses": ("Cheeses", f'?item wdt:P31/wdt:P279* wd:Q10943 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "instruments": ("Musical instruments", f'?item wdt:P279+ wd:Q34379 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "constellations": ("The 88 modern constellations", f'?item wdt:P31 wd:Q8928 . {LABEL} {ALIAS}', ""),
  "languages": ("Languages with an ISO 639-3 code and a Wikipedia article in several languages", f'?item wdt:P220 ?iso . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 20)', "?iso ?links"),
  "volcanoes": ("Volcanoes with several Wikipedia articles", f'?item wdt:P31/wdt:P279* wd:Q8072 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 6)', "?links"),
  "dinosaurs": ("Dinosaur genera (non-avian), with Wikipedia articles", f'?item wdt:P105 wd:Q34740 ; wdt:P171+ wd:Q430 . FILTER NOT EXISTS {{ ?item wdt:P171+ wd:Q5113 }} ?item wdt:P225 ?label . ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
}
def run(q):
    url = EP + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "daily-game-content-builder/1.0 (offline content build)", "Accept": "application/sparql-results+json"})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())["results"]["bindings"]
        except Exception as e:
            print("  retry:", e); time.sleep(150)
    raise SystemExit("query failed")
def build(domain):
    desc, body, extra = DOMAINS[domain]
    q = f"SELECT ?item ?label ?alt {extra} WHERE {{ {body} }}"
    rows = run(q); items = {}
    for b in rows:
        qid = b["item"]["value"].rsplit("/", 1)[-1]; label = b.get("label", {}).get("value")
        if not label or label.startswith("Q") and label[1:].isdigit(): continue
        it = items.setdefault(qid, {"id": qid, "a": label, "al": set()})
        if "alt" in b and len(b["alt"]["value"]) <= 60: it["al"].add(b["alt"]["value"])
        for k in extra.replace("?", "").split():
            if k in b: v = b[k]["value"]; it.setdefault(k, set()).add(v) if k == "contL" else it.__setitem__(k, v)
    out = []
    for it in items.values():
        it["al"] = sorted(it["al"] - {it["a"]})
        if "contL" in it: it["continents"] = sorted(it.pop("contL"))
        for k in ("landlocked", "island"):
            if k in it: it[k] = it[k] == "true"
        out.append(it)
    json.dump({"domain": domain, "description": desc, "source": "Wikidata", "url": "https://www.wikidata.org/", "license": "CC0 1.0",
               "retrieved": datetime.date.today().isoformat(), "query": q, "items": sorted(out, key=lambda x: x["a"].lower())},
              open(os.path.join(OUT, domain + ".json"), "w"), separators=(",", ":"))
    print(f"{domain}: {len(out)} items")
if __name__ == "__main__":
    for d in (sys.argv[1:] or DOMAINS): build(d); time.sleep(65)
