"""The curated question set (content/curated/batch-*.json, researched and written for review) as playtest days.
Days 301-314: five questions a day, interleaved across subjects so each day mixes them. Questions marked "reject" by
their researcher are left out (they are still listed in the review dashboard with the reason).
Called by build.py; also: python3 tools/playtest/curated.py <out>"""
import json, os, glob, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
# Hand-written tiers are estimates: the rarest is kept above 0.015% of players (about 280 m), so nothing reaches
# Unfathomable without real evidence.
TIERS = [("common", 0.12, 0.025), ("less_common", 0.01, 0.0015), ("obscure", 0.0008, 0.00015)]
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()
ICONS = {"batch-1": "default", "batch-2": "default", "batch-3": "default", "batch-4": "default", "batch-5": "globe", "batch-6": "default", "batch-7": "default"}

WIKI = os.path.join(ROOT, "content", "curated", "wiki")
def wiki_rows(q, seen, rows):
    """Answers added from reference sources (Wikipedia lists, Wikidata) and checked one by one against the question's
    rules (content/curated/wiki/<id>.check.json; tools/content/wikilists.py, content/curated/WIKI-BRIEF.md). Their
    rarity is a first estimate from how widely known each one is (language editions of its article): marked as an
    estimate (pv) until players give real numbers, so it never sets off a mine or hits a target."""
    p = os.path.join(WIKI, q["id"] + ".check.json")
    if not os.path.exists(p) or os.environ.get("CURATED_NO_WIKI"): return   # CURATED_NO_WIKI: the hand-written lists alone (for before/after tests)
    chk = json.load(open(p)); links = {}
    g = os.path.join(WIKI, q["id"] + ".gather.json")
    if os.path.exists(g):
        for c in json.load(open(g)).get("new", []): links[norm(c["name"])] = c.get("links", 1)
    byname = {norm(r["a"]): r for r in rows}
    # Never add what the question's own rules list as invalid ("X -- reason"), however a source files it.
    banned = {norm(x.split(" -- ")[0]) for x in q.get("invalid_but_plausible", [])}
    for canon, extra in (chk.get("aliases_for_existing") or {}).items():
        r = byname.get(norm(canon))
        if r:
            for x in extra:
                if norm(x) not in seen and norm(x) != norm(r["a"]): r["al"].append(x); seen.add(norm(x))
    for a in chk.get("add", []):
        name = (a.get("name") or "").strip(); k = norm(name)
        if not name or k in seen or k in banned or any(norm(x) in banned for x in a.get("al", [])): continue
        seen.add(k)
        n = max(1, links.get(k, 2))
        share = min(0.004, 0.00015 * (n / 2) ** 0.9)
        al = [x for x in a.get("al", []) if norm(x) and norm(x) not in seen]
        for x in al: seen.add(norm(x))
        rows.append({"a": name, "s": round(share, 7), "al": al, "tier": "wiki", "pv": 1, "ds": 1})

# Accepted if typed, never shown in answer lists (crude cocktail names, coarse slang): the "h" flag the game knows.
CRUDE = re.compile(r"(fuck|shit|cunt|slut|whore|bitch|dick|cock|pussy|twat|wank|fart|piss|arse|motherf)", re.I)

def rows_of(q):
    rows = _rows_of(q)
    for r in rows:
        if CRUDE.search(r["a"]): r["h"] = 1
    return rows

def _rows_of(q):
    rows, seen = [], set()
    for tier, hi, lo in TIERS:
        items = q.get("answers", {}).get(tier, [])
        for j, a in enumerate(items):
            names = [a] if isinstance(a, str) else list(a)
            if not names or not names[0]: continue
            k = norm(names[0])
            if k in seen: continue
            seen.add(k)
            s = hi if len(items) == 1 else hi * (lo / hi) ** (j / (len(items) - 1))
            rows.append({"a": names[0], "s": round(s, 6), "al": [x for x in names[1:] if norm(x) not in seen], "tier": tier})
    for r in rows:
        for x in r["al"]: seen.add(norm(x))
    wiki_rows(q, seen, rows)
    return rows

