"""The curated question set (content/curated/batch-*.json, researched and written for review) as playtest days.
Days 301-314: five questions a day, interleaved across subjects so each day mixes them. Questions marked "reject" by
their researcher are left out (they are still listed in the review dashboard with the reason).
Called by build.py; also: python3 tools/playtest/curated.py <out>"""
import json, os, glob, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
# Hand-written tiers are estimates: the rarest is kept above 0.015% of players (about 280 m), so nothing reaches
# Unfathomable without real evidence.
TIERS = [("common", 0.12, 0.025), ("less_common", 0.01, 0.0015), ("obscure", 0.0008, 0.00015)]
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s).lower())).strip()
ICONS = {"batch-1": "default", "batch-2": "default", "batch-3": "default", "batch-4": "default", "batch-5": "globe", "batch-6": "default", "batch-7": "default"}

def rows_of(q):
    rows, seen = [], set()
    for tier, hi, lo in TIERS:
        items = q.get("answers", {}).get(tier, [])
        for j, a in enumerate(items):
            names = [a] if isinstance(a, str) else list(a)
            if not names or not names[0]: continue
            k = norm(names[0])
            if k in seen: continue
            seen.add(k)
            s = hi if len(items) == 1 else hi * (lo / hi) ** (j / (len(items) - 1))
            rows.append({"a": names[0], "s": round(s, 6), "al": [x for x in names[1:] if norm(x) not in seen], "tier": tier})
    return rows

def question(q, batch):
    out = {"key": "c-" + q["id"], "title": q.get("prompt", q["id"]), "icon": ICONS.get(batch, "default"), "prompt": q["prompt"], "hint": q.get("hint", ""),
           "rules": q.get("rules", []), "answers": rows_of(q), "general": [], "notIn": [], "curated": True,
           "granularity_note": q.get("granularity", ""), "verdict": q.get("verdict"), "verdict_reason": q.get("verdict_reason", "")}
    # Questions about brands or models use the brands-and-models list: on a model question a brand alone is asked to
    # be specific; on a brand question a model counts as its brand.
    if q["id"] == "luxury-watch-model": out.update(granularity="model", kb="products:wearables")
    if q["id"] == "luxury-brand": out.update(granularity="brand", kb="products:wearables")
    mode = q.get("mode")
    mech = (q.get("mechanic") or "").lower()
    if mode and mode.get("type") in ("forbidden", "target"):
        out["mode"] = mode
    elif "sea mines" in mech or mech.startswith("mines"):
        s = sorted([r["s"] for r in out["answers"]], reverse=True)
        if len(s) > 20:
            mid, deep = s[min(len(s) - 1, 8)], s[min(len(s) - 1, len(s) // 2)]
            out["mode"] = {"type": "mines", "mines": [{"lo": round(mid / 1.6, 6), "hi": round(mid * 1.6, 6)}, {"lo": round(deep / 1.6, 6), "hi": round(deep * 1.6, 6)}]}
    elif "risk" in mech: out["mode"] = {"type": "risk"}
    elif "wildcard" in mech: out["mode"] = {"type": "wildcard"}
    if out.get("mode", {}).get("type") == "forbidden":
        have = {norm(r["a"]): r["a"] for r in out["answers"]}
        for r in out["answers"]:
            for x in r["al"]: have.setdefault(norm(x), r["a"])
        out["mode"]["forbid"] = [have[norm(f)] for f in out["mode"].get("forbid", []) if norm(f) in have]
    return out

def load():
    batches = []
    for p in sorted(glob.glob(os.path.join(ROOT, "content", "curated", "batch-*.json"))):
        try: qs = json.load(open(p))["questions"]
        except Exception as e: print("skipping", p, e); continue
        b = os.path.basename(p)[:-5]
        batches.append([question(q, b) for q in qs if q.get("verdict") != "reject" and q.get("answers")])
    return batches

def build(out):
    batches = load()
    if not batches: return []
    order, i = [], 0
    while any(batches):
        b = batches[i % len(batches)]
        if b: order.append(b.pop(0))
        i += 1
    entries = []
    for d in range(0, len(order), 5):
        qs = order[d:d + 5]
        if len(qs) < 3: break
        n = 301 + d // 5
        day = {"v": 3, "day": n, "questions": qs, "experimental": True, "label": f"Curated set · day {d // 5 + 1}"}
        json.dump(day, open(os.path.join(out, "pt", f"{n}.json"), "w"), separators=(",", ":"))
        entries.append({"n": n, "group": "curated", "source": f"Curated set · day {d // 5 + 1}",
                        "questions": [f"[{(q.get('mode') or {}).get('type', 'rarity')}] {q['prompt']}" for q in qs]})
    return entries

if __name__ == "__main__":
    os.makedirs(os.path.join(sys.argv[1], "pt"), exist_ok=True); print(len(build(sys.argv[1])), "days")
