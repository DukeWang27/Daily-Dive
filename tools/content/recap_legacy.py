"""One-off, matching supabase/0006_content.sql part 5: in the original day files not yet played (days 3-15) and the race
pool, no answer may go beneath the iceberg on simulated evidence. Their shares are floored at 0.0001023 (= 299 m).
Days 1 and 2 were already played under the old rule and are left exactly as they were."""
import json, glob, os
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
FLOOR, PLAYED = 0.0001023, {1, 2}
n = 0
for f in sorted(glob.glob(os.path.join(ROOT, "days", "*.json")) + glob.glob(os.path.join(ROOT, "race", "*.json"))):
    if f.endswith("index.json"): continue
    d = json.load(open(f))
    if "days" in f and d.get("day") in PLAYED | {0}: continue
    changed = 0
    for q in d["questions"]:
        for a in q["answers"]:
            if a["s"] < FLOOR: a["s"] = FLOOR; changed += 1
    if changed: json.dump(d, open(f, "w"), separators=(",", ":")); n += changed
print(f"floored {n} answers")
