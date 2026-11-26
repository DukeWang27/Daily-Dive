"""Data for the question review dashboard in the private playtest (review.js): every question in the bank with its
answers, other names, estimated rarity, reference-list coverage and automatic quality checks.
Usage: python3 tools/playtest/review_data.py <out dir>   (writes <out>/pt/review.json; called by build.py)

Sources: the live days (days/*.json), the scheduled prepared days (content/build/days), the reviewed question files
(content/questions, which include unscheduled ones), the v3 and v4 candidate sets (content/review) and the experimental
questions. Everything private stays inside the private playtest; nothing here is published elsewhere.
"""
import json, os, glob, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()
_src = open(os.path.join(ROOT, "tools", "playtest", "build.py")).read()
KB = eval(re.search(r"^KB = (\{.*?\})\n", _src, re.S | re.M).group(1)); KB["Name a job"] = "occupations"
KEY_KB = {"jobs": "occupations"}
AUDIT = {r["key"]: r for r in json.load(open(os.path.join(ROOT, "content", "review", "coverage-audit.json")))} if os.path.exists(os.path.join(ROOT, "content", "review", "coverage-audit.json")) else {}

def tiers_to_rows(ans):
    """Hand-written tiered answers ({common: [...], less_common: [...], obscure: [...]}) as rows."""
    rows = []
    for tier, s in (("common", 0.05), ("less_common", 0.005), ("obscure", 0.0003)):
        for a in ans.get(tier, []):
            name, al = (a, []) if isinstance(a, str) else ((a[0], a[1:]) if isinstance(a, list) else (a.get("canonical"), a.get("aliases", [])))
            rows.append([name, s, al, 0, tier])
    return rows

def compact(q):
    rows = []
    ans = q.get("answers")
    if isinstance(ans, dict): return tiers_to_rows(ans)
    for a in ans or []:
        if isinstance(a, dict) and "a" in a: rows.append([a["a"], a.get("s"), a.get("al") or [], 1 if a.get("pv") else 0])
        elif isinstance(a, dict): rows.append([a.get("canonical") or a.get("name"), a.get("share") or a.get("s"), a.get("aliases") or [], 0])
        elif isinstance(a, str): rows.append([a, None, [], 0])
    return rows

def checks(q, rows):
    out = []
    n = len(rows); prompt = q.get("prompt") or ""
    ref = q.get("kb_name")
    if n < 60: out.append(["thin", f"only {n} answers"])
    elif n < 150 and not ref: out.append(["no-reference", f"{n} answers and no reference list to catch rarer ones"])
    al = sum(len(r[2]) for r in rows) / max(1, n)
    if al < 0.3: out.append(["few-names", f"{al:.2f} other names per answer"])
    cov = AUDIT.get(q.get("key") or q.get("id"), {}).get("reference_covered")
    if cov is not None and cov < 0.5: out.append(["low-coverage", f"its own list covers {round(100 * cov)}% of the reference list (widened in the playtest only)"])
    if re.search(r"\b(thing|stuff|something)\b", prompt, re.I) and n < 150: out.append(["broad", "a broad prompt with a short list: many fair answers will be pending"])
    if re.search(r"\b(famous|well[- ]known|popular)\b", prompt, re.I): out.append(["judgement", "'famous'/'popular' needs a clear bar for what counts"])
    if not q.get("rules"): out.append(["no-rules", "no written acceptance rules"])
    return out

def main(out):
    Q = {}
    def add(q, source, day=None):
        key = q.get("key") or q.get("id")
        if not key: return
        rows = compact(q)
        if not rows: return
        prompt = q.get("prompt") or q.get("title")
        e = Q.get(key)
        if e is None:
            rules = q.get("rules")
            if isinstance(rules, dict): rules = [f"{k}: {v}" for k, v in rules.items()]
            elif isinstance(rules, str): rules = [rules]
            ref = q.get("kb") if isinstance(q.get("kb"), str) else KEY_KB.get(key) or KB.get(prompt)
            e = Q[key] = {"id": key, "prompt": prompt, "hint": q.get("hint") or "", "category": q.get("category") or "", "rules": rules or ([q["acceptance_rule"]] if q.get("acceptance_rule") else []),
                          "sources": [], "days": [], "answers": rows, "kb_name": ref, "mode": (q.get("mode") or {}).get("type")}
            e["checks"] = checks(dict(q, kb_name=ref, key=key), rows)
            e["n"] = len(rows); e["aliases"] = sum(len(r[2]) for r in rows); e["provisional"] = sum(1 for r in rows if r[3])
            a = AUDIT.get(key)
            if a and a.get("reference_size"): e["reference"] = {"name": ref, "size": a["reference_size"], "covered": a["reference_covered"], "missing": a.get("missing_examples", [])[:12]}
        if source not in e["sources"]: e["sources"].append(source)
        if day is not None and day not in e["days"]: e["days"].append(day)
    for p in sorted(glob.glob(os.path.join(ROOT, "days", "[0-9]*.json"))):
        n = int(os.path.basename(p)[:-5])
        for q in json.load(open(p)).get("questions", []): add(q, "live" if n <= 3 else "set", n)
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json")), key=lambda p: int(os.path.basename(p)[:-5])):
        n = int(os.path.basename(p)[:-5])
        for q in json.load(open(p)).get("questions", []): add(q, "scheduled", n)
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "questions", "*.json"))):
        add(json.load(open(p)), "bank")
    v3 = os.path.join(ROOT, "content", "review", "v3-candidates.json")
    if os.path.exists(v3):
        for q in json.load(open(v3)).get("questions", []): add(q, "v3 candidate")
    v4 = os.path.join(ROOT, "content", "review", "sample-14-days-v4.json")
    if os.path.exists(v4):
        for d in json.load(open(v4))["days"]:
            for q in d["questions"]: add(q, "v4 candidate")
    exp = os.path.join(ROOT, "content", "experiments", "questions.json")
    if os.path.exists(exp):
        for q in json.load(open(exp))["questions"]: add(q, "experimental")
    data = {"built": "from the repository's question files", "questions": sorted(Q.values(), key=lambda e: (-len(e["checks"]), e["prompt"] or ""))}
    os.makedirs(os.path.join(out, "pt"), exist_ok=True)
    json.dump(data, open(os.path.join(out, "pt", "review.json"), "w"), separators=(",", ":"))
    return len(Q)

if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/review"), "questions")
