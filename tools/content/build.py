"""The content pipeline: question files -> quality reports -> duplicate checks -> schedule -> game and database files.

    python3 tools/content/build.py report            quality report for every question (content/report/*.json + summary)
    python3 tools/content/build.py schedule          choose five questions for each future day (content/schedule.json)
    python3 tools/content/build.py days [--public]   write the day files and their database scripts for scheduled days
    python3 tools/content/build.py all               all three, in order

Nothing here calls an AI service or the network: generation happens before (tools/content/generate.mjs, or a person
writing files by tools/content/SPEC.md). Everything here is deterministic and repeatable.
Day files for future days go to content/build/days/ (NOT the public days/ folder: upcoming answers stay private) and
their database rows to content/build/sql/. The game gets a day's content from the database on that day (day_content
in supabase/0006_content.sql). --public also copies them into days/ for a local preview build only."""
import json, glob, math, os, random, re, sys, datetime, collections
sys.path.insert(0, os.path.dirname(__file__))
import kbmerge
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
C = os.path.join(ROOT, "content")
FIRST_NEW_DAY, DAYS_WANTED = 16, 90          # days 1-15 are the original bank (already in the database as sets 1-15)
SURFACE, BEYOND_M = 0.10, 300
PROVISIONAL_CAP = 250                        # a dataset-only answer (no estimate, no players yet) can't go deeper than this
NO_EVIDENCE_CAP = BEYOND_M - 1               # nothing goes beneath the iceberg without real player evidence
STOP = set("name a an the of or and that you your is are in on to with something someone which who what can be it its for from at by as".split())
norm = kbmerge.norm

def depth_of(share, provisional=False, evidence=False):
    if share >= SURFACE: return 0
    d = max(1, math.floor(100 * math.log10(SURFACE / share) + 0.5))
    if provisional: d = min(d, PROVISIONAL_CAP)
    if not evidence: d = min(d, NO_EVIDENCE_CAP)
    return d

def load_questions():
    qs = []
    for f in sorted(glob.glob(os.path.join(C, "questions", "*.json"))):
        try: q = json.load(open(f))
        except Exception as e: print("unreadable", f, e); continue
        qs.append(q)
    return qs

def legacy_questions():
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "days", "*.json")) + glob.glob(os.path.join(ROOT, "race", "*.json"))):
        if f.endswith("index.json") or f.endswith(os.sep + "0.json"): continue
        for q in json.load(open(f))["questions"]:
            out.append({"id": "legacy:" + q["key"], "prompt": q["prompt"], "topic": q["key"], "answers": [{"a": a["a"], "p": a["s"]} for a in q["answers"]]})
    return out

# ---------- answers: datasets merged, estimates tidied ----------
def answers_of(q):
    rows = [dict(a) for a in q["answers"]]
    added = 0
    if q.get("kb"):
        rows, added = kbmerge.merge(rows, q["kb"]["domain"], q["kb"].get("filter"), share_key="p")
    for r in rows: r["p"] = min(r["p"], 0.6)              # nobody's answer is given by more than ~60% of players (only the top is trimmed)
    return rows, added

# ---------- quality ----------
def stem(w): return re.sub(r"(ies|es|s)$", "", w) if len(w) > 4 else w
def prompt_tokens(p): return {stem(w) for w in norm(p).split() if w not in STOP}
def answer_keys(rows, n=250): return {norm(r["a"]) for r in sorted(rows, key=lambda r: -r["p"])[:n]}

