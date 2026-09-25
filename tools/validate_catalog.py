#!/usr/bin/env python3
"""Valida o catálogo de exercícios: exercises.json + media/ + exercise-map.json.

Uso (na raiz do repositório):
    python tools/validate_catalog.py [--root DIR] [--summary ARQ.md] [--csv ARQ.csv]

Só biblioteca padrão. Sai com código 1 se houver ERRO; AVISOS não reprovam.
--summary  grava um resumo em Markdown (no Actions: $GITHUB_STEP_SUMMARY)
--csv      grava a lista de exercícios ainda sem mídia
"""
import argparse, csv, json, re, subprocess, sys, unicodedata
from collections import defaultdict
from pathlib import Path

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STATUS_OK = {"a_revisar", "revisado"}
MEDIA_TYPES = {
    "image": {".webp", ".jpg", ".jpeg", ".png", ".avif"},
    "gif": {".gif"},
    "video": {".mp4", ".webm"},
}
# Arquivos pessoais NUNCA podem estar versionados (repositório público).
PERSONAL = re.compile(r"(^|/)(local|backups?)/|backup-treino|\.backup\.json$|\.bundle$", re.I)


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []
        self.stats = {}
        self.missing = []  # exercícios sem mídia

    def error(self, msg): self.errors.append(msg)
    def warn(self, msg): self.warnings.append(msg)


def norm(s):
    """Sem acento, minúsculas, só letras/números separados por espaço (igual à busca do app)."""
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def file_problem(path, ext):
    """Devolve uma descrição do problema do arquivo de mídia, ou None se estiver íntegro."""
    try:
        data = path.read_bytes()
    except OSError as e:
        return f"não foi possível ler ({e})"
    if not data:
        return "arquivo vazio"
    ext = ext.lower()
    if ext == ".webp":
        if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
            return "não é um WebP válido"
        if int.from_bytes(data[4:8], "little") + 8 != len(data):
            return "WebP truncado ou corrompido (tamanho não bate com o cabeçalho)"
    elif ext in (".jpg", ".jpeg"):
        if data[:3] != b"\xff\xd8\xff":
            return "não é um JPEG válido"
        if not data.rstrip(b"\x00").endswith(b"\xff\xd9"):
            return "JPEG truncado (sem marcador final)"
    elif ext == ".png":
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            return "não é um PNG válido"
        if b"IEND" not in data[-16:]:
            return "PNG truncado (sem IEND)"
    elif ext == ".gif":
        if data[:6] not in (b"GIF87a", b"GIF89a"):
            return "não é um GIF válido"
        if not data.rstrip(b"\x00").endswith(b";"):
            return "GIF truncado (sem terminador)"
    elif ext == ".avif":
        if data[4:8] != b"ftyp":
            return "não é um AVIF válido"
    elif ext == ".mp4":
        if data[4:8] != b"ftyp":
            return "não é um MP4 válido"
    elif ext == ".webm":
        if data[:4] != b"\x1a\x45\xdf\xa3":
            return "não é um WebM válido"
    return None


def resolve_media(root, rel, rep, where):
    """Caminho seguro dentro de root/media, ou None (com erro registrado)."""
    if not isinstance(rel, str) or not rel.strip():
        rep.error(f"{where}: url vazia")
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*:", rel, re.I) or rel.startswith("//"):
        rep.error(f"{where}: url externa '{rel}' (hotlink não é permitido; versione o arquivo em media/)")
        return None
    p = (root / rel).resolve()
    try:
        p.relative_to((root / "media").resolve())
    except ValueError:
        rep.error(f"{where}: '{rel}' fica fora de media/")
        return None
    return p


def check_media_file(root, rel, kind, rep, where, referenced):
    p = resolve_media(root, rel, rep, where)
    if p is None:
        return
    referenced.add(p)
    ext = p.suffix.lower()
    if ext not in MEDIA_TYPES.get(kind, set()):
        rep.error(f"{where}: extensão '{ext}' não combina com type '{kind}' ({rel})")
        return
    if not p.is_file():
        rep.error(f"{where}: arquivo não existe: {rel}")
        return
    prob = file_problem(p, ext)
    if prob:
        rep.error(f"{where}: {rel} — {prob}")


