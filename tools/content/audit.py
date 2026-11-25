"""Audit of the question bank: what exists, how much answer coverage each question has, and how rarity is produced.
    python3 tools/content/audit.py            -> prints a report (markdown)
    python3 tools/content/audit.py --json     -> the same figures as JSON
Reads the built files the game ships (days/*.json, race/*.json) and the new content folder if present."""
import json, glob, os, statistics, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

def load(pattern):
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, pattern))):
        if f.endswith("index.json"): continue
        d = json.load(open(f))
        for i, q in enumerate(d.get("questions", [])): out.append((os.path.basename(f), i + 1, q))
    return out

def stats(xs):
    xs = sorted(xs)
    return {"n": len(xs), "mean": round(statistics.mean(xs), 1), "median": statistics.median(xs), "min": xs[0], "max": xs[-1]} if xs else {}

def main():
    daily, race = load("days/*.json"), load("race/*.json")
    idx = json.load(open(os.path.join(ROOT, "days", "index.json")))
    keys = [q["key"] for f, r, q in daily if f != "0.json"]
    per = [len(q["answers"]) for f, r, q in daily if f != "0.json"]
    al = [sum(len(a.get("al", [])) for a in q["answers"]) for f, r, q in daily if f != "0.json"]
    style = {"pattern (word starts/ends/contains)": 0, "category (name a ...)": 0}
    for f, r, q in daily:
        if f == "0.json": continue
        style["pattern (word starts/ends/contains)" if q.get("pattern") or q.get("prefix") else "category (name a ...)"] += 1
    small = sorted(((len(q["answers"]), q["key"], q["prompt"]) for f, r, q in daily if f != "0.json"))[:8]
    shares = [a["s"] for f, r, q in daily for a in q["answers"]]
    deep = sum(1 for s in shares if s < 1e-4)
    out = {
        "days_prepared": idx.get("count"), "daily_slots": len(keys), "unique_daily_questions": len(set(keys)),
        "repeated_daily_keys": sorted({k for k in keys if keys.count(k) > 1}),
        "race_questions": len(race), "answers_per_daily_question": stats(per), "aliases_per_daily_question": stats(al),
        "styles": style, "smallest": small, "sample_players_claimed": idx.get("samplePlayers"),
        "answers_rarer_than_1_in_10000_by_simulation": deep, "total_answers": len(shares),
    }
    if "--json" in sys.argv: print(json.dumps(out, indent=1)); return
    print("# Question bank audit\n")
    for k, v in out.items(): print(f"- **{k}**: {v}")

if __name__ == "__main__":
    main()