def quality(q, rows, added):
    flags, notes = [], []
    n = len(rows); tail = sum(1 for r in rows if r["p"] < 0.001); obscure = sum(1 for r in rows if r.get("tier") == "obscure" or r["p"] < 0.0005)
    total = sum(r["p"] for r in rows if not r.get("pv")); top = max(r["p"] for r in rows)
    words = len(q["prompt"].split())
    rules = q.get("rules", {})
    if n < 40: flags.append("too few answers (under 40)")
    closed = n < 90 and bool(q.get("kb") or q.get("closed"))   # a small set listed in full, e.g. the 54 countries in Africa
    need = 15 if n >= 90 else max(5, n // 8)          # a closed set can't have 15 obscure members
    if obscure < need: flags.append(f"thin long tail (under {need} obscure answers)")
    if not (1.6 <= total <= 3.6): flags.append(f"share estimates add up to {total:.2f}")
    if top < 0.05: flags.append("no clear common answer (top share under 5%)")
    if words > 12: flags.append("prompt is long")
    if not q["prompt"].startswith(("Name", "Give", "Think of")): notes.append("unusual opening")
    for k in ("accept", "exclude", "granularity"):
        if not rules.get(k): flags.append(f"rules.{k} missing")
    if re.search(r"\b(best|beautiful|cool|nice|favourite|favorite|funny|scary|boring|interesting)\b", q["prompt"].lower()): flags.append("subjective wording")
    if re.search(r"\b(currently|this year|today's|latest|newest|recent)\b", q["prompt"].lower()): flags.append("time-sensitive wording")
    # How often two answers are a single slip apart: a high rate means corrections and checks are riskier.
    keys = sorted({norm(r["a"]) for r in rows if not r.get("pv")})
    close = 0
    for i, a in enumerate(keys[:400]):
        for b in keys[i + 1:i + 6]:
            if abs(len(a) - len(b)) <= 1 and sum(x != y for x, y in zip(a, b)) + abs(len(a) - len(b)) <= 1: close += 1
    confusable = round(close / max(1, min(len(keys), 400)), 3)
    # Distinct answers a letter apart (ship/shop, .xls/.xlt) are a note, not a blocker: an exact match always wins, and the
    # checker never auto-corrects when two listed answers are about equally close, so the risk is handled at play time.
    if confusable > 0.08: notes.append("many answers a letter apart (corrections will ask rather than guess)")
    coverage = min(1, math.log10(max(n, 1)) / math.log10(400))       # 400+ answers = full marks
    depth_room = min(1, obscure / 60)
    if closed:    # every member of a small set is listed (checked against a dataset): complete, and as deep as the set allows
        coverage, depth_room = 1, min(1, obscure / (2 * need))
    rules_done = sum(bool(rules.get(k)) for k in ("player", "accept", "exclude", "granularity", "synonyms")) / 5
    clarity = 1 if words <= 9 else 0.7 if words <= 12 else 0.4
    score = round(100 * (0.35 * coverage + 0.25 * depth_room + 0.2 * rules_done + 0.1 * clarity + 0.1 * (1 - min(1, confusable * 5))))
    blocking = [f for f in flags if f.startswith(("too few", "rules.", "subjective", "time-sensitive", "share estimates"))]
    status = "reject" if blocking or score < 50 else "ready" if score >= 68 and not flags else "review"
    return {"id": q["id"], "score": score, "status": status, "flags": flags, "notes": notes, "answers": n, "from_datasets": added,
            "aliases": sum(len(r.get("al", [])) for r in rows), "obscure": obscure, "tail_under_0.1pct": tail, "top_share": round(top, 3),
            "share_sum": round(total, 2), "confusable": confusable, "category": q["category"], "style": q["style"], "topic": q["topic"], "difficulty": q["difficulty"]}

# ---------- duplicates ----------
def similarity(a, b):
    ta, tb = a["_tok"], b["_tok"]
    pj = len(ta & tb) / max(1, len(ta | tb))
    ka, kb = a["_keys"], b["_keys"]
    aj = len(ka & kb) / max(1, len(ka | kb))      # overlap of both lists together: "a country in Africa" is not a copy of "a country"
    same_topic = a.get("topic") and a.get("topic") == b.get("topic")
    return pj, aj, same_topic

def duplicates(qs, legacy):
    pairs = []
    pool = qs + legacy
    for x in pool:
        x["_tok"] = prompt_tokens(x["prompt"]); x["_keys"] = answer_keys(x["_rows"] if "_rows" in x else x["answers"])
    for i, a in enumerate(qs):
        for b in pool[i + 1:]:
            pj, aj, st = similarity(a, b)
            # A real copy: the same topic asked the same way or with the same answers, or largely the same answers, or the
            # same wording with shared answers. Siblings on one template ("an English word from Dutch / German") are not
            # copies; the scheduler keeps them apart instead.
            if (st and (aj >= 0.2 or pj >= 0.6)) or aj >= 0.6 or (pj >= 0.6 and aj >= 0.15):
                pairs.append({"a": a["id"], "b": b["id"], "prompt_overlap": round(pj, 2), "answer_overlap": round(aj, 2), "same_topic": bool(st)})
    return pairs

# ---------- reports ----------
def report():
    qs, legacy = load_questions(), legacy_questions()
    os.makedirs(os.path.join(C, "report"), exist_ok=True)
    reps = {}
    for q in qs:
        rows, added = answers_of(q); q["_rows"] = rows
        reps[q["id"]] = quality(q, rows, added)
    dups = duplicates(qs, legacy)
    # The weaker question of a near-duplicate pair (or the new one, against the original bank) is held back.
    for d in dups:
        ra, rb = reps.get(d["a"]), reps.get(d["b"])
        loser = d["a"] if rb is None or (ra and rb and ra["score"] <= rb["score"]) else d["b"]
        if loser in reps and reps[loser]["status"] != "reject":
            reps[loser]["status"] = "duplicate"; reps[loser]["flags"].append(f"near-duplicate of {d['b'] if loser == d['a'] else d['a']}")
    json.dump({"generated": datetime.date.today().isoformat(), "questions": reps, "duplicates": dups}, open(os.path.join(C, "report", "quality.json"), "w"), indent=1)
    cnt = collections.Counter(r["status"] for r in reps.values())
    print(f"{len(qs)} questions: {dict(cnt)}; {len(dups)} near-duplicate pairs")
    print("categories (ready):", dict(collections.Counter(r["category"] for r in reps.values() if r["status"] == "ready")))
    return qs, reps

# ---------- schedule ----------
def schedule(qs=None, reps=None, seed=7):
    if reps is None:
        qs = load_questions(); reps = json.load(open(os.path.join(C, "report", "quality.json")))["questions"]
    byid = {q["id"]: q for q in qs}
    sched_path = os.path.join(C, "schedule.json")
    sched = json.load(open(sched_path)) if os.path.exists(sched_path) else {"days": {}}
    today = (datetime.date.today() - datetime.date(2026, 11, 24)).days + 1      # day 1 = launch (24 Nov 2026)
    # Days already published (today and earlier) never change. Future days are rebuilt from the approved pool.
    fixed = {d: v for d, v in sched["days"].items() if int(d) <= today + 1}
    used = {q for v in fixed.values() for q in v}
    pool = [byid[i] for i, r in reps.items() if r["status"] == "ready" and i in byid and i not in used and byid[i].get("approved") is not False]
    rng = random.Random(seed)
    rng.shuffle(pool)
    for q in pool: q["_keys"] = answer_keys(answers_of(q)[0]); q["_tok"] = prompt_tokens(q["prompt"])
    days, history = dict(fixed), []          # history: list of day question lists, most recent last
    for d in sorted(fixed, key=int):
        hist = [byid[i] for i in fixed[d] if i in byid]
        for q in hist: q["_keys"] = answer_keys(answers_of(q)[0]); q["_tok"] = prompt_tokens(q["prompt"])
        history.append(hist)
    day = max([FIRST_NEW_DAY - 1] + [int(d) for d in fixed]) + 1
    last_day = FIRST_NEW_DAY + DAYS_WANTED - 1
    def penalty(q, chosen):
        p = 0.0
        same = sum(c["category"] == q["category"] for c in chosen)
        if same >= 2: return 1e9                                                                # never three from one category
        if same and any(c["style"] == q["style"] for c in chosen if c["category"] == q["category"]): return 1e9
        p += 25.0 * same                                                                         # a second one only when nothing else fits
        if sum(c["style"] == q["style"] for c in chosen) >= 2: return 1e9                         # at most two of any style a day
        for back, past in enumerate(reversed(history[-45:])):
            for c in past:
                if c["topic"] == q["topic"]: return 1e9                                           # same topic: 45-day cooldown
                if back < 10 and len(c["_tok"] & q["_tok"]) / max(1, len(c["_tok"] | q["_tok"])) >= 0.6: return 1e9   # same template: 10 days apart
                overlap = len(c["_keys"] & q["_keys"]) / max(1, min(len(c["_keys"]), len(q["_keys"])))
                if overlap > 0.2 and back < 21: return 1e9                                      # same answers: 3 weeks apart
                if c["category"] == q["category"]: p += 3.0 / (back + 1)                         # categories spread across days
        return p
    while day <= last_day:
        chosen = []
        for slot in range(5):
            need_easy = slot == 4 and not any(c["difficulty"] <= 2 for c in chosen)
            need_hard = slot == 4 and not any(c["difficulty"] >= 3 for c in chosen)
            best, bp = None, 1e9
            for q in pool:
                if q in chosen: continue
                if need_easy and q["difficulty"] > 2: continue
                if need_hard and q["difficulty"] < 3: continue
                p = penalty(q, chosen) + rng.random() * 0.5 - 0.02 * reps[q["id"]]["score"]
                if p < bp: best, bp = q, p
            if best is None or bp >= 1e8: break
            chosen.append(best)
        if len(chosen) < 5: print(f"stopped at day {day}: not enough varied ready questions"); break
        # Order within the day: an easy opener, the hardest fourth, a creative or association question last if there is one.
        chosen.sort(key=lambda c: c["difficulty"])
        hardest = max(chosen, key=lambda c: c["difficulty"]); chosen.remove(hardest); chosen.insert(3, hardest)
        days[str(day)] = [c["id"] for c in chosen]
        for c in chosen: pool.remove(c)
        history.append(chosen); day += 1
    sched = {"note": "Day -> five question ids. Days up to tomorrow are fixed once published; later days are rebuilt by build.py schedule.",
             "first_new_day": FIRST_NEW_DAY, "days": days}
    json.dump(sched, open(sched_path, "w"), indent=1)
    print(f"scheduled days {FIRST_NEW_DAY}..{day - 1} ({day - FIRST_NEW_DAY} days); {len(pool)} ready questions left in reserve")
    return sched

# ---------- day files and database rows ----------
def sql_q(s): return "'" + s.replace("'", "''") + "'"
def client_question(q, rows):
    out = []
    for r in sorted(rows, key=lambda r: -r["p"]):
        a = r["a"]; row = {"a": norm(a) if not a[:1].isupper() else a, "s": round(r["p"], 7)}
        if a[:1].isupper() or norm(a) != a: row["d"] = a
        al = [x for x in r.get("al", []) if norm(x) != norm(a)]
        if al: row["al"] = al
        if r.get("pv"): row["pv"] = 1; row["x"] = 1
        out.append(row)
    return {"key": q["id"], "title": q["title"], "icon": q["icon"], "prompt": q["prompt"], "hint": q["hint"], "rules": q["rules"]["player"],
            "answers": out, "general": q.get("general", []), "notIn": q.get("notIn", []), "category": q["category"],
            "criteria": {k: q["rules"].get(k) for k in ("accept", "exclude", "granularity", "synonyms") if q["rules"].get(k)}}

def days(public=False):
    qs = {q["id"]: q for q in load_questions()}
    sched = json.load(open(os.path.join(C, "schedule.json")))
    outd = os.path.join(C, "build", "days"); outs = os.path.join(C, "build", "sql")
    os.makedirs(outd, exist_ok=True); os.makedirs(outs, exist_ok=True)
    for d, ids in sorted(sched["days"].items(), key=lambda x: int(x[0])):
        day = int(d); qlist = []; sql = [f"-- Day {day}: built by tools/content/build.py. Safe to run again.", "begin;"]
        for rnd, i in enumerate(ids, 1):
            q = qs[i]; rows, _ = answers_of(q); cq = client_question(q, rows); qlist.append(cq)
            table = {r["a"] if r["a"][:1].isupper() else norm(r["a"]): [round(r["p"], 7), depth_of(r["p"], bool(r.get("pv")))] for r in rows}
            keys = {}
            for r in rows:
                canon = r["a"] if r["a"][:1].isupper() else norm(r["a"])
                for n in [r["a"], *r.get("al", [])]:
                    k = norm(n)
                    if k and k not in keys: keys[k] = canon
            sql.append(f"delete from public.set_answers where set_id = {day} and round = {rnd}; delete from public.set_keys where set_id = {day} and round = {rnd};")
            sql.append(f"insert into public.set_answers select {day}, {rnd}, key, (value->>0)::double precision, (value->>1)::int from jsonb_each({sql_q(json.dumps(table, separators=(',', ':')))}::jsonb);")
            sql.append(f"insert into public.set_keys select {day}, {rnd}, key, value #>> '{{}}' from jsonb_each({sql_q(json.dumps(keys, separators=(',', ':')))}::jsonb);")
        payload = {"v": 4, "day": day, "questions": qlist}
        meta = [{"key": q["key"], "title": q["title"]} for q in qlist]
        sql.insert(2, f"insert into public.answer_sets values ({day}, {sql_q(json.dumps(meta))}::jsonb) on conflict (set_id) do update set questions = excluded.questions;")
        sql.append(f"insert into public.content_days (day, set_id, payload) values ({day}, {day}, {sql_q(json.dumps(payload, separators=(',', ':')))}::jsonb) on conflict (day) do update set payload = excluded.payload, set_id = excluded.set_id;")
        sql.append("commit;")
        json.dump(payload, open(os.path.join(outd, f"{day}.json"), "w"), separators=(",", ":"))
        open(os.path.join(outs, f"day_{day:03d}.sql"), "w").write("\n".join(sql) + "\n")
        if public: json.dump(payload, open(os.path.join(ROOT, "days", f"{day}.json"), "w"), separators=(",", ":"))
    print(f"wrote {len(sched['days'])} days to content/build/days and content/build/sql")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("report", "all"): qs, reps = report()
    if cmd in ("schedule", "all"): schedule(*(report() if cmd == "schedule" else (qs, reps)))
    if cmd in ("days", "all"): days("--public" in sys.argv)
