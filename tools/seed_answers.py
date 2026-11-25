"""Turns the day files into the database's rarity tables.

Run after tools/build_days.py:   python tools/seed_answers.py
Writes supabase/0003_answers_*.sql (five sets of questions per file, to keep each small enough to paste).
Each accepted answer is stored with its share and the depth it earns, worked out exactly as the game does,
so the score the database gives is the score the player saw.
"""
import json, math, os, glob, re, unicodedata

ROOT = os.path.join(os.path.dirname(__file__), "..")
SURFACE = 0.10

BEYOND_M = 300                     # beneath the iceberg: "Challenger Deep"
EVIDENCE_PLAYERS, EVIDENCE_MIN = 120_000, 3   # the sample behind each rarity table, and how many must have given an answer


def depth(share):
    """The game's rule (iceberg.js depthOf), with JavaScript's rounding. An answer only goes deeper than the iceberg
    (300 m, rarer than 1 in 10,000) when at least 3 players of the table's sample gave it; otherwise it stops at 299 m."""
    if share >= SURFACE:
        return 0
    d = max(1, math.floor(100 * math.log10(SURFACE / share) + 0.5))
    if d >= BEYOND_M and math.floor(share * EVIDENCE_PLAYERS + 0.5) < EVIDENCE_MIN:
        return BEYOND_M - 1
    return d

# The same rules as validate.js (normalize, variants), so the database recognises a typed answer the way the game does.
IRREGULAR = {"mice": "mouse", "geese": "goose", "oxen": "ox", "teeth": "tooth", "people": "person", "feet": "foot", "children": "child",
             "wolves": "wolf", "knives": "knife", "leaves": "leaf", "cacti": "cactus", "octopi": "octopus", "fungi": "fungus", "dice": "die"}
def normalize(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn").lower()
    s = s.replace("&", " and ").replace("'", "").replace("\u2019", "")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^(a|an|the|some) ", "", s)
def variants(w):
    out = [w]
    m = re.match(r"^(.*?)([a-z0-9]+)$", w)
    if not m: return out
    head, last = m.groups()
    def add(x):
        v = head + x
        if v not in out: out.append(v)
    if last.endswith("ies") and len(last) > 4: add(last[:-3] + "y")
    if last.endswith("ives"): add(last[:-4] + "ife")
    if last.endswith("ves"): add(last[:-3] + "f")
    if re.search(r"(s|x|z|ch|sh|o)es$", last): add(last[:-2])
    if last.endswith("s") and not re.search(r"(ss|us|is)$", last): add(last[:-1])
    if last in IRREGULAR: add(IRREGULAR[last])
    return out
def keys_of(c):
    """Every spelling the game recognises for each answer: its name, other names, and their plural forms."""
    index = {}
    def put(k, a):
        if k and k not in index: index[k] = a
    for a in c["answers"]: put(normalize(a["a"]), a["a"])
    for a in c["answers"]:
        for name in a.get("al", []): put(normalize(name), a["a"])
    for a in c["answers"]:
        for name in [a["a"], *a.get("al", [])]:
            for v in variants(normalize(name))[1:]: put(v, a["a"])
    return index

def q(text):
    return "'" + text.replace("'", "''") + "'"

def main():
    count = json.load(open(os.path.join(ROOT, "days", "index.json")))["count"]
    for old in glob.glob(os.path.join(ROOT, "supabase", "0003_answers_*.sql")):
        os.remove(old)
    per_file, total = 5, 0
    for start in range(1, count + 1, per_file):
        sets = list(range(start, min(count, start + per_file - 1) + 1))
        out = [f"-- Rarity tables for question sets {sets[0]} to {sets[-1]}. Made by tools/seed_answers.py: do not edit by hand.",
               "-- Paste into Supabase: SQL Editor → New query → Run. Run 0002 first. Safe to run again.", ""]
        for n in sets:
            day = json.load(open(os.path.join(ROOT, "days", f"{n}.json")))
            qs = [{"key": c["key"], "title": c["title"]} for c in day["questions"]]
            out.append(f"insert into public.answer_sets values ({n}, {q(json.dumps(qs))}::jsonb) on conflict (set_id) do update set questions = excluded.questions;")
            out.append(f"delete from public.set_answers where set_id = {n};")
            out.append(f"delete from public.set_keys where set_id = {n};")
            for r, c in enumerate(day["questions"], 1):
                table = {a["a"]: [a["s"], depth(a["s"])] for a in c["answers"]}
                total += len(table)
                out.append(f"insert into public.set_answers select {n}, {r}, key, (value->>0)::double precision, (value->>1)::int from jsonb_each({q(json.dumps(table, separators=(',', ':')))}::jsonb);")
                out.append(f"insert into public.set_keys select {n}, {r}, key, value #>> '{{}}' from jsonb_each({q(json.dumps(keys_of(c), separators=(',', ':')))}::jsonb);")
            out.append("")
        out.append(f"update public.game_config set value = greatest(value::int, {sets[-1]})::text where key = 'set_count';")
        name = f"0003_answers_{sets[0]:02d}_{sets[-1]:02d}.sql"
        open(os.path.join(ROOT, "supabase", name), "w").write("\n".join(out) + "\n")
        print(name, round(os.path.getsize(os.path.join(ROOT, "supabase", name)) / 1024), "KB")
    print(total, "answers in", count, "sets")

if __name__ == "__main__":
    main()
