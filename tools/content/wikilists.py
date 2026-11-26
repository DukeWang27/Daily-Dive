"""Answer lists from Wikipedia "List of ..." pages, the way large guessing games build theirs: gather every entry from
the pages that fit a question, match them to Wikidata (other names, a short description, how many language editions
have an article) and to Wikipedia page views (how familiar a thing is), then hand the entries we don't already have
to a checking pass before any are added. Nothing here is published: output goes to content/curated/wiki (private).

  python3 tools/content/wikilists.py check            which source pages exist (follows redirects)
  python3 tools/content/wikilists.py gather [id ...]  candidates per question -> content/curated/wiki/<id>.gather.json

Wikipedia text is CC BY-SA 4.0 and Wikidata is CC0; we keep only names, other names and counts, not article text.
Requests are slow on purpose (one page at a time, a pause between them) and everything is cached under
content/build/cache/wiki, so a page or a count is fetched once.
"""
import json, os, re, sys, time, glob, hashlib, urllib.request, urllib.parse, urllib.error
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CUR = os.path.join(ROOT, "content", "curated")
CACHE = os.path.join(ROOT, "content", "build", "cache", "wiki")
OUT = os.path.join(CUR, "wiki")
UA = "content-research-bot/1.0 (+https://www.mediawiki.org/wiki/API:Etiquette)"
HDR = {"User-Agent": UA, "Api-User-Agent": UA}
PAUSE = 0.35
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()

def _cache(kind, key):
    d = os.path.join(CACHE, kind); os.makedirs(d, exist_ok=True)
    return os.path.join(d, hashlib.sha1(key.encode()).hexdigest()[:20] + ".json")

def get(url, accept=None, tries=6):
    h = dict(HDR)
    if accept: h["Accept"] = accept
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
                time.sleep(PAUSE); return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return 404, b""
            if e.code in (429, 503, 502): time.sleep(min(60, 5 * (i + 1) ** 2)); continue
            return e.code, b""
        except Exception: time.sleep(5 * (i + 1))
    return 0, b""