def validate(root):
    root = Path(root).resolve()
    rep = Report()
    cat_path = root / "exercises.json"
    if not cat_path.is_file():
        rep.error("exercises.json não encontrado")
        return rep
    try:
        data = json.loads(cat_path.read_text(encoding="utf-8"))
        exercises = data["exercises"]
        assert isinstance(exercises, list)
    except Exception as e:
        rep.error(f"exercises.json inválido: {e}")
        return rep

    seen_ids, referenced = {}, set()
    names = defaultdict(list)  # texto normalizado -> [(id, texto original)]
    n_media = n_thumb = 0
    for idx, ex in enumerate(exercises):
        eid = ex.get("id") if isinstance(ex, dict) else None
        where = f"[{eid or f'#{idx}'}]"
        if not isinstance(ex, dict):
            rep.error(f"{where}: entrada não é um objeto")
            continue

        # identidade
        if not isinstance(eid, str) or not SLUG.match(eid):
            rep.error(f"{where}: id inválido (use slug minúsculo com hífens): {eid!r}")
        elif eid.startswith("custom-"):
            rep.error(f"{where}: prefixo 'custom-' é reservado aos exercícios criados no app")
        if eid in seen_ids:
            rep.error(f"{where}: id duplicado (também em #{seen_ids[eid]})")
        seen_ids.setdefault(eid, idx)

        # campos obrigatórios
        if not str(ex.get("name_pt") or "").strip():
            rep.error(f"{where}: name_pt vazio ou ausente")
        if ex.get("name_pt_status") not in STATUS_OK:
            rep.error(f"{where}: name_pt_status deve ser um de {sorted(STATUS_OK)} (veio {ex.get('name_pt_status')!r})")
        for f in ("muscle_primary", "equipment", "category"):
            if not str(ex.get(f) or "").strip():
                rep.error(f"{where}: {f} vazio ou ausente")
        if not isinstance(ex.get("muscle_secondary", []), list):
            rep.error(f"{where}: muscle_secondary deve ser lista")
        if not isinstance(ex.get("custom"), bool):
            rep.error(f"{where}: custom deve ser true/false")
        if not ex.get("custom") and not str(ex.get("name_en") or "").strip():
            rep.warn(f"{where}: sem name_en")
        aliases = ex.get("aliases", [])
        if not isinstance(aliases, list) or not all(isinstance(a, str) and a.strip() for a in aliases):
            rep.error(f"{where}: aliases deve ser lista de textos não vazios")
            aliases = []

        # colisão de nomes/aliases (sem acento e sem diferenciar maiúsculas)
        for text in [ex.get("name_pt"), ex.get("name_en"), *aliases]:
            n = norm(text)
            if n:
                names[n].append((eid, text))

        # mídias
        media = ex.get("media")
        if not isinstance(media, list):
            rep.error(f"{where}: media deve ser lista")
            media = []
        orders = []
        for m_i, m in enumerate(media):
            mw = f"{where} media[{m_i}]"
            if not isinstance(m, dict):
                rep.error(f"{mw}: não é um objeto")
                continue
            n_media += 1
            kind = m.get("type")
            if kind not in MEDIA_TYPES:
                rep.error(f"{mw}: type deve ser image, gif ou video (veio {kind!r})")
            if not str(m.get("source") or "").strip():
                rep.error(f"{mw}: source vazio ou ausente")
            if not str(m.get("license") or "").strip():
                rep.error(f"{mw}: license vazio ou ausente")
            if not str(m.get("attribution") or "").strip():
                rep.warn(f"{mw}: attribution vazio")
            so = m.get("sort_order")
            if not isinstance(so, int) or isinstance(so, bool):
                rep.error(f"{mw}: sort_order deve ser inteiro")
            else:
                orders.append(so)
            if kind in MEDIA_TYPES:
                check_media_file(root, m.get("url"), kind, rep, mw, referenced)
        if len(orders) != len(set(orders)):
            rep.error(f"{where}: sort_order repetido entre as mídias")

        thumb = ex.get("thumb")
        if thumb:
            n_thumb += 1
            check_media_file(root, thumb, "image", rep, f"{where} thumb", referenced)
        elif any(isinstance(m, dict) and m.get("type") == "image" for m in media):
            rep.warn(f"{where}: tem imagem mas não tem thumb (o seletor mostrará um ícone genérico)")

        if not media:
            rep.missing.append(ex)

    for n, items in names.items():
        owners = {i for i, _ in items}
        if len(owners) > 1:
            det = "; ".join(f"{i} ('{t}')" for i, t in items)
            rep.error(f"colisão de nome/alias '{n}' entre exercícios diferentes: {det}")

    # exercise-map.json (nome no app -> id)
    mp = root / "exercise-map.json"
    if mp.is_file():
        try:
            mapping = json.loads(mp.read_text(encoding="utf-8"))["map"]
            for nome, mid in mapping.items():
                if mid not in seen_ids:
                    rep.error(f"exercise-map.json: '{nome}' aponta para id inexistente '{mid}'")
        except Exception as e:
            rep.error(f"exercise-map.json inválido: {e}")
    else:
        rep.warn("exercise-map.json não encontrado")

    # mídia órfã (aviso)
    mdir = root / "media"
    if mdir.is_dir():
        orphans = sorted(str(p.relative_to(root)).replace("\\", "/")
                         for p in mdir.rglob("*") if p.is_file() and p.resolve() not in referenced)
        if orphans:
            rep.warn(f"{len(orphans)} arquivo(s) em media/ sem uso no catálogo (ex.: {', '.join(orphans[:3])})")

    # arquivos pessoais versionados (repositório público)
    if (root / ".git").exists():
        try:
            out = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True).stdout
            for f in out.splitlines():
                if PERSONAL.search(f):
                    rep.error(f"arquivo pessoal/backup versionado no git: {f} (repositório público; remova e mantenha em local/)")
        except (OSError, subprocess.CalledProcessError):
            rep.warn("git indisponível: não foi possível checar arquivos pessoais versionados")

    total = len(exercises)
    rep.stats = {
        "exercícios": total,
        "personalizados (custom:true)": sum(1 for e in exercises if isinstance(e, dict) and e.get("custom")),
        "com mídia": total - len(rep.missing),
        "sem mídia": len(rep.missing),
        "arquivos de mídia": n_media,
        "miniaturas": n_thumb,
        "name_pt a revisar": sum(1 for e in exercises if isinstance(e, dict) and e.get("name_pt_status") == "a_revisar"),
    }
    return rep


