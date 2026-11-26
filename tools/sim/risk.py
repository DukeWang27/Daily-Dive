"""Risk and Reward balance: simulate players against real answer tables and compare designs.
A player's guess is drawn from the question's answer table, tilted towards rarer answers by skill (0 = guesses like
the crowd, 1 = strongly favours rare answers). A guess's value is its depth (rarity). The player sees their first
answer, then chooses Keep / Play on / Risk, by each design's rules, picking whatever gives them the highest expected
distance (they know their own skill). We report how often each option is the best choice, and expected distance.
Usage: python3 tools/sim/risk.py"""
import json, glob, math, random, os, statistics
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
def depth(s): return 0 if s >= 0.1 else max(1, min(299, round(100 * math.log10(0.1 / s))))
tables = []
for p in sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json")))[:40]:
    for q in json.load(open(p))["questions"]:
        rows = [a for a in q["answers"] if not a.get("pv")]
        if len(rows) > 60: tables.append([a["s"] for a in rows])
random.seed(7)
def sampler(shares, skill):
    w = [s ** (1 - 0.75 * skill) for s in shares]; tot = sum(w); cum = []; c = 0
    for x in w: c += x / tot; cum.append(c)
    def draw():
        r = random.random(); lo, hi = 0, len(cum) - 1
        while lo < hi:
            m = (lo + hi) // 2
            if cum[m] < r: lo = m + 1
            else: hi = m
        return depth(shares[lo])
    return draw

DESIGNS = {
  # name: function(stake, later_best, n_later) -> {keep, play, risk} outcomes given the later guesses' best value
  "A: now (keep=stake, risk x1.5 else 0)": dict(keep=lambda s: s, play=lambda s, b: max(s, b), risk=lambda s, b: round(1.5 * b) if b > s else 0),
  "B: keep +25%, risk x1.5 of better, fail keeps 50%": dict(keep=lambda s: round(1.25 * s), play=lambda s, b: max(s, b), risk=lambda s, b: round(1.5 * b) if b > s else round(0.5 * s)),
  "C: keep +30%, risk x2 of gain over stake, fail 0": dict(keep=lambda s: round(1.3 * s), play=lambda s, b: max(s, b), risk=lambda s, b: s + 2 * (b - s) if b > s else 0),
  "D: keep +20%, risk: stake + 1.5x better, fail 0": dict(keep=lambda s: round(1.2 * s), play=lambda s, b: max(s, b), risk=lambda s, b: s + round(1.5 * (b - s)) if b > s else 0),
  "E: keep +25%, play on, risk x1.6 of better, fail 25%": dict(keep=lambda s: round(1.25 * s), play=lambda s, b: max(s, b), risk=lambda s, b: round(1.6 * b) if b > s else round(0.25 * s)),
}
def run(design, trials=4000):
    res = {"keep": 0, "play": 0, "risk": 0}; evs = []
    for _ in range(trials):
        shares = random.choice(tables); skill = random.random(); draw = sampler(shares, skill)
        stake = draw()
        if stake <= 0: continue
        # the player's estimate of each option: average over 60 imagined continuations with their own skill (2 guesses left)
        sims = [max(draw(), draw()) for _ in range(60)]
        ev = {k: statistics.mean(design[k](stake) if k == "keep" else design[k](stake, b) for b in sims) for k in res}
        best = max(ev, key=ev.get); res[best] += 1
        b = max(draw(), draw()); evs.append(design[best](stake) if best == "keep" else design[best](stake, b))
    n = sum(res.values())
    return {k: round(100 * v / n) for k, v in res.items()}, round(statistics.mean(evs))
for name, d in DESIGNS.items():
    share, mean = run(d)
    print(f"{name:55s} best choice: keep {share['keep']:3d}%  play {share['play']:3d}%  risk {share['risk']:3d}%   mean +{mean} m")

if __name__ == "__main__":
    print("\nTuning D (keep bonus / gain multiplier):")
    for kb in (0.15, 0.2, 0.25):
        for gm in (1.5, 2.0):
            d = dict(keep=lambda s, kb=kb: round((1 + kb) * s), play=lambda s, b: max(s, b), risk=lambda s, b, gm=gm: s + round(gm * (b - s)) if b > s else 0)
            share, mean = run(d, 3000)
            print(f"  keep +{int(kb*100)}%, risk gain x{gm}:  keep {share['keep']:3d}%  play {share['play']:3d}%  risk {share['risk']:3d}%   mean +{mean} m")
    # When does each option win, by the size of the first answer (design D)?
    d = DESIGNS["D: keep +20%, risk: stake + 1.5x better, fail 0"]
    buckets = {}
    for _ in range(5000):
        shares = random.choice(tables); skill = random.random(); draw = sampler(shares, skill); stake = draw()
        if stake <= 0: continue
        sims = [max(draw(), draw()) for _ in range(60)]
        ev = {k: statistics.mean(d[k](stake) if k == "keep" else d[k](stake, b) for b in sims) for k in ("keep", "play", "risk")}
        key = (min(250, stake // 50 * 50), "high" if skill > 0.5 else "low"); buckets.setdefault(key, {"keep": 0, "play": 0, "risk": 0})[max(ev, key=ev.get)] += 1
    print("\nDesign D, best option by first answer and skill:")
    for k in sorted(buckets): v = buckets[k]; n = sum(v.values()); print(f"  first +{k[0]:3d}..{k[0]+49} m, {k[1]:4s} skill: " + "  ".join(f"{o} {round(100*c/n):3d}%" for o, c in v.items()))
