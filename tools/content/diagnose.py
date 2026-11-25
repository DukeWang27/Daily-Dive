"""Internal diagnostics for scheduled days. Never shipped to players (tools/ is excluded from the deploy).

  python3 tools/content/diagnose.py 16 17 18          # print a summary
  python3 tools/content/diagnose.py --json 16-22 > out.json

For each question: wording, rules, answer counts, where answers came from, a sample of common, uncommon and obscure
answers with their provisional depths, the quality report, and known limitations. Depths here are provisional:
estimated shares, not player data, so nothing is deeper than the caps in build.py until real players arrive.
"""
import json, os, sys, random
sys.path.insert(0, os.path.dirname(__file__))
import build

def sample(rows, k, rng):
    return [{"answer": r["a"], "share": round(r["p"], 6), "depth": build.depth_of(r["p"], bool(r.get("pv"))),
             "aliases": r.get("al", [])[:4], "source": r.get("src", "ai")} for r in (rng.sample(rows, k) if len(rows) > k else rows)]

def question(q, rep):
    rows, _ = build.answers_of(q)
    rows.sort(key=lambda r: -r["p"])
    rng = random.Random(q["id"])
    common = [r for r in rows if r["p"] >= 0.01]
    uncommon = [r for r in rows if 0.0005 <= r["p"] < 0.01]
    obscure = [r for r in rows if r["p"] < 0.0005]
    depths = [build.depth_of(r["p"], bool(r.get("pv"))) for r in rows]
    srcs = {}
    for r in rows:
        s = (r.get("src") or "ai").split(":")[0]
        srcs[s] = srcs.get(s, 0) + 1
    limits = []
    if any(r.get("pv") for r in rows): limits.append(f"{sum(1 for r in rows if r.get('pv'))} dataset-only answers have no share estimate yet; they are capped at {build.PROVISIONAL_CAP} m and marked 'rarity still being measured'.")
    limits.append("All shares are estimates until real players answer; depth beyond 299 m needs real evidence.")
    if not q.get("kb"): limits.append("No dataset backs this list; unlisted but valid answers go to the review queue.")
    if rep.get("flags"): limits.append("Quality flags: " + "; ".join(rep["flags"]))
    return {
        "id": q["id"], "prompt": q["prompt"], "title": q["title"], "category": q["category"], "style": q["style"], "difficulty": q["difficulty"],
        "rules_player": q["rules"]["player"], "accept": q["rules"].get("accept", []), "exclude": q["rules"].get("exclude", []),
        "granularity": q["rules"].get("granularity"), "dataset": q.get("kb"),
        "answers": len(rows), "aliases": sum(len(r.get("al", [])) for r in rows), "sources": srcs,
        "counts": {"common": len(common), "uncommon": len(uncommon), "obscure": len(obscure)},
        "depth_range": [min(depths), max(depths)], "deepest_possible_now": max(depths),
        "quality": {k: rep.get(k) for k in ("score", "status", "flags", "top_share", "share_sum")},
        "common": sample(common[:6], 6, rng), "uncommon": sample(uncommon, 6, rng), "obscure": sample(obscure, 6, rng),
        "limitations": limits,
    }

def day(n, qs, reps, sched):
    ids = sched["days"].get(str(n))
    if not ids: return None
    out = [question(qs[i], reps.get(i, {})) for i in ids]
    return {"day": n, "questions": out,
            "totals": {"answers": sum(x["answers"] for x in out), "aliases": sum(x["aliases"] for x in out),
                       "categories": sorted({x["category"] for x in out}), "styles": sorted({x["style"] for x in out}),
                       "difficulties": [x["difficulty"] for x in out]}}

def parse(args):
    out = []
    for a in args:
        if "-" in a: lo, hi = map(int, a.split("-")); out += range(lo, hi + 1)
        else: out.append(int(a))
    return out

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    qs = {q["id"]: q for q in build.load_questions()}
    reps = json.load(open(os.path.join(build.C, "report", "quality.json")))["questions"]
    sched = json.load(open(os.path.join(build.C, "schedule.json")))
    res = [d for d in (day(n, qs, reps, sched) for n in parse(args or ["16-22"])) if d]
    if "--json" in sys.argv: print(json.dumps(res, indent=1, ensure_ascii=False)); sys.exit()
    for d in res:
        t = d["totals"]
        print(f"Day {d['day']}: {t['answers']} answers, {t['aliases']} other names, categories {', '.join(t['categories'])}, difficulty {t['difficulties']}")
        for x in d["questions"]:
            c = x["counts"]
            print(f"  {x['prompt']}  [{x['category']}/{x['style']}/d{x['difficulty']}] {x['answers']} answers "
                  f"({c['common']} common, {c['uncommon']} uncommon, {c['obscure']} obscure), deepest now {x['deepest_possible_now']} m, quality {x['quality']['score']}")