def write_csv(rep, path):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id", "name_pt", "custom", "musculo", "equipamento"])
        for e in rep.missing:
            w.writerow([e.get("id"), e.get("name_pt"), "sim" if e.get("custom") else "nao", e.get("muscle_primary"), e.get("equipment")])


def write_summary(rep, path):
    ok = not rep.errors
    L = [f"## Catálogo de exercícios — {'✅ válido' if ok else '❌ ' + str(len(rep.errors)) + ' erro(s)'}", ""]
    L += ["| Item | Total |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in rep.stats.items()] + [""]
    if rep.errors:
        L += ["### Erros", *[f"- {e}" for e in rep.errors[:100]], ""]
    if rep.warnings:
        L += ["### Avisos", *[f"- {w}" for w in rep.warnings[:50]], ""]
    L.append("### Exercícios sem mídia")
    if rep.missing:
        L += ["| id | nome | custom | músculo |", "|---|---|:-:|---|"]
        L += [f"| `{e.get('id')}` | {e.get('name_pt')} | {'sim' if e.get('custom') else ''} | {e.get('muscle_primary')} |" for e in rep.missing]
    else:
        L.append("Nenhum — todos os exercícios têm ao menos uma mídia.")
    with open(path, "a", encoding="utf-8") as f:  # append: $GITHUB_STEP_SUMMARY aceita várias seções
        f.write("\n".join(L) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--summary")
    ap.add_argument("--csv")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    rep = validate(a.root)
    for k, v in rep.stats.items():
        print(f"{k}: {v}")
    for w in rep.warnings:
        print(f"AVISO  {w}")
    for e in rep.errors:
        print(f"ERRO   {e}")
    if rep.missing:
        print(f"Sem mídia ({len(rep.missing)}): " + ", ".join(e.get("id", "?") for e in rep.missing))
    if a.csv:
        write_csv(rep, a.csv)
    if a.summary:
        write_summary(rep, a.summary)
    print("RESULTADO:", "OK" if not rep.errors else f"REPROVADO ({len(rep.errors)} erro(s))")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
