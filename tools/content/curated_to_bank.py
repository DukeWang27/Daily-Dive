"""The curated question set (content/curated/batch-*.json) into the question bank (content/questions/c-<id>.json, the
SPEC.md format), so the live schedule can use it. Questions marked "keep" by their researcher go in; "change" and
"reject" stay out until they're reworked. They carry set "curated-1" and a plan (day, slot) in the order the
playtest used (tools/playtest/curated.py), so they open the schedule from FIRST_DAY.

  python3 tools/content/curated_to_bank.py          (then: python3 tools/content/build.py all)

Shares: the researchers sorted answers into common / less common / obscure; within a tier the estimate falls
smoothly from the tier's top to its bottom, as in the playtest. They are estimates until players give real numbers.
"""
import json, os, glob, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "tools", "playtest"))
import curated as C
OUT = os.path.join(ROOT, "content", "questions")
FIRST_DAY = 6            # the first day the curated set plays; build.py's plan day 1 is FIRST_NEW_DAY (4)
PLAN_OFFSET = FIRST_DAY - 4
CATEGORY = {"batch-1": "internet", "batch-2": "business", "batch-3": "sport", "batch-4": "science", "batch-5": "geography",
            "batch-6": "history", "batch-7": "culture"}
ICON = {"batch-1": "default", "batch-2": "default", "batch-3": "default", "batch-4": "default", "batch-5": "globe", "batch-6": "default", "batch-7": "default"}
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()

def split_rules(rules):
    acc, exc, other = [], [], []
    for r in rules:
        if re.match(r"^\s*counts?:", r, re.I): acc.append(re.sub(r"^\s*counts?:\s*", "", r, flags=re.I))
        elif re.match(r"^\s*doesn'?t count:", r, re.I): exc.append(re.sub(r"^\s*doesn'?t count:\s*", "", r, flags=re.I))
        else: other.append(r)
    return acc or other[:1], exc

_mf = os.path.join(ROOT, "content", "curated", "method-fails.json")
FAILS = json.load(open(_mf))["fails"] if os.path.exists(_mf) else {}   # questions no source can list (QUESTION-METHOD.md)

