"""Other names for answers: one reusable pool, applied to any question.

Sources (all already in content/kb, none fetched during play):
  - synonyms.json   hand-checked groups of names for one thing (regional, scientific, historical, abbreviations).
                    Groups whose domain carries a suffix (-loose, -uk, -us ...) are never applied automatically.
  - Wikidata extracts (countries, cities, breeds, instruments, elements ...): each entity's label and its aliases.
  - IOC World Bird List: each species' scientific name, and its plain name where the IOC adds a qualifier that
    nobody says ("northern raven" -> raven) and only one species carries that plain name.

How a group is applied to a question: if the question's own list contains exactly one answer whose name (or listed
other name) is in the group, the group's other names become other names of that answer. If two answers in the list
match one group, the list treats them as different things, and nothing is added. A name that is already an answer, or
already belongs to another answer, is never moved. Names shorter than three letters are kept only for a few codes.

Usage:
  python3 tools/content/aliases.py report               coverage before/after for every question, no files changed
  python3 tools/content/aliases.py apply-days 1 2 3      add the names to days/<n>.json (the published past days)
  python3 tools/content/aliases.py apply-build           add the names to content/build/days/*.json, and write
                                                         content/build/sql/aliases.sql (new set_keys rows only; the
                                                         live database is changed only when that file is applied)
"""
import json, os, re, sys, glob, unicodedata
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
KB = os.path.join(ROOT, "content", "kb")
SHORT_OK = {"uk", "us", "usa", "uae", "drc", "gsd", "mma", "lab", "tux", "pjs", "co2", "h2o", "nacl", "dprk"}
QUALIFIERS = ("common",)   # "northern shrike" is not "shrike"; only "common X" reliably means X

def norm(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn").lower()
    s = s.replace("&", " and ").replace("'", "").replace("’", "")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()

def groups():
    out = []
    syn = json.load(open(os.path.join(KB, "synonyms.json")))["groups"]
    for g in syn:
        if "-" not in g["domain"]: out.append(({norm(n) for n in g["names"]}, g["kind"], "editorial:" + g["domain"]))
    for f in sorted(glob.glob(os.path.join(KB, "*.json"))):
        name = os.path.basename(f)[:-5]
        if name in ("synonyms", "birds", "cities", "former_countries"): continue   # city lists carry every language's name
        d = json.load(open(f)); items = next((v for v in d.values() if isinstance(v, list)), [])
        labels = {norm(e["a"]) for e in items if isinstance(e, dict) and e.get("a")}   # another entity's own name is never an alias
        for e in items:
            if isinstance(e, dict) and e.get("a") and e.get("al"):
                # Names an English-speaking player might type: plain letters, up to three words, the five shortest.
                al = sorted({x for x in e["al"] if x and x.isascii() and len(x.split()) <= 3 and not re.search(r"\d", x)}, key=len)[:5]
                a0 = norm(e["a"]); names = {a0} | {n for n in (norm(x) for x in al) if n not in labels and len(n) > 3 and min(len(w) for w in n.split()) > 1}
                if len(names) > 1: out.append(({n for n in names if n}, "alias", f"wikidata:{name}"))
    birds = json.load(open(os.path.join(KB, "birds.json")))
    items = next((v for v in birds.values() if isinstance(v, list)), [])
    plain = {}
    for e in items:
        a = norm(e["a"]); w = a.split(" ")
        if len(w) >= 2 and w[0] in QUALIFIERS: plain.setdefault(" ".join(w[1:]), []).append(a)
    for e in items:
        a = norm(e["a"]); names = {a}
        if e.get("sci"): names.add(norm(e["sci"]))
        w = a.split(" ")
        if len(w) >= 2 and w[0] in QUALIFIERS and len(plain.get(" ".join(w[1:]), [])) == 1: names.add(" ".join(w[1:]))
        out.append((names, "scientific", "ioc:birds"))
    return out

GROUPS = None
def apply_question(q):
    """Adds other names to q's answers in place. Returns the list of (answer, name, source) added."""
    global GROUPS
    if GROUPS is None: GROUPS = groups()
    if q.get("pattern") or q.get("prefix"): return []          # word questions: a different word is a different answer
    owner, canon = {}, {}
    for r in q["answers"]:
        canon.setdefault(norm(r["a"]), r)
        for n in [r["a"]] + (r.get("al") or []): owner.setdefault(norm(n), r)
    # Which sources this question really draws on: at least three of its answers (or 5%) appear in that source.
    hits = {}
    for names, kind, src in GROUPS:
        dom = src.split(":", 1)[1] if ":" in src else src
        for n in names:
            if n in owner: hits.setdefault(dom, set()).add(id(owner[n]))
    need = max(3, 0.05 * len(q["answers"]))
    added = []
    for names, kind, src in GROUPS:
        dom = src.split(":", 1)[1] if ":" in src else src
        if len(hits.get(dom, ())) < need: continue
        # Matched through an answer's own name only (a list's looser other names would carry its mistakes further),
        # and no other answer may already own any name in the group.
        rows = {id(canon[n]): canon[n] for n in names if n in canon}
        if len(rows) != 1 or any(n in owner and owner[n] is not next(iter(rows.values())) for n in names): continue
        r = next(iter(rows.values()))
        for n in sorted(names):
            if not n or n in owner or (len(n) < 3 and n not in SHORT_OK): continue
            r.setdefault("al", []).append(n); owner[n] = r; added.append((r["a"], n, src))
    return added

def day_files(kind):
    if kind == "days": return [os.path.join(ROOT, "days", f"{n}.json") for n in sys.argv[2:]]
    return sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json")), key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0))

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    files = day_files("days") if cmd == "apply-days" else day_files("build") if cmd == "apply-build" else \
        [os.path.join(ROOT, "days", f"{n}.json") for n in (1, 2, 3)] + day_files("build")
    total, per_src, sql = 0, {}, []
    for f in files:
        d = json.load(open(f))
        for i, q in enumerate(d["questions"], 1):
            add = apply_question(q); total += len(add)
            for _, _, s in add: per_src[s] = per_src.get(s, 0) + 1
            if cmd == "apply-build" and add:
                keys = {norm(n): a for a, n, _ in add}
                sql.append(f"insert into public.set_keys (set_id, round, key, answer) select {d['day']}, {i}, key, value #>> '{{}}' from jsonb_each('{json.dumps(keys).replace(chr(39), chr(39) * 2)}'::jsonb) on conflict do nothing;")
        if cmd in ("apply-days", "apply-build"): json.dump(d, open(f, "w"), ensure_ascii=False, separators=(",", ":"))
    if cmd == "apply-build":
        open(os.path.join(ROOT, "content", "build", "sql", "aliases.sql"), "w").write(
            "-- Other names for upcoming days' answers (tools/content/aliases.py). Adds set_keys rows only; changes no score.\nbegin;\n" + "\n".join(sql) + "\ncommit;\n")
    print(f"{len(files)} day files: {total} other names {'added' if cmd != 'report' else 'would be added'}", per_src)

if __name__ == "__main__": main()