def question(q, batch):
    out = {"key": "c-" + q["id"], "title": q.get("prompt", q["id"]), "icon": ICONS.get(batch, "default"), "prompt": q["prompt"], "hint": q.get("hint", ""),
           "rules": q.get("rules", []), "answers": rows_of(q), "general": [], "notIn": [], "curated": True,
           **({"exact": True} if q.get("match") == "exact" or q["id"] in ("v2-int-006",) else {}),
           "granularity_note": q.get("granularity", ""), "verdict": q.get("verdict"), "verdict_reason": q.get("verdict_reason", "")}
    # Questions about brands or models use the brands-and-models list: on a model question a brand alone is asked to
    # be specific; on a brand question a model counts as its brand.
    if q["id"] == "luxury-watch-model": out.update(granularity="model", kb="products:wearables")
    if q["id"] == "luxury-brand": out.update(granularity="brand", kb="products:wearables")
    # The Pearl: the editor's favourite finds (editorial.discoveries), named by the answer they match. Shown after the
    # round, labelled as an editor's pick; never part of scoring.
    have = {}
    for r in out["answers"]:
        for x in [r["a"]] + r["al"]: have.setdefault(norm(x), r["a"])
    pearls = [have[norm(d)] for d in (q.get("editorial") or {}).get("discoveries", []) if isinstance(d, str) and norm(d) in have]
    if pearls: out["pearls"] = list(dict.fromkeys(pearls))[:4]
    mode = q.get("mode")
    mech = (q.get("mechanic") or "").lower()
    if mode and mode.get("type") in ("forbidden", "target"):
        out["mode"] = mode
    elif "sea mines" in mech or mech.startswith("mines"):
        s = sorted([r["s"] for r in out["answers"]], reverse=True)
        if len(s) > 20:
            mid, deep = s[min(len(s) - 1, 8)], s[min(len(s) - 1, len(s) // 2)]
            out["mode"] = {"type": "mines", "mines": [{"lo": round(mid / 1.6, 6), "hi": round(mid * 1.6, 6)}, {"lo": round(deep / 1.6, 6), "hi": round(deep * 1.6, 6)}]}
    elif "risk" in mech: out["mode"] = {"type": "risk"}
    elif "wildcard" in mech: out["mode"] = {"type": "wildcard"}
    if out.get("mode", {}).get("type") == "forbidden":
        have = {norm(r["a"]): r["a"] for r in out["answers"]}
        for r in out["answers"]:
            for x in r["al"]: have.setdefault(norm(x), r["a"])
        out["mode"]["forbid"] = [have[norm(f)] for f in out["mode"].get("forbid", []) if norm(f) in have]
    return out

def load():
    batches = []
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "curated", "batch-*.json"))):
        try: qs = json.load(open(p))["questions"]
        except Exception as e: print("skipping", p, e); continue
        b = os.path.basename(p)[:-5]
        batches.append([question(q, b) for q in qs if q.get("verdict") != "reject" and q.get("answers")])
    return batches

def build(out):
    """Curated days from 301 (the researched set), and proposed new questions on their own days from 401 so the owner
    can play them before approving."""
    all_b = load()
    entries = []
    # Editorial v2 (content/editorial/selection-70.json): its 14 days in the planned order, from 501.
    sel = os.path.join(ROOT, "content", "editorial", "selection-70.json")
    if os.path.exists(sel):
        byid = {q["key"][2:]: q for b in all_b for q in b if q.get("verdict") == "proposed-v2"}
        for i, ids in enumerate(json.load(open(sel))["days"]):
            qs = [byid["v2-" + x] for x in ids if "v2-" + x in byid]
            if len(qs) < 3: continue
            n = 501 + i
            day = {"v": 3, "day": n, "questions": qs, "experimental": True, "label": f"Editorial v2 · day {i + 1}"}
            json.dump(day, open(os.path.join(out, "pt", f"{n}.json"), "w"), separators=(",", ":"))
            entries.append({"n": n, "group": "v2", "source": f"Editorial v2 · day {i + 1}",
                            "questions": [f"[{(q.get('mode') or {}).get('type', 'rarity')}] {q['prompt']}" for q in qs]})
    for first, label, pick in ((301, "Curated set", lambda q: q.get("verdict") not in ("proposed", "proposed-v2")), (401, "Proposed new questions", lambda q: q.get("verdict") == "proposed")):
        batches = [[q for q in b if pick(q)] for b in all_b]
        order, i = [], 0
        while any(batches):
            b = batches[i % len(batches)]
            if b: order.append(b.pop(0))
            i += 1
        for d in range(0, len(order), 5):
            qs = order[d:d + 5]
            if len(qs) < 3: break
            n = first + d // 5
            day = {"v": 3, "day": n, "questions": qs, "experimental": True, "label": f"{label} · day {d // 5 + 1}"}
            json.dump(day, open(os.path.join(out, "pt", f"{n}.json"), "w"), separators=(",", ":"))
            entries.append({"n": n, "group": "curated", "source": f"{label} · day {d // 5 + 1}",
                            "questions": [f"[{(q.get('mode') or {}).get('type', 'rarity')}] {q['prompt']}" for q in qs]})
    return entries

if __name__ == "__main__":
    os.makedirs(os.path.join(sys.argv[1], "pt"), exist_ok=True); print(len(build(sys.argv[1])), "days")
