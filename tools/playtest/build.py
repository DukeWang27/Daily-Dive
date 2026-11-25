"""Builds the private playtest bundle: every day there is, playable without the database.
Output: <out>/pt/<n>.json and <out>/pt/list.json. Days 1-3 are the live files, 4-93 the prepared days in
content/build/days, and 101-114 the review sample in content/review/sample-14-days-v4.json, converted to the game's
format with rough shares by tier (they have no player counts yet). Never published to the public site.
Usage: python3 tools/playtest/build.py <out-dir>"""
import json, os, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
out = sys.argv[1]; os.makedirs(os.path.join(out, "pt"), exist_ok=True)
ICON = {"food": "apple", "fiction-food": "cake", "animal": "paw", "bird": "bird", "dog": "paw", "pets": "paw", "tree": "leaf",
        "botany": "flower", "space": "planet", "volcano": "bolt", "element": "atom", "substance": "atom", "material": "gem",
        "sport": "ball", "video-game": "dragon", "game": "dragon", "cartoon": "palette", "screen": "palette", "brand": "briefcase",
        "company": "briefcase", "money": "gem", "clothing": "shirt", "wear": "hat", "ocean": "wave", "island": "globe",
        "place": "pin", "country": "globe", "language": "speech", "pronunciation": "speech", "idiom": "speech", "phrase": "speech",
        "word": "speech", "letter": "note", "name": "note", "reading": "book", "story": "book", "fiction": "book", "body": "hand",
        "senses": "hand", "family": "heart", "home": "door", "traffic": "car", "history": "building", "monaster": "building",
        "institution": "building", "deep-time": "globe", "water": "wave", "air": "cloud", "superstition": "cloud", "hoax": "cloud"}
def icon(topic):
    for k, v in ICON.items():
        if k in topic: return v
    return "default"

days = []
def put(n, d, group, source):
    d = dict(d); d["day"] = n
    with open(os.path.join(out, "pt", f"{n}.json"), "w") as f: json.dump(d, f, separators=(",", ":"))
    days.append({"n": n, "group": group, "source": source, "questions": [q.get("prompt") or q.get("title") for q in d["questions"]]})

for n in (1, 2, 3): put(n, json.load(open(os.path.join(ROOT, "days", f"{n}.json"))), "live", f"days/{n}.json")
for p in sorted(glob.glob(os.path.join(ROOT, "content/build/days/*.json")), key=lambda p: int(os.path.basename(p)[:-5])):
    n = int(os.path.basename(p)[:-5]); put(n, json.load(open(p)), "prepared", f"content/build/days/{n}.json")

# Rough shares: within each tier, earlier answers are a little more common.
TIERS = [("common", 0.16, 0.03), ("less_common", 0.012, 0.002), ("obscure", 0.0006, 0.00005)]
sample = json.load(open(os.path.join(ROOT, "content/review/sample-14-days-v4.json")))
for i, day in enumerate(sample["days"]):
    qs = []
    for q in day["questions"]:
        rows = []
        for tier, hi, lo in TIERS:
            items = q["answers"].get(tier, [])
            for j, a in enumerate(items):
                s = hi if len(items) == 1 else hi * (lo / hi) ** (j / (len(items) - 1))
                name, al = (a, []) if isinstance(a, str) else (a["canonical"], a.get("aliases", []))
                rows.append({"a": name.lower(), "s": round(s, 6), "al": [x.lower() for x in al]})
        qs.append({"key": "v4-" + q["id"], "title": q["topic"].replace("-", " ").capitalize(), "icon": icon(q["topic"]),
                   "prompt": q["prompt"], "hint": "", "rules": [q["acceptance_rule"]],
                   "answers": rows, "general": [], "notIn": [], "category": q["topic"],
                   "review": {"format": q.get("format"), "framework": q.get("framework"), "pool": q.get("estimated_pool_size", {}).get("estimate")}})
    put(101 + i, {"v": 3, "questions": qs}, "new", f"sample-14-days-v4 day {day['day']}")

json.dump({"days": days}, open(os.path.join(out, "pt", "list.json"), "w"), separators=(",", ":"))
print(len(days), "days")