def raw(title, depth=0):
    """Wikitext of a page, following redirects. Returns (final title, text) or (title, None)."""
    p = _cache("raw", title)
    if os.path.exists(p):
        d = json.load(open(p)); return d["title"], d["text"]
    st, b = get("https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="") + "?action=raw")
    if st == 0: raise SystemExit("Wikipedia unreachable or throttled; try again later")
    text = b.decode("utf8", "replace") if st == 200 else None
    final = title
    m = text and re.match(r"\s*#redirect\s*:?\s*\[\[([^\]|#]+)", text, re.I)
    if m and depth < 3:
        final, text = raw(m.group(1).strip(), depth + 1)
    json.dump({"title": final, "text": text}, open(p, "w"))
    return final, text

SKIP_SECTIONS = re.compile(r"^(see also|references|notes|external links|further reading|bibliography|sources|citations|footnotes|explanatory notes|works cited|general references)$", re.I)
NS = re.compile(r"^(file|image|category|wikipedia|wp|help|template|portal|special|talk|user|wikt|wiktionary|s|q|n|commons|draft|module|mos|:?[a-z]{2,3}(-[a-z]+)?):", re.I)

def strip(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>/]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    out, skip = [], False
    for line in text.split("\n"):
        h = re.match(r"^(=+)\s*(.*?)\s*\1\s*$", line)
        if h: skip = bool(SKIP_SECTIONS.match(h.group(2))); out.append(line); continue
        if not skip: out.append(line)
    return "\n".join(out)

LINK = re.compile(r"\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]")
def clean_text(s):
    s = LINK.sub(lambda m: m.group(2) or m.group(1), s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s); s = re.sub(r"'{2,}", "", s); s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip(" |*#:;!-")

ITEM_PARAMS = {"name", "title", "stadium", "venue", "arena", "item", "game", "film", "ship", "horse", "dog", "language", "company", "brand", "product", "word", "term"}

def entries(text, page):
    """The first link of each list line and each table row: on a list page that is the listed thing; the rest of the
    line is kept as context for the check (a description, a date, a country)."""
    text = strip(text); found = []
    sect = ""
    rows = []
    for block in re.split(r"\n\|-[^\n]*", text):   # table rows
        rows.append(block)
    for block in rows:
        lines = block.split("\n")
        in_row = any(l.startswith("|") or l.startswith("!") for l in lines[:2])
        if in_row:
            cells = "\n".join(l for l in lines if l.startswith(("|", "!")) and not l.startswith(("{|", "|}", "|+")))
            for m in LINK.finditer(cells):
                t = m.group(1).split("#")[0].strip()
                if not t or NS.match(t): continue
                found.append({"t": t[0].upper() + t[1:], "label": (m.group(2) or "").strip(), "ctx": clean_text(cells)[:220], "page": page, "sect": sect})
                break
            continue
        for l in lines:
            h = re.match(r"^(=+)\s*(.*?)\s*\1\s*$", l)
            if h: sect = clean_text(h.group(2)); continue
            pm = re.match(r"^\s*\|\s*([a-z_ ]+?)\s*=", l)
            if pm and pm.group(1).strip() not in ITEM_PARAMS: continue
            mm = re.match(r"^\{\{\s*(main|main article|further)\s*\|([^|}]+)", l, re.I)
            if mm:
                t = mm.group(2).strip()
                if t and not NS.match(t): found.append({"t": t[0].upper() + t[1:], "label": "", "ctx": sect, "page": page, "sect": sect})
                continue
            if not (re.match(r"^[*#;]", l) or pm or re.match(r"^\s+\|", l)): continue
            for m in LINK.finditer(l):
                t = m.group(1).split("#")[0].strip()
                if not t or NS.match(t): continue
                found.append({"t": t[0].upper() + t[1:], "label": (m.group(2) or "").strip(), "ctx": clean_text(l)[:220], "page": page, "sect": sect})
                break
    return found

def sparql(q):
    p = _cache("sparql", q)
    if os.path.exists(p): return json.load(open(p))
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    for i in range(6):
        st, b = get(url, "application/sparql-results+json")
        if st == 200:
            r = json.loads(b)["results"]["bindings"]; json.dump(r, open(p, "w")); return r
        time.sleep(20 * (i + 1))
    raise SystemExit("Wikidata query failed")

def wikidata(titles):
    """enwiki title -> {q, desc, links (language editions), alt [other English names]}."""
    out = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 150):
        chunk = titles[i:i + 150]
        vals = " ".join('"%s"@en' % t.replace("\\", "\\\\").replace('"', '\\"') for t in chunk)
        q = ("SELECT ?t ?item ?d ?links (GROUP_CONCAT(DISTINCT ?alt; separator='|') AS ?alts) WHERE { VALUES ?t { %s } "
             "?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t . ?item wikibase:sitelinks ?links . "
             "OPTIONAL { ?item schema:description ?d . FILTER(LANG(?d)='en') } OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt)='en') } } "
             "GROUP BY ?t ?item ?d ?links") % vals
        for b in sparql(q):
            out[b["t"]["value"]] = {"q": b["item"]["value"].rsplit("/", 1)[1], "desc": b.get("d", {}).get("value", ""), "links": int(b["links"]["value"]),
                                    "alt": [a for a in b.get("alts", {}).get("value", "").split("|") if a][:12]}
    return out

def views(title):
    """Views by people (not bots) over the 12 months of 2025."""
    p = _cache("views", title)
    if os.path.exists(p): return json.load(open(p))["v"]
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/" +
           urllib.parse.quote(title.replace(" ", "_"), safe="") + "/monthly/2025010100/2025123100")
    st, b = get(url)
    v = sum(x["views"] for x in json.loads(b)["items"]) if st == 200 else (0 if st == 404 else None)
    if v is not None: json.dump({"v": v}, open(p, "w"))
    return v or 0

def sources():
    """content/curated/wiki-sources.json, overridden by any wiki-sources.<part>.json (one per worker, so nobody overwrites another)."""
    out = json.load(open(os.path.join(CUR, "wiki-sources.json")))
    for p in sorted(glob.glob(os.path.join(CUR, "wiki-sources.*.json"))):
        if not p.endswith(".ok.json"): out.update(json.load(open(p)))
    return out

def check():
    ok = {}
    for qid, pages in sources().items():
        for t in pages:
            final, text = raw(t)
            n = len(entries(text, final)) if text else 0
            print(f"{qid[:28]:28} {'OK ' if text else '-- '} {n:5}  {t}" + (f"  -> {final}" if final != t else ""), flush=True)
            if text: ok.setdefault(qid, []).append(final)
    json.dump(ok, open(os.path.join(CUR, "wiki-sources.ok.json"), "w"), indent=1)

