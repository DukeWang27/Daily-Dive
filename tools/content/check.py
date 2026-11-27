"""Checks question files against tools/content/SPEC.md. Run: python3 tools/content/check.py [files...] (default: all).
Exit code 1 if any file has an error. Prints one line per problem."""
import json, glob, os, re, sys
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
CATS = set("general geography history science nature language entertainment music food technology sports everyday creative logic mythology literature maths people popculture arts film-tv sport games brands culture wordplay internet business knowledge".split())
STYLES = set("category constraint scene association property wordplay then-and-now role fiction".split())
ICONS = set("paw bird fish bug lizard leaf flower wave egg apple carrot cheese pizza cake bowl cup nut bottle cone bread burger candy pan wheel car note wrench chair shirt hat bath book boat building door globe pin ball briefcase palette hand speech atom gem dragon bolt heart cloud planet default".split())
def norm(s): return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
def check(path):
    errs = []
    try: q = json.load(open(path))
    except Exception as e: return [f"not JSON: {e}"]
    for k in ["id", "prompt", "hint", "title", "icon", "category", "style", "topic", "difficulty", "rules", "answers"]:
        if k not in q: errs.append(f"missing {k}")
    if errs: return errs
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", q["id"]): errs.append("id must be lowercase-hyphenated")
    if os.path.basename(path) != q["id"] + ".json": errs.append("file name must be <id>.json")
    if q["category"] not in CATS: errs.append(f"unknown category {q['category']}")
    if q["style"] not in STYLES: errs.append(f"unknown style {q['style']}")
    if q["icon"] not in ICONS: errs.append(f"unknown icon {q['icon']}")
    if not (1 <= int(q["difficulty"]) <= 5): errs.append("difficulty 1-5")
    if len(q["hint"]) > 110: errs.append("hint too long")
    pr = q["rules"].get("player", [])
    if not pr or len(pr) > 3: errs.append("rules.player: 1-3 lines")
    for k in ["accept", "exclude", "granularity"]:
        if not q["rules"].get(k): errs.append(f"rules.{k} missing")
    seen = {}
    for i, a in enumerate(q["answers"]):
        if not isinstance(a.get("a"), str) or not a["a"].strip(): errs.append(f"answer {i}: no text"); continue
        p = a.get("p")
        if not isinstance(p, (int, float)) or not (0 < p <= 0.9): errs.append(f"answer {a['a']}: p must be in (0, 0.9]")
        for name in [a["a"], *a.get("al", [])]:
            k = norm(name)
            if k in seen and seen[k] != a["a"]: errs.append(f"'{name}' listed under both {seen[k]} and {a['a']}")
            seen[k] = a["a"]
    n = len(q["answers"])
    if n < 40 and not q.get("kb"): errs.append(f"only {n} answers (need 40+)")
    total = sum(a.get("p", 0) for a in q["answers"])
    if not (1.2 <= total <= 4.0): errs.append(f"shares add up to {total:.2f} (expected about 2.5-2.8)")
    for w in q.get("general", []) + q.get("notIn", []):
        if norm(w) in seen: errs.append(f"'{w}' is both an answer and rejected")
    return errs
def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, "content", "questions", "*.json")))
    bad = 0
    for f in files:
        for e in check(f): print(f"{os.path.basename(f)}: {e}"); bad += 1
    print(f"{len(files)} files, {bad} problems"); sys.exit(1 if bad else 0)
if __name__ == "__main__": main()
