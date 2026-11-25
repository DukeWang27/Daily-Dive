"""Alias audit: every question's answer list, checked for
  1. two listed answers that are one thing under two names (same WordNet sense, or one is listed as the other's alias),
     which would give one thing two depths and split its counts;
  2. other names WordNet knows for a listed answer that are missing from its aliases.
Writes content/report/alias-audit.json (private) and prints a summary. Usage: python3 tools/content/alias_audit.py"""
import glob, json, os, re
from nltk.corpus import wordnet as wn
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s.lower())).strip()
def senses(name):
    return set(s.name() for s in wn.synsets(name.replace(" ", "_"), pos=wn.NOUN))
def files():
    for f in sorted(glob.glob(os.path.join(ROOT, "days", "*.json"))):
        if os.path.basename(f)[0].isdigit() and os.path.basename(f) != "0.json": yield "live", f
    for f in sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json")), key=lambda x: int(re.sub(r"\D", "", os.path.basename(x)) or 0)): yield "prepared", f
dups, missing, n_q, n_a = [], [], 0, 0
for kind, f in files():
    day = json.load(open(f)); qs = day.get("questions") or []
    for q in qs:
        n_q += 1; rows = q.get("answers", []); n_a += len(rows)
        names = {}
        for r in rows:
            for nm in [r["a"]] + (r.get("al") or []): names.setdefault(norm(nm), set()).add(r["a"])
        for k, owners in names.items():
            if len(owners) > 1: dups.append({"day": day.get("day"), "q": q["key"], "name": k, "answers": sorted(owners), "why": "same name listed under two answers"})
        # Same single, specific WordNet sense: one thing under two names. Only senses with few lemmas, so broad words don't merge.
        by_sense = {}
        for r in rows:
            ss = senses(r["a"])
            if len(ss) == 1:
                s = next(iter(ss))
                if len(wn.synset(s).lemmas()) <= 6: by_sense.setdefault(s, []).append(r["a"])
        for s, owners in by_sense.items():
            if len(owners) > 1: dups.append({"day": day.get("day"), "q": q["key"], "name": s, "answers": owners, "why": "one WordNet sense"})
        for r in rows:
            have = {norm(x) for x in [r["a"]] + (r.get("al") or [])}
            ss = senses(r["a"])
            if len(ss) != 1: continue                      # ambiguous names: no automatic aliases
            extra = [norm(l.name().replace("_", " ")) for l in wn.synset(next(iter(ss))).lemmas()]
            extra = [e for e in extra if e not in have and len(e) > 2 and e not in names and not e.isupper()]
            if extra: missing.append({"day": day.get("day"), "q": q["key"], "answer": r["a"], "suggest": extra})
os.makedirs(os.path.join(ROOT, "content", "report"), exist_ok=True)
json.dump({"questions": n_q, "answers": n_a, "duplicates": dups, "missingAliases": missing}, open(os.path.join(ROOT, "content", "report", "alias-audit.json"), "w"), indent=1)
print(f"{n_q} questions, {n_a} answers: {len(dups)} possible duplicate entities, {len(missing)} answers with other names not yet listed")
for d in dups[:25]: print("  DUP", d["day"], d["q"], d["answers"], "-", d["why"])
for m in missing[:25]: print("  ALIAS", m["day"], m["q"], m["answer"], "+", m["suggest"])
