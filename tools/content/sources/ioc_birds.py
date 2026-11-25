"""IOC World Bird List -> content/kb/birds.json  (every recognised species: English name, scientific name, family,
breeding region, extinct flag; plus group names such as "treeswift" that several species share).
Source: Gill, F, D Donsker & P Rasmussen (Eds). IOC World Bird List. https://www.worldbirdnames.org/ (CC BY 4.0).
    python3 tools/content/sources/ioc_birds.py path/to/master_ioc_list_vXX.xlsx
Download the master list from https://www.worldbirdnames.org/new/ioc-lists/master-list-2/ (the www host)."""
import json, os, sys, collections, datetime
import openpyxl
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "content", "kb", "birds.json")
def main(path):
    wb = openpyxl.load_workbook(path, read_only=True); ws = wb.worksheets[0]
    title = next(ws.iter_rows(values_only=True))[2]
    genus = family = order = None; items = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 4: continue
        if row[2]: order = row[2]
        if row[4]: family = row[4]
        if row[5]: genus = row[5]
        if row[6] and row[10]:
            items.append({"a": row[10].strip().lower(), "sci": f"{genus.capitalize()} {row[6]}", "family": (family or "").lower(),
                          "order": (order or "").lower(), "region": (row[11] or "").strip(), "extinct": bool(row[8])})
    # Group names: the last word of a species name when several species share it ("warbler", "treeswift").
    last = collections.Counter(x["a"].split()[-1] for x in items if " " in x["a"])
    groups = sorted(w for w, n in last.items() if n >= 3 and len(w) > 3 and "-" not in w)
    out = {"domain": "birds", "source": title, "url": "https://www.worldbirdnames.org/", "license": "CC BY 4.0 (IOC World Bird List)",
           "retrieved": datetime.date.today().isoformat(), "species": items, "groups": groups}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"{len(items)} species ({sum(x['extinct'] for x in items)} extinct), {len(groups)} group names -> {os.path.relpath(OUT)}")
if __name__ == "__main__": main(sys.argv[1])
