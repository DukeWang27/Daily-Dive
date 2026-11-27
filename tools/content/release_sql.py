"""One SQL file for a content release: the new migrations, then the prepared days from the first day that hasn't begun
anywhere yet. Played days, and days already open somewhere in the world (today and tomorrow, plus the day after for
the earliest time zones), are never included, so nobody's question changes under them and no result is rewritten.

  python3 tools/content/release_sql.py [--from N] [--migrations 0013,0014]
      writes content/build/release-<date>.sql (private) and prints what it contains.

Run the file in the Supabase SQL editor only after the owner approves the release. It is safe to run twice.
"""
import datetime, glob, json, os, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
LAUNCH = datetime.date(2026, 11, 24)

def main():
    args = sys.argv[1:]
    today = (datetime.date.today() - LAUNCH).days + 1
    first_safe = today + 3
    start = int(args[args.index("--from") + 1]) if "--from" in args else first_safe
    if start < first_safe: sys.exit(f"refusing: day {start} may already be open somewhere (today is day {today}; the first safe day is {first_safe})")
    migs = args[args.index("--migrations") + 1].split(",") if "--migrations" in args else ["0013", "0014"]
    parts = [f"-- Deeple release, built {datetime.date.today()} (day {today}). Migrations {', '.join(migs)}; prepared days from {start}.",
             "-- Run in the Supabase SQL editor after a fresh backup. Safe to run twice. Never touches days before " + str(start) + "."]
    for m in migs:
        f = glob.glob(os.path.join(ROOT, "supabase", m + "_*.sql"))
        if len(f) != 1: sys.exit(f"migration {m} not found")
        parts += [f"\n-- ===== {os.path.basename(f[0])} =====", open(f[0]).read()]
    days = []
    for f in sorted(glob.glob(os.path.join(ROOT, "content", "build", "sql", "day_*.sql"))):
        d = int(re.search(r"day_(\d+)", f).group(1))
        if d >= start: days.append(d); parts += [f"\n-- ===== day {d} =====", open(f).read()]
    if not days: sys.exit("no prepared days to release")
    # A guard inside the file too: if it is run late, the days already open are skipped by the database itself.
    parts.insert(2, "-- If this file is run after it was built, days that have begun since are protected by the check below.")
    out = os.path.join(ROOT, "content", "build", f"release-{datetime.date.today()}.sql")
    body = "\n".join(parts)
    # Each day's block starts with 'begin;' and ends with 'commit;': wrap it in a check that the day hasn't begun.
    body = re.sub(r"\n-- ===== day (\d+) =====\n(-- Day \d+:[^\n]*\n)begin;", lambda m: f"\n-- ===== day {m.group(1)} =====\n{m.group(2)}begin;\ndo $$ begin if {m.group(1)} <= private.latest_day() then raise exception 'day {m.group(1)} has already begun: not changed'; end if; end $$;", body)
    open(out, "w").write(body)
    print(f"wrote {out}: migrations {migs}, days {days[0]}..{days[-1]} ({len(days)} days); first safe day today is {first_safe}")

if __name__ == "__main__":
    main()
