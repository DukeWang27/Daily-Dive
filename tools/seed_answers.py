"""Turns the day files into the database's rarity tables.

Run after tools/build_days.py:   python tools/seed_answers.py
Writes supabase/0003_answers_*.sql (five sets of questions per file, to keep each small enough to paste).
Each accepted answer is stored with its share and the depth it earns, worked out exactly as the game does,
so the score the database gives is the score the player saw.
"""
import json, math, os, glob

ROOT = os.path.join(os.path.dirname(__file__), "..")
SURFACE = 0.10

def depth(share):
    """The game's rule (iceberg.js depthOf), with JavaScript's rounding."""
    if share >= SURFACE:
        return 0
    return max(1, math.floor(100 * math.log10(SURFACE / share) + 0.5))

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
            for r, c in enumerate(day["questions"], 1):
                table = {a["a"]: [a["s"], depth(a["s"])] for a in c["answers"]}
                total += len(table)
                out.append(f"insert into public.set_answers select {n}, {r}, key, (value->>0)::double precision, (value->>1)::int from jsonb_each({q(json.dumps(table, separators=(',', ':')))}::jsonb);")
            out.append("")
        out.append(f"update public.game_config set value = greatest(value::int, {sets[-1]})::text where key = 'set_count';")
        name = f"0003_answers_{sets[0]:02d}_{sets[-1]:02d}.sql"
        open(os.path.join(ROOT, "supabase", name), "w").write("\n".join(out) + "\n")
        print(name, round(os.path.getsize(os.path.join(ROOT, "supabase", name)) / 1024), "KB")
    print(total, "answers in", count, "sets")

if __name__ == "__main__":
    main()
