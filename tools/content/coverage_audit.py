"""Answer-coverage audit of every question in the bank (days/*.json live and content/build/days prepared).
Run: python3 tools/content/coverage_audit.py  ->  content/review/coverage-audit.json (+ a summary on stdout)

For each question: how many answers and other names its own list has; whether a reference list (content/kb) backs it;
and, where one does, how much of the reference list the question's own list already recognises. That last figure is the
honest one: a reference list is written independently of the question, so the share of its entries the question would
reject is a direct estimate of how often a legitimate, rarer answer is turned away.

Weak = no reference list and fewer than WEAK_MIN answers, or a reference list of which it covers less than half.
"""
import json, os, glob, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "tools", "playtest"))
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()
KB = {"Name a job": "occupations"}
# The playtest's prompt -> reference list map (tools/playtest/build.py), read without running that script.
_src = open(os.path.join(ROOT, "tools", "playtest", "build.py")).read()
KB.update(eval(re.search(r"^KB = (\{.*?\})\n", _src, re.S | re.M).group(1)))
WEAK_MIN = 150

def plural_forms(k):
    out = {k}
    if k.endswith("s"): out.add(k[:-1])
    else: out.add(k + "s")
    if k.endswith("ies"): out.add(k[:-3] + "y")
    if k.endswith("es"): out.add(k[:-2])
    return out

def kb_names(dom):
    p = os.path.join(ROOT, "content", "kb", dom + ".json")
    if not os.path.exists(p): return None
    d = json.load(open(p))
    rows = d["rows"] if isinstance(d, dict) and "rows" in d else d if isinstance(d, list) else d.get("items", [])
    out = []
    for r in rows:
        if isinstance(r, str): out.append([r])
        elif isinstance(r, dict): out.append([r.get("a") or r.get("name") or r.get("canonical") or ""] + list(r.get("al") or r.get("aliases") or []))
        elif isinstance(r, list): out.append([str(r[0])])
    return [x for x in out if x[0]]

def main():
    seen, rows = set(), []
    files = [(p, "live") for p in sorted(glob.glob(os.path.join(ROOT, "days", "[0-9]*.json")))] + [(p, "prepared") for p in sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json")))]
    for path, where in files:
        for q in json.load(open(path)).get("questions", []):
            if q["key"] in seen: continue
            seen.add(q["key"])
            prompt = q.get("prompt") or q.get("title")
            keys = set()
            for a in q["answers"]:
                for n in [a["a"]] + list(a.get("al") or []): keys |= plural_forms(norm(n))
            r = {"key": q["key"], "prompt": prompt, "where": where, "answers": len(q["answers"]), "aliases": sum(len(a.get("al") or []) for a in q["answers"]),
                 "provisional": sum(1 for a in q["answers"] if a.get("pv")), "reference": KB.get(prompt)}
            kb = kb_names(r["reference"]) if r["reference"] else None
            if kb:
                hit = sum(1 for names in kb if any(plural_forms(norm(n)) & keys for n in names))
                r["reference_size"] = len(kb); r["reference_covered"] = round(hit / len(kb), 3)
                r["missing_examples"] = [names[0] for names in kb if not any(plural_forms(norm(n)) & keys for n in names)][:12]
            r["weak"] = (not kb and r["answers"] < WEAK_MIN) or (bool(kb) and r["reference_covered"] < 0.5)
            rows.append(r)
    rows.sort(key=lambda r: (not r["weak"], r.get("reference_covered", 1), r["answers"]))
    os.makedirs(os.path.join(ROOT, "content", "review"), exist_ok=True)
    json.dump(rows, open(os.path.join(ROOT, "content", "review", "coverage-audit.json"), "w"), indent=1)
    weak = [r for r in rows if r["weak"]]
    with_ref = [r for r in rows if r.get("reference_size")]
    print(f"{len(rows)} questions; {len(with_ref)} backed by a reference list; {len(weak)} weak")
    print(f"answers per question: median {sorted(r['answers'] for r in rows)[len(rows)//2]}; aliases per answer: {sum(r['aliases'] for r in rows)/max(1,sum(r['answers'] for r in rows)):.2f}")
    for r in with_ref[:40]:
        print(f"  {r['prompt'][:46]:46} {r['answers']:5} own; covers {100*r['reference_covered']:5.1f}% of {r['reference_size']:6} reference  e.g. {', '.join(r['missing_examples'][:4])}")
    print("weak, no reference list:")
    for r in [r for r in weak if not r.get("reference_size")][:60]: print(f"  {r['prompt'][:70]:70} {r['answers']:4} answers ({r['where']})")

if __name__ == "__main__":
    main()
