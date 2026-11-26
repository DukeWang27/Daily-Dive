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

# "Name a kind of X" questions get every X the datasets know (content/kb, from Wikidata and IOC), the way Krillion
# describes building its answer sets: aggregate sources, merge, clean. Listed answers keep their estimates; dataset
# answers start from a familiarity prior and are marked pv (rarity still being measured). See tools/content/kbmerge.py.
sys.path.insert(0, os.path.join(ROOT, "tools", "content"))
import kbmerge
KB = {"Name a cheese": "cheeses", "Name a pasta shape": "pasta", "Name a kind of bread": "breads", "Name a soup": "soups",
      "Name a dessert": "desserts", "Name a sauce or condiment": "sauces", "Name a herb or spice": "spices", "Name a vegetable": "vegetables",
      "Name a fruit": "fruits", "Name a car brand": "car_brands", "Name a god or goddess": "deities", "Name a mythical creature": "creatures",
      "Name a mathematician": "mathematicians", "Name an inventor": "inventors", "Name a famous photographer": "photographers",
      "Name an opera": "operas", "Name a famous painting": "paintings", "Name a font or typeface": "typefaces", "Name a genre of music": "music_genres",
      "Name a film genre": "film_genres", "Name a sport": "sports", "Name a logical fallacy": "fallacies",
      "Name a desert": "deserts", "Name a sea or ocean": "seas", "Name a colour": "colours", "Name a bird": "birds", "Name a dog breed": "dog_breeds",
      "Name a musical instrument": "instruments", "Name a language": "languages", "Name a chemical element": "elements", "Name a country": "countries",
      "Name a volcano": "volcanoes"}
coverage = []
def widen(q):
    dom = KB.get(q.get("prompt") or q.get("title"))
    if not dom or not os.path.exists(os.path.join(ROOT, "content", "kb", dom + ".json")): return
    before = len(q["answers"]); q["answers"] = json.loads(json.dumps(q["answers"]))
    _, added = kbmerge.merge(q["answers"], dom)
    coverage.append({"prompt": q.get("prompt"), "domain": dom, "before": before, "after": before + added})

days = []
def put(n, d, group, source):
    d = json.loads(json.dumps(d)); d["day"] = n
    for q in d["questions"]: widen(q)
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

# Experimental round types, themes, routes and chains (tools/playtest/experiments.py): playtest only.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import experiments
days += experiments.build(out, widen)
json.dump({"days": days}, open(os.path.join(out, "pt", "list.json"), "w"), separators=(",", ":"))
json.dump(coverage, open(os.path.join(out, "pt", "coverage.json"), "w"), indent=1)
print(len(days), "days")
