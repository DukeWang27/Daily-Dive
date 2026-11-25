"""Content review tool (internal; nothing here is served to players).

  python3 tools/content/cms.py status                    reserve: ready / review / rejected, days scheduled, days left
  python3 tools/content/cms.py upcoming [N]              the next N scheduled days, with category, style, difficulty, score
  python3 tools/content/cms.py show <id>                 a question's diagnostic: rules, answer counts, samples by rarity, sources, flags
  python3 tools/content/cms.py weak                      questions held back, with the reasons (coverage, duplicates, rules)
  python3 tools/content/cms.py approve <id> | reject <id> "reason" | edit <id> field=value
  python3 tools/content/cms.py reschedule <day> <id> <id> <id> <id> <id>     (future days only)
  python3 tools/content/cms.py html                      writes content/report/index.html to browse everything
Database commands (need DATABASE_URL, a Postgres connection string for the project; never put it in the game):
  python3 tools/content/cms.py pending [N]               unknown answers players sent, most common first
  python3 tools/content/cms.py verdict <question> "<answer>" ok|invalid ["canonical"] ["reason"]   (kept in verdict_history)
  python3 tools/content/cms.py stats <set> <round>       real-player statistics with the Bayesian estimate
After approving, rejecting or editing, run: python3 tools/content/build.py all"""
import json, os, sys, subprocess, html, datetime, collections
sys.path.insert(0, os.path.dirname(__file__))
import build
ROOT, C = build.ROOT, build.C
QDIR = os.path.join(C, "questions")

def reps(): return json.load(open(os.path.join(C, "report", "quality.json")))["questions"]
def sched(): return json.load(open(os.path.join(C, "schedule.json")))["days"]
def qfile(i): return os.path.join(QDIR, i + ".json")
def today(): return (datetime.date.today() - datetime.date(2026, 11, 24)).days + 1

def status():
    r, s = reps(), sched()
    c = collections.Counter(x["status"] for x in r.values())
    future = [d for d in s if int(d) > today()]
    used = {i for v in s.values() for i in v}
    spare = [i for i, x in r.items() if x["status"] == "ready" and i not in used]
    print(f"questions: {dict(c)}   scheduled days: {len(s)} ({min(map(int, s)) if s else '-'}..{max(map(int, s)) if s else '-'})")
    print(f"days still to come: {len(future)}  (about {len(future)} days of reserve)   ready but unscheduled: {len(spare)}")
    print("ready by category:", dict(collections.Counter(x["category"] for x in r.values() if x["status"] == "ready").most_common()))
    print("ready by style:   ", dict(collections.Counter(x["style"] for x in r.values() if x["status"] == "ready").most_common()))
    if len(future) < 30: print("RESERVE LOW: generate more candidates (tools/content/generate.mjs) and rebuild.")

def upcoming(n=7):
    r, s = reps(), sched()
    qs = {i: json.load(open(qfile(i))) for v in s.values() for i in v if os.path.exists(qfile(i))}
    for d in sorted((d for d in s if int(d) >= today()), key=int)[:int(n)]:
        print(f"\nDay {d} ({(datetime.date(2026, 11, 24) + datetime.timedelta(days=int(d) - 1)).isoformat()})")
        for i in s[d]:
            q, x = qs.get(i), r.get(i, {})
            print(f"  {q['prompt'] if q else i:<62} {x.get('category',''):<13} {x.get('style',''):<13} d{x.get('difficulty','')}  {x.get('answers','')} answers  score {x.get('score','')}")

def show(i):
    q = json.load(open(qfile(i))); rows, added = build.answers_of(q); x = reps().get(i, {})
    rows.sort(key=lambda r: -r["p"])
    bands = collections.Counter(("surface" if build.depth_of(r["p"], r.get("pv")) == 0 else "0-100 m" if build.depth_of(r["p"], r.get("pv")) < 100 else "100-200 m" if build.depth_of(r["p"], r.get("pv")) < 200 else "200-299 m") for r in rows)
    print(f"{q['prompt']}   [{q['category']} / {q['style']} / difficulty {q['difficulty']} / topic {q['topic']}]")
    print(f"hint: {q['hint']}\nrules for players: {' | '.join(q['rules']['player'])}")
    for k in ("accept", "exclude", "granularity", "synonyms", "ambiguous"):
        if q["rules"].get(k): print(f"  {k}: {q['rules'][k]}")
    print(f"answers: {len(rows)} ({added} from datasets), other names: {sum(len(r.get('al', [])) for r in rows)}, quality {x.get('score')} {x.get('status')} {x.get('flags')}")
    print("sources:", dict(collections.Counter(r.get("src", "ai").split(":")[0] for r in rows)), " provisional depths:", dict(bands))
    show = lambda rs: ", ".join(f"{r['a']} {100 * r['p']:.2g}%" for r in rs)
    print("common:  ", show(rows[:8])); mid = [r for r in rows if 0.001 <= r["p"] < 0.02]; print("uncommon:", show(mid[:8]))
    deep = [r for r in rows if r["p"] < 0.001 and not r.get("pv")]; print("obscure: ", show(deep[:8])); print("rejected as too general / wrong:", q.get("general", [])[:8], q.get("notIn", [])[:8])

