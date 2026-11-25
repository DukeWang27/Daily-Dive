"""GeoNames (CC BY 4.0) -> content/kb/cities.json: every city with 15,000+ people, its country, population and the
English-alphabet other names. Download cities15000.zip and countryInfo.txt from https://download.geonames.org/export/dump/
    python3 tools/content/sources/geonames.py cities15000.zip countryInfo.txt"""
import csv, io, json, os, sys, zipfile, datetime
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "content", "kb", "cities.json")
def main(zpath, info):
    countries = {}
    for line in open(info, encoding="utf-8"):
        if line.startswith("#"): continue
        f = line.rstrip("\n").split("\t")
        if len(f) > 4: countries[f[0]] = f[4]
    items = []
    with zipfile.ZipFile(zpath) as z:
        for f in csv.reader(io.TextIOWrapper(z.open("cities15000.txt"), encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
            name, ascii_, alts, cc, pop = f[1], f[2], f[3], f[8], int(f[14] or 0)
            al = sorted({a for a in alts.split(",") if a and a.isascii() and a[0].isupper() and a != name and len(a) <= 40})[:8]
            if ascii_ != name and ascii_ not in al: al.insert(0, ascii_)
            items.append({"id": f[0], "a": name, "al": al, "country": countries.get(cc, cc), "pop": pop})
    items.sort(key=lambda x: -x["pop"])
    json.dump({"domain": "cities", "source": "GeoNames cities15000", "url": "https://www.geonames.org/", "license": "CC BY 4.0",
               "retrieved": datetime.date.today().isoformat(), "items": items}, open(OUT, "w"), separators=(",", ":"))
    print(f"{len(items)} cities -> content/kb/cities.json")
if __name__ == "__main__": main(*sys.argv[1:3])
