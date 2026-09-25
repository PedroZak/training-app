#!/usr/bin/env python3
"""Monta exercises.json a partir de tools/curated.txt + free-exercise-db (Unlicense)
e gera só as mídias dos exercícios curados em media/<id>/ (WebP, largura máx. 600px).

Originais (JPG) ficam em local/cache/img/ (ignorado pelo git).
Requer Pillow para converter:  python tools/build_catalog.py [--no-media]

Suas próprias mídias e exercícios NÃO se perdem ao regenerar:
  tools/own_media.json        {"id-do-exercicio": [{"type","url","source","license","attribution"}, ...]}
                              os arquivos ficam em media/<id>/ (ex.: media/supino-reto-barra/meu-video.mp4)
  tools/custom_exercises.json lista de exercícios que não existem no dataset (custom:true)
A limpeza de media/ remove só o que o build gerou antes e não está listado em own_media.json.
"""
import json, shutil, sys, urllib.request, concurrent.futures as cf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "local" / "cache"
DB_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
IMG_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"
SRC_REPO = "https://github.com/yuhonas/free-exercise-db"
MAX_W, WEBP_QUALITY = 600, 78
THUMB_W, THUMB_QUALITY = 160, 70  # miniatura da lista do seletor (não entra em media[], não faz loop)

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



def load_json(name, default):
    p = ROOT / "tools" / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def custom_exercises():
    """Exercícios que NÃO existem no free-exercise-db (custom:true, por commit).
    Formato: {"id","name_pt","name_en","aliases":[],"muscle_primary","muscle_secondary":[],"equipment","category"}"""
    return load_json("custom_exercises.json", [])


def apply_own_media(catalog):
    """Acrescenta as mídias próprias (tools/own_media.json) depois das do dataset. Devolve os arquivos a preservar."""
    keep, by_id = set(), {c["id"]: c for c in catalog}
    for eid, entries in load_json("own_media.json", {}).items():
        if eid not in by_id:
            sys.exit(f"own_media.json: exercício inexistente: {eid}")
        c = by_id[eid]
        nxt = max((m["sort_order"] for m in c["media"]), default=-1) + 1
        for i, m in enumerate(entries):
            f = (ROOT / m["url"]).resolve()
            if not m["url"].startswith("media/") or not f.is_file():
                sys.exit(f"own_media.json: arquivo inexistente ou fora de media/: {m['url']}")
            for k in ("type", "source", "license"):
                if not str(m.get(k) or "").strip():
                    sys.exit(f"own_media.json: {eid} / {m['url']}: '{k}' obrigatório")
            c["media"].append({"type": m["type"], "url": m["url"], "sort_order": nxt + i, "source": m["source"],
                               "license": m["license"], "attribution": m.get("attribution", "")})
            keep.add(f)
    return keep


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


def make_thumb(job):
    from PIL import Image
    orig, dest = job
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(orig) as im:
        im = im.convert("RGB")
        im = im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS)
        im.save(dest, "WEBP", quality=THUMB_QUALITY, method=6)
    return dest


def reviewed_ids():
    """Ids do exercise-map.json = exercícios do seu treino, cujos nomes você já revisou e aprovou."""
    p = ROOT / "exercise-map.json"
    if not p.exists():
        return set()
    return set(json.loads(p.read_text(encoding="utf-8"))["map"].values())


def main():
    no_media = "--no-media" in sys.argv
    reviewed = reviewed_ids()
    db = fetch_db()
    catalog, jobs, thumb_jobs, seen = [], [], [], set()
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
        if e["images"]:
            thumb_jobs.append((CACHE / "img" / e["images"][0], ROOT / "media" / slug / "thumb.webp"))
        catalog.append({
            "id": slug,
            "name_pt": name_pt,
            "name_pt_status": "revisado" if slug in reviewed else "a_revisar",
            "name_en": e["name"],
            "aliases": aliases,
            "muscle_primary": MUSCLE_PT[e["primaryMuscles"][0]],
            "muscle_secondary": [MUSCLE_PT[m] for m in e.get("secondaryMuscles", []) if m in MUSCLE_PT],
            "equipment": EQUIP_OVERRIDE.get(slug, EQUIP_PT.get(e.get("equipment"), "outro")),
            "category": "força",
            "thumb": f"media/{slug}/thumb.webp" if e["images"] else None,
            "media": media,
            "custom": False,
            "source_id": fed_id,
        })
    for c in custom_exercises():
        if c["id"] in seen:
            sys.exit(f"slug duplicado: {c['id']}")
        catalog.append({**c, "name_pt_status": "a_revisar", "thumb": None, "media": [], "custom": True, "source_id": None})
    keep = apply_own_media(catalog)
    catalog.sort(key=lambda x: x["name_pt"].lower())

    out = ROOT / "exercises.json"
    out.write_text(json.dumps({"version": 1, "exercises": catalog}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"exercises.json: {len(catalog)} exercícios ({sum(1 for c in catalog if c['custom'])} custom)")

    if not no_media:
        # limpeza sem sobras, preservando as mídias próprias listadas em own_media.json
        gerados = {j[2].resolve() for j in jobs} | {t[1].resolve() for t in thumb_jobs}
        if (ROOT / "media").is_dir():
            for f in list((ROOT / "media").rglob("*")):
                if f.is_file() and f.resolve() not in keep and f.resolve() not in gerados:
                    f.unlink()
            for d in sorted((ROOT / "media").rglob("*"), reverse=True):
                if d.is_dir() and not any(d.iterdir()):
                    d.rmdir()
        with cf.ThreadPoolExecutor(8) as ex:
            done = list(ex.map(process, jobs))
        total = sum(d.stat().st_size for d in done)
        print(f"mídias: {len(done)} arquivos WebP, {total/1e6:.1f} MB")
        with cf.ThreadPoolExecutor(8) as ex:
            thumbs = list(ex.map(make_thumb, thumb_jobs))
        print(f"miniaturas: {len(thumbs)} arquivos, {sum(t.stat().st_size for t in thumbs)/1e6:.2f} MB")


if __name__ == "__main__":
    main()