def weak():
    for i, x in sorted(reps().items(), key=lambda kv: kv[1]["score"]):
        if x["status"] != "ready": print(f"{x['status']:<10} {x['score']:>3}  {i:<40} {'; '.join(x['flags'])}")

def set_field(i, field, value):
    q = json.load(open(qfile(i)))
    try: value = json.loads(value)
    except Exception: pass
    q[field] = value; json.dump(q, open(qfile(i), "w"), indent=1, ensure_ascii=False); print(f"{i}: {field} = {value!r}")

def reschedule(day, ids):
    if int(day) <= today() + 1: raise SystemExit("that day is already published or about to be: it can't change")
    p = os.path.join(C, "schedule.json"); s = json.load(open(p)); s["days"][str(day)] = ids; json.dump(s, open(p, "w"), indent=1); print("day", day, "->", ids)

def sql(q):
    url = os.environ.get("DATABASE_URL") or raise_(SystemExit("set DATABASE_URL (Postgres connection string)"))
    out = subprocess.run(["psql", url, "-At", "-F", " | ", "-c", q], capture_output=True, text=True)
    if out.returncode: raise SystemExit(out.stderr)
    return out.stdout.strip()
def raise_(e): raise e
def lit(s): return "'" + str(s).replace("'", "''") + "'"

def write_html():
    r, s = reps(), sched()
    qs = {i: json.load(open(qfile(i))) for i in r if os.path.exists(qfile(i))}
    rows = []
    for d in sorted(s, key=int):
        cells = "".join(f"<li><b>{html.escape(qs[i]['prompt'])}</b> <span>{r[i]['category']} · {r[i]['style']} · d{r[i]['difficulty']} · {r[i]['answers']} answers · score {r[i]['score']}</span></li>" for i in s[d] if i in qs)
        rows.append(f"<section><h3>Day {d}</h3><ol>{cells}</ol></section>")
    weakrows = "".join(f"<tr><td>{html.escape(i)}</td><td>{x['status']}</td><td>{x['score']}</td><td>{html.escape('; '.join(x['flags']))}</td></tr>" for i, x in sorted(r.items(), key=lambda kv: kv[1]['score']) if x["status"] != "ready")
    page = f"""<!doctype html><meta charset=utf-8><title>Content reserve</title><style>body{{font:14px/1.5 system-ui;margin:24px;max-width:1100px}}section{{margin:0 0 18px}}li span{{color:#667;margin-left:8px}}table{{border-collapse:collapse}}td{{border-top:1px solid #ddd;padding:4px 8px;vertical-align:top}}</style>
<h1>Content reserve (internal)</h1><p>Generated {datetime.date.today()}. {len(s)} scheduled days. Not part of the game; never deploy.</p><h2>Schedule</h2>{''.join(rows)}<h2>Held back</h2><table>{weakrows}</table>"""
    open(os.path.join(C, "report", "index.html"), "w").write(page); print("content/report/index.html")

if __name__ == "__main__":
    a = sys.argv[1:] or ["status"]
    cmd = a[0]
    if cmd == "status": status()
    elif cmd == "upcoming": upcoming(*(a[1:2] or [7]))
    elif cmd == "show": show(a[1])
    elif cmd == "weak": weak()
    elif cmd == "approve": set_field(a[1], "approved", "true")
    elif cmd == "reject": set_field(a[1], "approved", "false"); set_field(a[1], "review_note", json.dumps(a[2] if len(a) > 2 else "rejected"))
    elif cmd == "edit": f, v = a[2].split("=", 1); set_field(a[1], f, v)
    elif cmd == "reschedule": reschedule(a[1], a[2:])
    elif cmd == "html": write_html()
    elif cmd == "pending": print(sql(f"select day, round, answer, players, disputed from public.review_queue limit {int(a[1]) if len(a) > 1 else 30}"))
    elif cmd == "verdict": print(sql(f"select private.set_verdict({lit(a[1])}, {lit(build.norm(a[2]))}, {lit(a[3])}, {lit(a[4] if len(a) > 4 else build.norm(a[2]))}, {lit(a[5] if len(a) > 5 else 'Reviewed')}, 'cms')") or "saved")
    elif cmd == "stats": print(sql(f"select answer, round(prior::numeric, 6), players_gave, players, round(posterior::numeric, 6), round(upper95::numeric, 6) from private.question_stats({int(a[1])}, {int(a[2])}) order by posterior desc limit 25"))
    else: print(__doc__)