def curated():
    Q = {}
    for p in sorted(glob.glob(os.path.join(CUR, "batch-*.json"))):
        for q in json.load(open(p))["questions"]: Q[q["id"]] = q
    return Q

def known_names(q):
    """Every name already on the question's list, normalised -> canonical."""
    have = {}
    for tier, items in (q.get("answers") or {}).items():
        for a in items:
            names = [a] if isinstance(a, str) else list(a)
            for n in names: have.setdefault(norm(n), names[0])
    return have

def base(t): return re.sub(r"\s*\([^)]*\)$", "", t).strip()

def wd_items(where):
    """Items from a Wikidata query body that binds ?item (English label, other names, description, language editions)."""
    q = ("SELECT ?item ?label ?d ?links (GROUP_CONCAT(DISTINCT ?alt; separator='|') AS ?alts) ?t WHERE { " + where +
         " ?item rdfs:label ?label . FILTER(LANG(?label)='en') ?item wikibase:sitelinks ?links . "
         "OPTIONAL { ?item schema:description ?d . FILTER(LANG(?d)='en') } OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt)='en') } "
         "OPTIONAL { ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t } } GROUP BY ?item ?label ?d ?links ?t LIMIT 6000")
    out = {}
    for b in sparql(q):
        t = b.get("t", {}).get("value") or b["label"]["value"]
        out[t] = {"q": b["item"]["value"].rsplit("/", 1)[1], "desc": b.get("d", {}).get("value", ""), "links": int(b["links"]["value"]),
                  "alt": [x for x in b.get("alts", {}).get("value", "").split("|") if x][:12], "label": b["label"]["value"], "wiki": "t" in b}
    return out

def gather(ids=None, with_views=False):
    """Candidates for each question from its sources (wiki-sources.json: a list of pages, or {"pages": [...], "wd": [query bodies]}).
    Each candidate: its name, other names, description, language editions and where it came from; matched against the
    names already on the question's list. Output: content/curated/wiki/<id>.gather.json"""
    os.makedirs(OUT, exist_ok=True)
    src = sources(); Q = curated()
    for qid, spec in src.items():
        if ids and qid not in ids: continue
        q = Q.get(qid)
        if not q: continue
        spec = {"pages": spec} if isinstance(spec, list) else spec
        seen = {}
        for page in spec.get("pages", []):
            final, text = raw(page)
            if not text: continue
            for e in entries(text, final):
                if e["t"] != final: seen.setdefault(e["t"], e)
        wd = wikidata(list(seen))
        cands = {}
        for t, e in seen.items():
            info = wd.get(t)
            if not info: continue      # a redlink, a redirect or a page with no Wikidata item: left out (the check can't judge it)
            cands[t] = {"title": t, "name": base(t), "desc": info["desc"], "links": info["links"], "alt": [a for a in info["alt"] if norm(a) != norm(base(t))][:8],
                        "ctx": e["ctx"][:160], "from": e["page"] + (" / " + e["sect"] if e["sect"] else "")}
        for where in spec.get("wd", []):
            for t, info in wd_items(where).items():
                if t in cands: cands[t]["from"] += " + Wikidata"; continue
                cands[t] = {"title": t, "name": base(info["label"] if not info["wiki"] else t), "desc": info["desc"], "links": info["links"],
                            "alt": [a for a in info["alt"] if norm(a) != norm(base(t))][:8], "ctx": "", "from": "Wikidata"}
        have = known_names(q)
        for c in cands.values():
            c["have"] = next((have[norm(n)] for n in [c["name"], c["title"], *c["alt"]] if norm(n) in have), None)
            if with_views: c["views"] = views(c["title"])
        matched = {c["have"] for c in cands.values() if c["have"]}
        new = sorted([c for c in cands.values() if not c["have"]], key=lambda c: -c["links"])
        json.dump({"id": qid, "prompt": q["prompt"], "rules": q.get("rules", []), "granularity": q.get("granularity", ""), "invalid": q.get("invalid_but_plausible", []),
                   "own": len(set(have.values())), "own_matched": len(matched), "new": new}, open(os.path.join(OUT, qid + ".gather.json"), "w"), indent=0, ensure_ascii=False)
        print(f"{qid:32} entries {len(seen):5}  candidates {len(cands):5}  ours found in sources {len(matched):4}/{len(set(have.values())):4}  new {len(new):5}", flush=True)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check": check()
    elif cmd == "gather": gather([x for x in sys.argv[2:] if not x.startswith("--")] or None, "--views" in sys.argv)
