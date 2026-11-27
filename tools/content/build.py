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
# Prepared content starts the day after the last day that ships as a file (days/index.json "static": the days already
# played when prepared content began). Without that setting, it starts after the original 15-day bank.
def _first_new_day():
    try: idx = json.load(open(os.path.join(ROOT, "days", "index.json"))); return int(idx.get("static") or idx.get("count") or 15) + 1
    except Exception: return 16
FIRST_NEW_DAY, DAYS_WANTED = _first_new_day(), 90
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
        name = os.path.basename(f)[:-5]
        if os.sep + "days" + os.sep in f and name.isdigit() and int(name) >= FIRST_NEW_DAY: continue   # an original day that prepared content replaced: never played
        for q in json.load(open(f))["questions"]:
            out.append({"id": ("race:" if os.sep + "race" + os.sep in f else "legacy:") + q["key"], "prompt": q["prompt"], "topic": q["key"], "answers": [{"a": a["a"], "p": a["s"]} for a in q["answers"]]})
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
    n = len(rows); tail = sum(1 for r in rows if r["p"] < 0.001); obscure = sum(1 for r in rows if r["p"] < 0.0005 or (r.get("tier") == "obscure" and r["p"] < 0.001))   # the label alone is not enough
    total = sum(r["p"] for r in rows if not r.get("pv")); top = max(r["p"] for r in rows)
    words = len(q["prompt"].split())
    rules = q.get("rules", {})
    if n < 40: flags.append("too few answers (under 40)")
    closed = n < 90 and bool(q.get("kb") or q.get("closed"))   # a small set listed in full, e.g. the 54 countries in Africa
    need = 15 if n >= 90 else max(5, n // 8)          # a closed set can't have 15 obscure members
    if obscure < need: flags.append(f"thin long tail (under {need} obscure answers)")
    if not (1.6 <= total <= 3.6) and q.get("set") != "curated-1": flags.append(f"share estimates add up to {total:.2f}")   # the curated set's tiers are graded by hand, not shares that sum
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
    dups = duplicates(qs, legacy); byid = {q["id"]: q for q in qs}
    # The weaker question of a near-duplicate pair (or the new one, against the original bank) is held back.
    for d in dups:
        ra, rb = reps.get(d["a"]), reps.get(d["b"])
        # The race is a separate mode with its own pool: sharing a question with it is worth knowing, not a reason to hold one back.
        if d["b"].startswith("race:"):
            if ra: ra["notes"].append("also asked in the submarine race pool")
            continue
        ea, eb = bool(byid.get(d["a"], {}).get("set")), bool(byid.get(d["b"], {}).get("set"))   # an edited question beats an unedited one
        loser = d["a"] if rb is None else d["b"] if ea and not eb else d["a"] if eb and not ea else d["a"] if ra["score"] <= rb["score"] else d["b"]
        if loser in reps and reps[loser]["status"] != "reject":
            reps[loser]["status"] = "duplicate"; reps[loser]["flags"].append(f"near-duplicate of {d['b'] if loser == d['a'] else d['a']}")
    json.dump({"generated": datetime.date.today().isoformat(), "questions": reps, "duplicates": dups}, open(os.path.join(C, "report", "quality.json"), "w"), indent=1)
    cnt = collections.Counter(r["status"] for r in reps.values())
    print(f"{len(qs)} questions: {dict(cnt)}; {len(dups)} near-duplicate pairs")
    print("categories (ready):", dict(collections.Counter(r["category"] for r in reps.values() if r["status"] == "ready")))
    return qs, reps

# ---------- the house voice ----------
CLAUSE = re.compile(r"\b(that|with|who|whose|you|named|from|in|on|at|of|for|by|before|after|not|isn|but|once|also|can|has|have|is|are|was|were|people|something|used|made|found|without|than|over|under|more|less|only|ending|starting|containing)\b")
def is_plain(q):
    """A bare category ("Name a waterfall"): fine now and then, rationed to one a day at most."""
    p = q["prompt"]
    return not q.get("set") and bool(re.fullmatch(r"Name (a|an|the)( [A-Za-z'-]+){1,3}( or( an?)? [a-z' -]+)?", p)) and not CLAUSE.search(p)
def voiced(q):
    """The prompt as players read it. Edited questions are final. Older ones lose the repeated "Name ..." opening unless
    they are a bare category, where "Name a waterfall" is the natural way to ask (EDITORIAL.md, the house voice)."""
    p = q["prompt"]
    if q.get("set") or is_plain(q) or not p.startswith("Name "): return p
    rest = p[5:]
    if rest.split()[0].lower() in ("a", "an", "something", "someone", "the", "one", "any", "what"): return rest[0].upper() + rest[1:]
    return p

# ---------- schedule ----------
def schedule(qs=None, reps=None, seed=7):
    if reps is None:
        qs = load_questions(); reps = json.load(open(os.path.join(C, "report", "quality.json")))["questions"]
    byid = {q["id"]: q for q in qs}
    sched_path = os.path.join(C, "schedule.json")
    sched = json.load(open(sched_path)) if os.path.exists(sched_path) else {"days": {}}
    today = (datetime.date.today() - datetime.date(2026, 11, 24)).days + 1      # day 1 = launch (24 Nov 2026)
    # Days already published (today and earlier) never change. Future days are rebuilt from the approved pool.
    fixed = {d: v for d, v in sched["days"].items() if int(d) <= today + 2}   # today, tomorrow (already begun east of UTC) and the day after
    used = {q for v in fixed.values() for q in v}
    # Ready questions, minus any an editor has turned down, plus held-back ones an editor has approved by hand
    # (cms.py approve). An approval can lift a question with no flags that only missed the score; never a rejected one or a duplicate.
    ok = lambda i, r: (r["status"] == "ready" and byid[i].get("approved") is not False) or (r["status"] == "review" and byid[i].get("approved") is True and not r["flags"]) \
        or (byid[i].get("set") == "curated-1" and byid[i].get("approved") is True and r["status"] != "reject")   # the curated set, approved by the owner (26 Nov 2026)
    pool = [byid[i] for i, r in reps.items() if i in byid and i not in used and ok(i, r)]
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
    # Curated days: questions written as a set carry the day and position they were composed for ("plan"). They open
    # the schedule in that order; anything of theirs that isn't ready is replaced by the scheduler's own choice.
    planned = {}
    for q in pool:
        if q.get("plan") and q.get("set"): planned.setdefault(FIRST_NEW_DAY + int(q["plan"]["day"]) - 1, []).append(q)
    # Where two sets planned the same day, the curated set keeps it; the other's questions go back into the pool.
    for d, v in planned.items():
        if any(q.get("set") == "curated-1" for q in v): planned[d] = [q for q in v if q.get("set") == "curated-1"]
    for v in planned.values(): v.sort(key=lambda q: q["plan"].get("slot", 9))
    reserved = {id(q) for d, v in planned.items() if d >= day for q in v}
    def penalty(q, chosen):
        p = 0.0
        same = sum(c["category"] == q["category"] for c in chosen)
        if same >= 2: return 1e9                                                                # never three from one category
        if same and any(c["style"] == q["style"] for c in chosen if c["category"] == q["category"]): return 1e9
        p += 25.0 * same                                                                         # a second one only when nothing else fits
        if q["difficulty"] <= 2 and any(c["difficulty"] <= 2 for c in chosen): p += 8.0          # easy ones are scarce: one a day, save the rest
        if sum(c["style"] == q["style"] for c in chosen) >= 2 and not q.get("set"): return 1e9    # at most two of any style a day
        if is_plain(q):                                                                          # bare categories: one a day at most
            if any(is_plain(c) for c in chosen): return 1e9
            p += 6.0
        for back, past in enumerate(reversed(history[-45:])):
            for c in past:
                if c["topic"] == q["topic"]: return 1e9                                           # same topic: 45-day cooldown
                if back < 10 and len(c["_tok"] & q["_tok"]) / max(1, len(c["_tok"] | q["_tok"])) >= 0.6: return 1e9   # same template: 10 days apart
                overlap = len(c["_keys"] & q["_keys"]) / max(1, min(len(c["_keys"]), len(q["_keys"])))
                if overlap > 0.2 and back < 21: return 1e9                                      # same answers: 3 weeks apart
                if c["category"] == q["category"]: p += 3.0 / (back + 1)                         # categories spread across days
        return p
    while day <= last_day:
        chosen = list(planned.get(day, []))[:5]; curated = len(chosen)
        for slot in range(len(chosen), 5):
            need_easy = slot == 4 and not any(c["difficulty"] <= 2 for c in chosen)
            need_hard = slot == 4 and not any(c["difficulty"] >= 3 for c in chosen)
            best, bp = None, 1e9
            for q in pool:
                if q in chosen or id(q) in reserved: continue
                if need_easy and q["difficulty"] > 2: continue
                if need_hard and q["difficulty"] < 3: continue
                p = penalty(q, chosen) + rng.random() * 0.5 - 0.02 * reps[q["id"]]["score"]
                if p < bp: best, bp = q, p
            if best is None or bp >= 1e8: break
            chosen.append(best)
        if len(chosen) < 5: print(f"stopped at day {day}: not enough varied ready questions"); break
        # Order within the day: an easy opener, the hardest fourth, a creative or association question last if there is one.
        if curated < 3:   # a curated day keeps the order it was written in
            chosen.sort(key=lambda c: c["difficulty"])
            hardest = max(chosen, key=lambda c: c["difficulty"]); chosen.remove(hardest); chosen.insert(3, hardest)
        days[str(day)] = [c["id"] for c in chosen]
        for c in chosen: pool.remove(c); reserved.discard(id(c))
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
        a = r["a"]; d = depth_of(r["p"], bool(r.get("pv")))
        # The game works depth out from this share, so it must give the depth the server scores. When a cap applies (no
        # player evidence yet), publish the share at the cap instead of the raw estimate, as recap_legacy.py does.
        share = r["p"] if d == depth_of(r["p"], False, True) else SURFACE / 10 ** (d / 100)
        row = {"a": norm(a) if not a[:1].isupper() else a, "s": round(share, 7)}
        if a[:1].isupper() or norm(a) != a: row["d"] = a
        al = [x for x in r.get("al", []) if norm(x) != norm(a)]
        if al: row["al"] = al
        if r.get("pv"): row["pv"] = 1; row["x"] = 1
        if r.get("src") == "wikipedia+wikidata": row["ds"] = 1      # added from reference lists: never auto-corrected to (validate.js)
        if r.get("hide"): row["h"] = 1                    # accepted, never shown on public answer lists
        out.append(row)
    return {"key": q["id"], "title": q["title"], "icon": q["icon"], "prompt": voiced(q), "hint": q["hint"], "rules": q["rules"]["player"],
            "answers": out, "general": q.get("general", []), "notIn": q.get("notIn", []), "category": q["category"],
            "criteria": {k: q["rules"].get(k) for k in ("accept", "exclude", "granularity", "synonyms") if q["rules"].get(k)},
            **({"kb": q["client_kb"]} if q.get("client_kb") else {}), **({"granularity": q["granularity_mode"]} if q.get("granularity_mode") else {})}

def client_depth(share):
    """The game's own rule (iceberg.js depthOf), so the build can check the files agree with the server."""
    if share >= SURFACE: return 0
    d = max(1, math.floor(100 * math.log10(SURFACE / share) + 0.5))
    return BEYOND_M - 1 if d >= BEYOND_M and not round(share * 120000) >= 3 else d

# ---------- the daily mix of round types (from MIX_FROM) ----------
# Most days: the opener and one more ordinary rarity round, one rarity target, one forbidden round and one special
# (risk and reward or sea mines, alternating; a wildcard when the day has a lateral question). Some days swap the
# target or the forbidden round for a third rarity round. Everything follows from the day number (a fixed seed), so
# every player gets the same day. A round type only goes on a question that can carry it (enough answers measured
# by estimate, a target band with answers in it). Rules and scoring: rounds.js, and supabase/0010 + 0011 on the server.
MIX_FROM = 6
TARGETS = [dict(lo=0.01, hi=0.03), dict(goal="closest", pct=0.005, rule="Get as close as you can to 0.5% of players: uncommon, not obscure."),
           dict(lo=0.003, hi=0.02, rule="Uncommon but not obscure: an answer 0.3% to 2% of players give."), dict(goal="common", rule="Find the most common answer.")]
SHAPES = [["std", "std", "target", "forbidden", "special"]] * 4 + [["std", "std", "std", "target", "special"], ["std", "std", "std", "forbidden", "special"]]

def _measured(cq): return sorted([a["s"] for a in cq["answers"] if not a.get("pv")], reverse=True)
def _target_mode(cq, t):
    s = _measured(cq)
    if len(s) < 40: return None
    m = {"type": "target", **{k: v for k, v in t.items()}}
    if t.get("goal") == "common": m["top"] = s[0]; lo, hi = s[0] * 0.999, 1
    elif t.get("goal") == "closest": lo, hi = t["pct"] / 1.18, t["pct"] * 1.18
    else: lo, hi = t["lo"], t["hi"]
    return m if sum(lo <= x <= hi for x in s) >= (1 if t.get("goal") == "common" else 3) else None
def _forbid_mode(cq, n):
    rows = sorted([a for a in cq["answers"] if not a.get("pv")], key=lambda a: -a["s"])
    if len(rows) < 60: return None
    return {"type": "forbidden", "forbid": [a["a"] for a in rows[:n]]}
def _mines_mode(cq):
    s = _measured(cq)
    if len(s) < 45: return None
    band = lambda x, w: {"lo": round(x / w, 7), "hi": round(x * w, 7)}
    m1, m2 = band(s[12], 1.6), band(s[max(30, len(s) // 3)], 1.6)
    if m2["hi"] >= m1["lo"]: m2 = band(m1["lo"] / 4, 1.6)
    return {"type": "mines", "mines": [m1, m2]}

def mix(day, qlist, styles):
    """Round types for one day's client questions (in place). The first question stays an ordinary rarity round."""
    if day < MIX_FROM:
        for cq in qlist: cq.pop("mode", None)
        return
    # Round types a question was written for come first, but a day never has two of one kind (a risk at most once a
    # day), more than three that aren't ordinary, or an opener that isn't ordinary.
    if qlist and qlist[0].get("mode"): qlist[0].pop("mode")
    seen = set()
    for cq in qlist[1:]:
        k = (cq.get("mode") or {}).get("type")
        if k and (k in seen or len(seen) >= 3): cq.pop("mode")
        elif k: seen.add(k)
    r = random.Random(day * 104729 + 17)
    shape = SHAPES[r.randrange(len(SHAPES))]
    want = [k for k in shape[2:] if k != "std"]   # round types for questions 2-5; the rest stay ordinary
    special = "mines" if day % 2 else "risk"
    if any(st in ("lateral", "wildcard") for st in styles[1:]) and r.random() < 0.5: special = "wildcard"
    free = [i for i in range(1, len(qlist)) if not qlist[i].get("mode")]
    r.shuffle(free)
    have = {(q.get("mode") or {}).get("type") for q in qlist} - {None}
    want = [k for k in want if (special if k == "special" else k) not in have and not (k == "special" and have & {"risk", "mines", "wildcard"})][:max(0, 3 - len(have))]
    for k in want:
        for i in list(free):
            cq = qlist[i]
            if k == "target": m = _target_mode(cq, TARGETS[r.randrange(len(TARGETS))])
            elif k == "forbidden": m = _forbid_mode(cq, r.choice([5, 6, 7]))
            elif special == "wildcard": m = {"type": "wildcard"} if styles[i] in ("lateral", "wildcard") else None
            elif special == "mines": m = _mines_mode(cq) or {"type": "risk"}
            else: m = {"type": "risk"}
            if m: cq["mode"] = m; free.remove(i); break

def days(public=False):
    qs = {q["id"]: q for q in load_questions()}
    sched = json.load(open(os.path.join(C, "schedule.json")))
    outd = os.path.join(C, "build", "days"); outs = os.path.join(C, "build", "sql")
    os.makedirs(outd, exist_ok=True); os.makedirs(outs, exist_ok=True)
    for d, ids in sorted(sched["days"].items(), key=lambda x: int(x[0])):
        day = int(d); qlist = []; tables = []; keysets = []; sql = [f"-- Day {day}: built by tools/content/build.py. Safe to run again.", "begin;"]
        for rnd, i in enumerate(ids, 1):
            q = qs[i]; rows, _ = answers_of(q); cq = client_question(q, rows); qlist.append(cq)
            if q.get("mode"):   # a round type the question was written for: re-read against the published answers
                m = dict(q["mode"]); have = {norm(x["a"]): x["a"] for x in cq["answers"]}
                if m.get("type") == "forbidden": m["forbid"] = [have[norm(f)] for f in m.get("forbid", []) if norm(f) in have]
                if m.get("type") == "mines": m = _mines_mode(cq) or {"type": "risk"}
                if m.get("type") == "target" and m.get("goal") == "common": m["top"] = _measured(cq)[0]
                cq["mode"] = m
            # The server keeps the share the game shows (capped where there's no evidence yet), so a target band or a
            # mine reads the same number on both sides; the depth is the same either way.
            pub = {x["a"]: x["s"] for x in cq["answers"]}
            table = {}
            for r in rows:
                k = r["a"] if r["a"][:1].isupper() else norm(r["a"])
                table.setdefault(k, [pub.get(k, round(r["p"], 7)), depth_of(r["p"], bool(r.get("pv"))), bool(r.get("pv"))])
            shown = {x["a"]: client_depth(x["s"]) for x in cq["answers"]}
            wrong = [k for k, v in table.items() if k in shown and shown[k] != v[1]]
            if wrong: sys.exit(f"day {day} round {rnd}: the game would show a different depth from the server for {wrong[:5]}")
            keys = {}
            for r in rows:
                canon = r["a"] if r["a"][:1].isupper() else norm(r["a"])
                for n in [r["a"], *r.get("al", [])]:
                    k = norm(n)
                    if k and k not in keys: keys[k] = canon
            tables.append(table); keysets.append(keys)
        mix(day, qlist, [qs[i].get("style", "") for i in ids])
        for rnd, (table, keys) in enumerate(zip(tables, keysets), 1):
            sql.append(f"delete from public.set_answers where set_id = {day} and round = {rnd}; delete from public.set_keys where set_id = {day} and round = {rnd};")
            sql.append(f"insert into public.set_answers (set_id, round, answer, share, depth, pv) select {day}, {rnd}, key, (value->>0)::double precision, (value->>1)::int, (value->>2)::boolean from jsonb_each({sql_q(json.dumps(table, separators=(',', ':')))}::jsonb);")
            sql.append(f"insert into public.set_keys select {day}, {rnd}, key, value #>> '{{}}' from jsonb_each({sql_q(json.dumps(keys, separators=(',', ':')))}::jsonb);")
        payload = {"v": 4, "day": day, "questions": qlist}
        meta = [{"key": q["key"], "title": q["title"], **({"mode": q["mode"]} if q.get("mode") else {})} for q in qlist]
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
