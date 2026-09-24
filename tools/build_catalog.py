#!/usr/bin/env python3
"""Monta exercises.json a partir de tools/curated.txt + free-exercise-db (Unlicense)
e gera só as mídias dos exercícios curados em media/<id>/ (WebP, largura máx. 600px).

Originais (JPG) ficam em local/cache/img/ (ignorado pelo git); media/ é regenerada do zero.
Requer Pillow para converter:  python tools/build_catalog.py [--no-media]
"""
import json, shutil, sys, urllib.request, concurrent.futures as cf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "local" / "cache"
DB_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
IMG_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"
SRC_REPO = "https://github.com/yuhonas/free-exercise-db"
MAX_W, WEBP_QUALITY = 600, 78

MUSCLE_PT = {
    "abdominals": "abdômen", "abductors": "abdutores", "adductors": "adutores", "biceps": "bíceps",
    "calves": "panturrilha", "chest": "peito", "forearms": "antebraço", "glutes": "glúteos",
    "hamstrings": "posterior de coxa", "lats": "costas (dorsal)", "lower back": "lombar",
    "middle back": "costas (espessura)", "neck": "pescoço", "quadriceps": "quadríceps",
    "shoulders": "ombros", "traps": "trapézio", "triceps": "tríceps",
}
EQUIP_PT = {
    "barbell": "barra", "dumbbell": "halteres", "cable": "polia", "machine": "máquina",
    "body only": "peso corporal", "e-z curl bar": "barra W", "kettlebells": "kettlebell",
    "other": "outro", None: "outro",
}
# Ajustes onde o dado do free-exercise-db não descreve bem o equipamento na academia BR
EQUIP_OVERRIDE = {"paralelas-peito": "peso corporal", "extensao-lombar": "banco romano"}

# Exercícios que NÃO existem no free-exercise-db (custom:true, por commit, sem mídia por enquanto).
# Formato: {"id","name_pt","name_en","aliases":[],"muscle_primary","muscle_secondary":[],"equipment","category"}
CUSTOM = []


def fetch_db():
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / "fed.json"
    if not p.exists():
        with urllib.request.urlopen(DB_URL) as r:
            p.write_bytes(r.read())
    return {e["id"]: e for e in json.loads(p.read_text(encoding="utf-8"))}


def parse_curated():
    rows = []
    for ln in (ROOT / "tools" / "curated.txt").read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        parts = [p.strip() for p in ln.split("|")]
        if len(parts) != 4:
            sys.exit(f"linha inválida: {ln}")
        fed_id, slug, name_pt, aliases = parts
        rows.append((fed_id, slug, name_pt, [a.strip() for a in aliases.split(";") if a.strip()]))
    return rows


def process(job):
    """Baixa o JPG original para o cache e grava o WebP redimensionado em media/."""
    from PIL import Image
    url, orig, dest = job
    if not orig.exists() or orig.stat().st_size == 0:
        orig.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url) as r:
            orig.write_bytes(r.read())
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(orig) as im:
        im = im.convert("RGB")
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        im.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
    return dest


def main():
    no_media = "--no-media" in sys.argv
    db = fetch_db()
    catalog, jobs, seen = [], [], set()
    for fed_id, slug, name_pt, aliases in parse_curated():
        if fed_id not in db:
            sys.exit(f"id inexistente no free-exercise-db: {fed_id}")
        if slug in seen:
            sys.exit(f"slug duplicado: {slug}")
        seen.add(slug)
        e = db[fed_id]
        media = []
        for i, img in enumerate(e["images"]):
            rel = f"media/{slug}/{i}.webp"
            media.append({
                "type": "image", "url": rel, "sort_order": i,
                "source": f"free-exercise-db · exercises/{img}",
                "license": "Unlicense (domínio público)",
                "attribution": f"free-exercise-db — {SRC_REPO} (recomprimida: WebP, máx. {MAX_W}px)",
            })
            jobs.append((IMG_BASE + img, CACHE / "img" / img, ROOT / rel))
        catalog.append({
            "id": slug,
            "name_pt": name_pt,
            "name_pt_status": "a_revisar",
            "name_en": e["name"],
            "aliases": aliases,
            "muscle_primary": MUSCLE_PT[e["primaryMuscles"][0]],
            "muscle_secondary": [MUSCLE_PT[m] for m in e.get("secondaryMuscles", []) if m in MUSCLE_PT],
            "equipment": EQUIP_OVERRIDE.get(slug, EQUIP_PT.get(e.get("equipment"), "outro")),
            "category": "força",
            "media": media,
            "custom": False,
            "source_id": fed_id,
        })
    for c in CUSTOM:
        if c["id"] in seen:
            sys.exit(f"slug duplicado: {c['id']}")
        catalog.append({**c, "name_pt_status": "a_revisar", "media": [], "custom": True, "source_id": None})
    catalog.sort(key=lambda x: x["name_pt"].lower())

    out = ROOT / "exercises.json"
    out.write_text(json.dumps({"version": 1, "exercises": catalog}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"exercises.json: {len(catalog)} exercícios ({sum(1 for c in catalog if c['custom'])} custom)")

    if not no_media:
        shutil.rmtree(ROOT / "media", ignore_errors=True)  # gerada: recria do zero, sem sobras
        with cf.ThreadPoolExecutor(8) as ex:
            done = list(ex.map(process, jobs))
        total = sum(d.stat().st_size for d in done)
        print(f"mídias: {len(done)} arquivos WebP, {total/1e6:.1f} MB")


if __name__ == "__main__":
    main()
