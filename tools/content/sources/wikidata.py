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
  "cheeses": ("Cheeses (kinds and named cheeses)", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q10943 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 1)', "?links"),
  "instruments": ("Musical instruments", f'?item wdt:P279+ wd:Q34379 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "constellations": ("The 88 modern constellations", f'?item wdt:P31 wd:Q8928 . {LABEL} {ALIAS}', ""),
  "languages": ("Languages with an ISO 639-3 code and a Wikipedia article in several languages", f'?item wdt:P220 ?iso . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 20)', "?iso ?links"),
  "volcanoes": ("Volcanoes with several Wikipedia articles", f'?item wdt:P31/wdt:P279* wd:Q8072 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 6)', "?links"),
  # Categories for "Name a kind of X" questions. ?links (Wikipedia language editions) is how well known an item is:
  # it sets the starting rarity of an answer nobody listed (kbmerge.prior). Noisy classes exclude what they drag in.
  "pasta": ("Pasta shapes and kinds", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q178 . FILTER NOT EXISTS {{ ?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q178108 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "breads": ("Breads", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q7802 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "soups": ("Soups", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q41415 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "desserts": ("Desserts", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q182940 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "sauces": ("Sauces and condiments", f'{{ ?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q178359 }} UNION {{ ?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q2596997 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "spices": ("Herbs and spices", f'{{ ?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q42527 }} UNION {{ ?item wdt:P366 wd:Q42527 }} UNION {{ ?item wdt:P366 wd:Q207123 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "vegetables": ("Vegetables", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q11004 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "fruits": ("Fruits (as food)", f'?item (wdt:P31|wdt:P279)/wdt:P279* wd:Q3314483 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "car_brands": ("Car makers and brands", f'{{ ?item wdt:P31 wd:Q786820 }} UNION {{ ?item wdt:P31 wd:Q83418599 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 5)', "?links"),
  "deities": ("Gods and goddesses", f'?item wdt:P31/wdt:P279* wd:Q178885 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 6)', "?links"),
  "creatures": ("Legendary creatures", f'?item wdt:P31/wdt:P279* wd:Q2239243 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 4)', "?links"),
  "mathematicians": ("Mathematicians", f'?item wdt:P106 wd:Q170790 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 20)', "?links"),
  "inventors": ("Inventors", f'?item wdt:P106 wd:Q205375 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 12)', "?links"),
  "photographers": ("Photographers", f'?item wdt:P106 wd:Q33231 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 15)', "?links"),
  "operas": ("Operas", f'{{ ?item wdt:P7937 wd:Q1344 }} UNION {{ ?item wdt:P31 wd:Q1344 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 4)', "?links"),
  "paintings": ("Famous paintings", f'?item wdt:P31 wd:Q3305213 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 12)', "?links"),
  "typefaces": ("Typefaces", f'?item wdt:P31/wdt:P279* wd:Q17451 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "wearables": ("Things people wear: clothing, footwear, headgear, jewellery, watches", f'{{ ?item wdt:P279+ wd:Q11460 }} UNION {{ ?item wdt:P279+ wd:Q22676 }} UNION {{ ?item wdt:P279+ wd:Q14952 }} UNION {{ ?item wdt:P279+ wd:Q161439 }} UNION {{ ?item wdt:P279+ wd:Q178794 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "music_genres": ("Music genres", f'?item wdt:P31 wd:Q188451 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 6)', "?links"),
  "film_genres": ("Film genres", f'?item wdt:P31 wd:Q201658 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
  "sports": ("Sports", f'?item wdt:P31 wd:Q31629 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 4)', "?links"),
  "fallacies": ("Logical fallacies", f'?item wdt:P31/wdt:P279* wd:Q186150 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "paradoxes": ("Paradoxes", f'?item wdt:P31/wdt:P279* wd:Q170584 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)', "?links"),
  "deserts": ("Deserts", f'?item wdt:P31 wd:Q8514 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 4)', "?links"),
  "seas": ("Seas and oceans", f'{{ ?item wdt:P31/wdt:P279* wd:Q165 }} UNION {{ ?item wdt:P31 wd:Q9430 }} {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 6)', "?links"),
  "colours": ("Colours", f'?item wdt:P31 wd:Q1075 . {LABEL} {ALIAS} ?item wikibase:sitelinks ?links . FILTER(?links >= 4)', "?links"),
  "dinosaurs": ("Dinosaur genera (non-avian), with Wikipedia articles", f'?item wdt:P105 wd:Q34740 ; wdt:P171+ wd:Q430 . FILTER NOT EXISTS {{ ?item wdt:P171+ wd:Q5113 }} ?item wdt:P225 ?label . ?item wikibase:sitelinks ?links . FILTER(?links >= 3)', "?links"),
}
def run(q):
    url = EP + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "daily-game-content-builder/1.0 (offline content build)", "Accept": "application/sparql-results+json"})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())["results"]["bindings"]
        except Exception as e:
            print("  retry:", e, flush=True); time.sleep(90)
    raise SystemExit("query failed")
# Food classes in Wikidata drag in dishes filed under them (dim sum under pasta, doughnuts under bread). For these, an
# item is kept only if its English description says what it is.
KEEP = {
  "pasta": r"pasta|noodle", "breads": r"bread|loaf|flatbread|bun\b|roll\b|bagel|naan|chapati|tortilla",
  "soups": r"soup|stew|broth|chowder|bisque|potage|consomm|gazpacho|pottage|borscht|ramen|pho\b",
  "desserts": r"dessert|cake|pudding|pastry|sweet|confection|tart|pie\b|ice cream|cookie|biscuit|custard|mousse|sorbet",
  "sauces": r"sauce|condiment|dressing|relish|chutney|\bdip\b|ketchup|mustard|salsa|gravy|mayonnaise|paste|vinegar|pickle",
  "spices": r"spice|herb|seasoning|seed|plant|species", "vegetables": r"vegetable|plant|species|cultivar|root|tuber|bulb|legume|bean|leaf",
  "fruits": r"fruit|berry|plant|species|cultivar|citrus|drupe",
}
def build(domain):
    desc, body, extra = DOMAINS[domain]
    keep = KEEP.get(domain)
    if keep: body += ' OPTIONAL { ?item schema:description ?d . FILTER(LANG(?d) = "en") }'; extra += " ?d"
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
    import re as _re
    for it in list(items.values()):
        if keep and not _re.search(keep, (it.get("d") or "") + " " + it["a"], _re.I): items.pop(it["id"]); continue
        it["al"] = sorted(it["al"] - {it["a"]})
        if "contL" in it: it["continents"] = sorted(it.pop("contL"))
        for k in ("landlocked", "island"):
            if k in it: it[k] = it[k] == "true"
        out.append(it)
    json.dump({"domain": domain, "description": desc, "source": "Wikidata", "url": "https://www.wikidata.org/", "license": "CC0 1.0",
               "retrieved": datetime.date.today().isoformat(), "query": q, "items": sorted(out, key=lambda x: x["a"].lower())},
              open(os.path.join(OUT, domain + ".json"), "w"), separators=(",", ":"))
    print(f"{domain}: {len(out)} items", flush=True)
if __name__ == "__main__":
    for d in (sys.argv[1:] or DOMAINS): build(d); time.sleep(65)
