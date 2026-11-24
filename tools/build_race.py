"""Builds the submarine race's question pool: race/<n>.json, race/index.json and the database's copy of their
rarity tables (supabase/0005_race_answers.sql).

    python tools/build_race.py            (about a minute)

Race questions are separate from the daily calendar (tools/race_questions.py checks that no topic is shared), so a
race can never give away a daily answer. Each question gets a fixed rarity table, the same for every racer, scored
by the same depth rule as the daily game.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import race_questions as rq          # adds the race questions to the bank before the builder reads it
import build_days as bd
import seed_answers as sa

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "race")
FIRST_ID = 1001                      # race questions' ids in the database, clear of the daily sets (1, 2, 3...)


def main():
    bd.nltk.download("wordnet", quiet=True)
    os.makedirs(OUT, exist_ok=True)
    pool, sql = [], ["-- The submarine race's question pool: one rarity table per question. Made by tools/build_race.py.",
                     "-- Paste into Supabase after 0004_race.sql (SQL Editor → New query → Run). Safe to run again.", ""]
    for i, key in enumerate(rq.RACE):
        q = bd.build_question(key)
        qid = FIRST_ID + i
        with open(os.path.join(OUT, f"{qid}.json"), "w") as f:
            json.dump({"v": 3, "id": qid, "samplePlayers": bd.SAMPLE_PLAYERS, "questions": [q]}, f, separators=(",", ":"), ensure_ascii=False)
        pool.append({"id": qid, "key": key, "title": q["title"], "icon": q["icon"]})
        table = {a["a"]: [a["s"], sa.depth(a["s"])] for a in q["answers"]}
        sql.append(f"insert into public.answer_sets values ({qid}, {sa.q(json.dumps([{'key': key, 'title': q['title']}]))}::jsonb) on conflict (set_id) do update set questions = excluded.questions;")
        sql.append(f"delete from public.set_answers where set_id = {qid}; delete from public.set_keys where set_id = {qid};")
        sql.append(f"insert into public.set_answers select {qid}, 1, key, (value->>0)::double precision, (value->>1)::int from jsonb_each({sa.q(json.dumps(table, separators=(',', ':')))}::jsonb);")
        sql.append(f"insert into public.set_keys select {qid}, 1, key, value #>> '{{}}' from jsonb_each({sa.q(json.dumps(sa.keys_of(q), separators=(',', ':')))}::jsonb);")
        sql.append(f"insert into public.race_pool (qid, key, title) values ({qid}, {sa.q(key)}, {sa.q(q['title'])}) on conflict (qid) do update set key = excluded.key, title = excluded.title, active = true;")
        sql.append("")
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({"v": 3, "questions": pool}, f, separators=(",", ":"))
    with open(os.path.join(ROOT, "supabase", "0005_race_answers.sql"), "w") as f:
        f.write("\n".join(sql) + "\n")
    print(len(pool), "race questions")


if __name__ == "__main__":
    main()
