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

def main():
    os.makedirs(OUT, exist_ok=True)
    # Same order as the playtest's days 301-314: interleaved across the batches.
    batches = []
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "curated", "batch-*.json"))):
        b = os.path.basename(p)[:-5]
        batches.append([(b, q) for q in json.load(open(p))["questions"] if q.get("verdict") == "keep" and q.get("answers")])
    order = []
    while any(batches):
        for lst in batches:
            if lst: order.append(lst.pop(0))
    written = 0
    for i, (b, q) in enumerate(order):
        rows = C.rows_of(q)
        acc, exc = split_rules(q.get("rules", []))
        cq = C.question(q, b)
        out = {"id": "c-" + q["id"], "prompt": q["prompt"], "hint": q.get("hint", ""), "title": q["prompt"], "icon": ICON[b],
               "category": CATEGORY[b], "style": "curated", "topic": q["id"], "difficulty": 3,
               "set": "curated-1", "plan": {"day": i // 5 + 1 + PLAN_OFFSET, "slot": i % 5 + 1}, "approved": True,
               "rules": {"player": q.get("rules", []), "accept": acc, "exclude": exc or ["anything outside the rule above"],
                         "granularity": q.get("granularity") or "one answer per thing named", "synonyms": "other names, spellings and short forms are the same answer"},
               "general": [], "notIn": [],   # as tested in the playtest and the challenge runs
               "answers": [{"a": r["a"], "al": r["al"], "p": r["s"], "tier": r["tier"], "src": "curated"} for r in rows],
               "kb": None, "closed": False}
        if cq.get("kb"): out["client_kb"] = cq["kb"]; out["granularity_mode"] = cq.get("granularity")
        if cq.get("mode"): out["mode"] = cq["mode"]
        json.dump(out, open(os.path.join(OUT, out["id"] + ".json"), "w"), indent=1, ensure_ascii=False)
        written += 1
    print(f"wrote {written} curated questions to content/questions (plan days {1 + PLAN_OFFSET}..{(written - 1) // 5 + 1 + PLAN_OFFSET})")

if __name__ == "__main__":
    main()