def main():
    os.makedirs(OUT, exist_ok=True)
    # Same order as the playtest's days 301-314: interleaved across the batches.
    batches = []
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "curated", "batch-*.json"))):
        b = os.path.basename(p)[:-5]
        batches.append([(b, q) for q in json.load(open(p))["questions"] if q.get("verdict") == "keep" and q.get("answers") and q["id"] not in FAILS])
    order = []
    while any(batches):
        for lst in batches:
            if lst: order.append(lst.pop(0))
    written = 0
    for f in glob.glob(os.path.join(OUT, "c-*.json")): os.remove(f)   # the set is rewritten whole: a question taken out leaves no file behind
    for i, (b, q) in enumerate(order):
        rows = C.rows_of(q)
        acc, exc = split_rules(q.get("rules", []))
        cq = C.question(q, b)
        out = {"id": "c-" + q["id"], "prompt": q["prompt"], "hint": q.get("hint", ""), "title": q["prompt"], "icon": ICON[b],
               "category": CATEGORY.get(b, "general"), "style": "curated", "topic": q["id"], "difficulty": 3,
               "set": "curated-1", "plan": {"day": i // 5 + 1 + PLAN_OFFSET, "slot": i % 5 + 1}, "approved": True,
               "rules": {"player": q.get("rules", []), "accept": acc, "exclude": exc or ["anything outside the rule above"],
                         "granularity": q.get("granularity") or "one answer per thing named", "synonyms": "other names, spellings and short forms are the same answer"},
               "general": [], "notIn": [],   # as tested in the playtest and the challenge runs
               "answers": [{"a": r["a"], "al": r["al"], "p": r["s"], "tier": r["tier"] if r["tier"] != "wiki" else "obscure", "src": "wikipedia+wikidata" if r.get("pv") else "curated", **({"pv": True} if r.get("pv") else {})} for r in rows],
               "kb": None, "closed": False}
        if cq.get("kb"): out["client_kb"] = cq["kb"]; out["granularity_mode"] = cq.get("granularity")
        if cq.get("mode"): out["mode"] = cq["mode"]
        if cq.get("pearls"): out["pearls"] = cq["pearls"]
        json.dump(out, open(os.path.join(OUT, out["id"] + ".json"), "w"), indent=1, ensure_ascii=False)
        written += 1
    print(f"wrote {written} curated questions to content/questions (plan days {1 + PLAN_OFFSET}..{(written - 1) // 5 + 1 + PLAN_OFFSET})")

# ---------- The final set (27 Nov 2026): approved v3 questions, kept v2 questions and kept bank questions ----------
# Curated-format questions (content/curated/batch-*.json) that are approved v3, or v2 questions the bank vetting kept,
# become content/questions/f-<id>.json with set "final-1". Kept bank questions stay where they are. The ids of the whole
# set go to content/editorial/final-set.json, which build.py's scheduler then uses as its only pool for new days.
VET = os.path.join(ROOT, "content", "editorial", "bank-vetting.json")
FINAL_SET = os.path.join(ROOT, "content", "editorial", "final-set.json")
FORMAT_CAT = {"wordplay": "language", "media": "film-tv", "brands": "brands", "people": "people", "knowledge": "general", "lateral": "everyday", "property": "everyday", "category": "general"}

def final():
    vet = json.load(open(VET))["decisions"] if os.path.exists(VET) else []
    keep = {d["id"]: d for d in vet if d["decision"].startswith("KEEP")}
    for f in glob.glob(os.path.join(OUT, "f-*.json")): os.remove(f)
    ids, skipped = [], []
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "curated", "batch-*.json"))):
        b = os.path.basename(p)[:-5]
        for q in json.load(open(p))["questions"]:
            if not q.get("answers") or not (q.get("verdict") == "approved-v3" or (q["id"] in keep and q.get("verdict") == "proposed-v2")): continue
            if q.get("approved") is False: skipped.append(q["id"]); continue
            rows = C.rows_of(q); acc, exc = split_rules(q.get("rules", [])); cq = C.question(q, b)
            fmt = q.get("format") or (keep.get(q["id"]) or {}).get("format") or "category"
            out = {"id": "f-" + q["id"], "prompt": q["prompt"], "hint": q.get("hint", ""), "title": q["prompt"], "icon": ICON.get(b, "default"),
                   "category": q.get("category") or (keep.get(q["id"]) or {}).get("category") or FORMAT_CAT.get(fmt, "general"),
                   "style": fmt, "format": fmt, "topic": q["id"], "difficulty": 3, "set": "final-1", "approved": True,
                   "rules": {"player": q.get("rules", []), "accept": acc, "exclude": exc or ["anything outside the rule above"],
                             "granularity": q.get("granularity") or "one answer per thing named", "synonyms": "other names, spellings and short forms are the same answer"},
                   "general": [], "notIn": [],
                   "answers": [{"a": r["a"], "al": r["al"], "p": r["s"], "tier": r["tier"] if r["tier"] != "wiki" else "obscure", "src": "wikipedia+wikidata" if r.get("pv") else "curated", **({"pv": True} if r.get("pv") else {})} for r in rows],
                   "kb": None, "closed": False}
            for k in ("family", "season"):
                if q.get(k): out[k] = q[k]
            if cq.get("kb"): out["client_kb"] = cq["kb"]; out["granularity_mode"] = cq.get("granularity")
            if cq.get("mode"): out["mode"] = cq["mode"]
            if cq.get("pearls"): out["pearls"] = cq["pearls"]
            if cq.get("exact"): out["exact"] = True
            json.dump(out, open(os.path.join(OUT, out["id"] + ".json"), "w"), indent=1, ensure_ascii=False)
            ids.append(out["id"])
    for i, d in keep.items():
        f = os.path.join(OUT, i + ".json")
        if not os.path.exists(f): continue
        q = json.load(open(f))
        if q.get("approved") is False: skipped.append(i); continue
        changed = False
        for k, v in (("format", d.get("format")), ("style", q.get("format") or d.get("format"))):
            if v and not q.get(k): q[k] = v; changed = True
        if changed: json.dump(q, open(f, "w"), indent=1, ensure_ascii=False)
        ids.append(i)
    json.dump({"note": "The final question set: build.py schedules new days from these only.", "ids": ids}, open(FINAL_SET, "w"), indent=1)
    print(f"final set: {len(ids)} questions ({sum(i.startswith('f-') for i in ids)} curated-format, {sum(not i.startswith('f-') for i in ids)} bank); not approved: {skipped}")

if __name__ == "__main__":
    final() if "--final" in sys.argv else main()
