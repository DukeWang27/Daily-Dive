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
    return json.load(open(os.path.join(CUR, "wiki-sources.json")))

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

def gather(ids=None):
    os.makedirs(OUT, exist_ok=True)
    ok = json.load(open(os.path.join(CUR, "wiki-sources.ok.json")))
    Q = curated()
    for qid, pages in ok.items():
        if ids and qid not in ids: continue
        q = Q.get(qid)
        if not q: continue
        seen = {}
        for page in pages:
            final, text = raw(page)
            for e in entries(text or "", final):
                if e["t"] == final: continue
                seen.setdefault(e["t"], e)
        # follow redirects of linked titles only when Wikidata doesn't know the title (a redirect isn't a sitelink)
        wd = wikidata(list(seen))
        for t in [t for t in seen if t not in wd]:
            final, text = raw(t)
            if text is None: seen[t]["red"] = True; continue
            if final != t: seen[t]["to"] = final
        wd.update(wikidata([e["to"] for e in seen.values() if e.get("to")]))
        have = known_names(q)
        cands = {}
        for t, e in seen.items():
            if e.get("red"): continue
            T = e.get("to") or t
            info = wd.get(T)
            if not info: continue
            if T in cands: continue
            names = [base(T)] + ([e["label"]] if e["label"] else []) + info["alt"]
            match = next((have[norm(n)] for n in names if norm(n) in have), None)
            cands[T] = {"title": T, "name": base(T), "desc": info["desc"], "links": info["links"], "alt": [a for a in info["alt"] if norm(a) != norm(base(T))][:8],
                        "ctx": e["ctx"], "page": e["page"], "sect": e["sect"], "have": match}
        for c in cands.values(): c["views"] = views(c["title"])
        # titles for the answers already on the list, for familiarity: matched candidates, else the name as a title
        matched = {c["have"]: c for c in cands.values() if c["have"]}
        own = {}
        for canon in sorted(set(have.values())):
            c = matched.get(canon)
            if c: own[canon] = {"title": c["title"], "views": c["views"], "links": c["links"]}; continue
            final, text = raw(canon)
            if text is None: own[canon] = None; continue
            info = wikidata([final]).get(final)
            own[canon] = {"title": final, "views": views(final), "links": info["links"] if info else 0} if info else None
        new = sorted([c for c in cands.values() if not c["have"]], key=lambda c: -c["views"])
        json.dump({"id": qid, "prompt": q["prompt"], "rules": q.get("rules", []), "pages": pages, "own": own, "new": new,
                   "matched": len(matched)}, open(os.path.join(OUT, qid + ".gather.json"), "w"), indent=0)
        print(f"{qid:32} pages {len(pages)}  entries {len(seen):5}  on Wikidata {len(cands):5}  already ours {len(matched):4}  new {len(new):5}  own with a page {sum(1 for v in own.values() if v)}/{len(own)}", flush=True)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check": check()
    elif cmd == "gather": gather(sys.argv[2:] or None)
