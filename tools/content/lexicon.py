"""content/kb/lexicon.json: every answer to the game's plain category questions ("Name a bird", "Name a dinosaur or
other prehistoric animal"), with the categories it belongs to. Used only to explain an answer that isn't on the
current question's list: "Pterodactyl is on our list for a dinosaur or other prehistoric animal, not this question."
It never makes an answer count. Run: python3 tools/content/lexicon.py"""
import json, glob, os, re
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()
labels, lid, names = [], {}, {}
for p in sorted(glob.glob(os.path.join(ROOT, "days", "[0-9]*.json"))) + sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json"))):
    for q in json.load(open(p))["questions"]:
        lab = q.get("prompt") or ""
        if not re.match(r"^Name (a|an) [A-Za-z ,'-]+$", lab) or q.get("pattern") or q.get("prefix") or " word" in lab: continue
        short = re.sub(r"^Name ", "", lab)
        if short not in lid: lid[short] = len(labels); labels.append(short)
        i = lid[short]
        for a in q["answers"]:
            for x in [a["a"]] + (a.get("al") or []):
                k = norm(x)
                if len(k) >= 3:
                    s = names.setdefault(k, [])
                    if i not in s: s.append(i)
json.dump({"labels": labels, "names": names}, open(os.path.join(ROOT, "content", "kb", "lexicon.json"), "w"), separators=(",", ":"))
print(len(labels), "categories,", len(names), "names")
