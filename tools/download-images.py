#!/usr/bin/env python3
"""Download the product images listed in data/image-sources.csv (status "use") into images/products/<sku>/1.jpg.
Run from anywhere:  python3 tools/download-images.py
Tries a larger Newegg image size first and falls back to the 300 px thumbnail."""
import csv, os, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()
with open(os.path.join(ROOT, "data", "image-sources.csv"), newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row["status"] != "use":
            continue
        sku = row["sku"].lower()
        dest = os.path.join(ROOT, "images", "products", sku, "1.jpg")
        if os.path.exists(dest):
            print("skip", sku); continue
        for size in ("nb1280", "nb640", "nb300"):
            try:
                data = get(row["image_url"].replace("/nb300/", "/" + size + "/"))
            except Exception:
                continue
            if len(data) > 2000:
                open(dest, "wb").write(data); print("saved", sku, size); break
        else:
            print("FAILED", sku)
