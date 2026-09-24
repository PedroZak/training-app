#!/usr/bin/env python3
"""De-para: nomes de exercício usados hoje -> ids do catálogo (exercises.json).

Fontes de nomes: o seed em data.js e, se existirem, backups JSON em local/backups/
(pasta ignorada pelo git — backups têm dados pessoais e NUNCA vão pro repo).
Saída (também em local/, ignorada): de-para.csv, ambiguos.csv, sem-match.csv.

Nada é aceito automaticamente: a coluna 'decisao' fica vazia para você preencher.
"""
import csv, difflib, json, re, sys, unicodedata
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "local"

STOP = {"de", "da", "do", "das", "dos", "com", "na", "no", "nas", "nos", "em", "a", "o", "e", "para", "ou"}
ABBR = {"desenv": "desenvolvimento", "halt": "halteres", "halter": "halteres", "alt": "alternada",
        "bar": "barra"}
HIGH, MID = 0.88, 0.70


def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[/()\-_.,°]", " ", s)
    toks = [ABBR.get(t, t) for t in s.split() if t not in STOP]
    return toks


WEIGHT = {}  # peso por palavra (mais rara = mais informativa: "rdl" > "barra")


def build_weights(cands):
    import math
    from collections import Counter
    df = Counter(t for toks, _, _ in cands for t in set(toks))
    n = len(cands)
    WEIGHT.clear()
    WEIGHT.update({t: math.log((n + 1) / (d + 1)) + 1 for t, d in df.items()})
    WEIGHT["__unknown__"] = math.log(n + 1) + 1


def w(t):
    return WEIGHT.get(t, WEIGHT["__unknown__"])


def score(q, c):
    if q == c:
        return 1.0
    qs, cs = set(q), set(c)
    if not qs or not cs:
        return 0.0
    inter = sum(w(t) for t in qs & cs)
    p, r = inter / sum(w(t) for t in qs), inter / sum(w(t) for t in cs)
    f1 = 0 if inter == 0 else 2 * p * r / (p + r)
    seq = difflib.SequenceMatcher(None, " ".join(q), " ".join(c)).ratio()
    return 0.6 * f1 + 0.4 * seq


def load_catalog():
    cat = json.loads((ROOT / "exercises.json").read_text(encoding="utf-8"))["exercises"]
    cands = []  # (tokens, texto, ex)
    for e in cat:
        for t in [e["name_pt"], e["name_en"], *e["aliases"]]:
            cands.append((norm(t), t, e))
    return cat, cands


def variants(name):
    """'Barra Fixa (Pull-up)' -> nome completo, sem parênteses e só o parêntese."""
    out = [norm(name)]
    base = re.sub(r"\([^)]*\)", " ", name)
    if base.strip() != name.strip():
        out.append(norm(base))
        out += [norm(x) for x in re.findall(r"\(([^)]*)\)", name)]
    return [v for v in out if v]


def best_matches(name, cands, k=3):
    per = {}
    for q in variants(name):
        for toks, txt, e in cands:
            s = score(q, toks)
            if s > per.get(e["id"], (0,))[0]:
                per[e["id"]] = (s, txt, e)
    return sorted(per.values(), key=lambda x: -x[0])[:k]


def names_in_use():
    names = {}
    seed = (ROOT / "data.js").read_text(encoding="utf-8")
    for m in re.finditer(r"\bex\('([^']+)'", seed):
        names.setdefault(m.group(1), set()).add("seed")
    bdir = OUT / "backups"
    if bdir.exists():
        for f in sorted(bdir.glob("*.json")):
            data = json.loads(f.read_text(encoding="utf-8"))
            for w in data.get("workouts", {}).values():
                for e in w.get("exercises", []):
                    names.setdefault(e["name"], set()).add(f"backup:{f.name}")
    return names


def classify(name, cands):
    parts = [p.strip() for p in re.split(r"\s*/\s*|\s+ou\s+", name) if p.strip()]
    top = best_matches(name, cands)
    s0, txt0, e0 = top[0]
    conf = "alta" if s0 >= HIGH else "media" if s0 >= MID else "sem_match"
    status = "sugerido" if conf != "sem_match" else "sem_match"
    note = f"casou com '{txt0}'"
    if len(parts) > 1:
        # parte curta herda a 1ª palavra da primeira ("Agachamento Livre / Smith" -> "Agachamento Smith")
        head = parts[0].split()[0]
        ctx = [parts[0]] + [f"{head} {p}" if len(p.split()) == 1 else p for p in parts[1:]]
        hits = [best_matches(p, cands, 1)[0][2]["id"] for p in ctx]
        if len(set(hits)) > 1:  # o nome mistura 2 exercícios
            status = "ambiguo"
            note = "nome mistura mais de um exercício: " + " | ".join(f"'{p}'→{h}" for p, h in zip(parts, hits))
    if status == "sugerido" and len(top) > 1 and top[1][0] >= s0 - 0.04 and top[1][2]["id"] != e0["id"]:
        status = "ambiguo"
        note = f"empate com {top[1][2]['id']} ({top[1][0]:.2f})"
    return top, conf, status, note


def load_decisions(cat):
    """local/decisions.json: {"nome atual": "id-do-catalogo"} — decisões já confirmadas por você."""
    f = OUT / "decisions.json"
    dec = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    ids = {e["id"] for e in cat}
    bad = {k: v for k, v in dec.items() if v not in ids}
    if bad:
        sys.exit(f"decisions.json aponta para ids inexistentes: {bad}")
    return dec


def main():
    cat, cands = load_catalog()
    decisions = load_decisions(cat)
    by_id = {e["id"]: e for e in cat}
    build_weights(cands)
    names = names_in_use()
    rows = []
    for name in sorted(names):
        top, conf, status, note = classify(name, cands)
        s0, txt0, e0 = top[0]
        alts = "; ".join(f"{t[2]['id']} ({t[0]:.2f})" for t in top[1:])
        decided = decisions.get(name)
        if decided:
            auto = e0["id"] if status != "sem_match" else "(sem match)"
            note += "" if auto == decided else f" | AUTO sugeria {auto}, você decidiu {decided}"
            status, conf, e0 = "confirmado", "decisao_sua", by_id[decided]
        rows.append({
            "nome_atual": name, "origem": ",".join(sorted(names[name])),
            "sugestao_id": e0["id"] if status not in ("sem_match",) else "",
            "sugestao_name_pt": e0["name_pt"] if status not in ("sem_match",) else "",
            "melhor_candidato_id": e0["id"], "score": f"{s0:.2f}",
            "confianca": conf, "status": status, "custom_no_catalogo": "sim" if e0["custom"] else "",
            "tem_midia": "sim" if e0["media"] else "nao",
            "alternativas": alts, "observacao": note, "decisao": decided or "",
        })
    OUT.mkdir(exist_ok=True)
    cols = list(rows[0].keys())

    def dump(fn, rs):
        with open(OUT / fn, "w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel abre com acento certo
            w = csv.DictWriter(f, cols, delimiter=";")
            w.writeheader(); w.writerows(rs)

    dump("de-para.csv", rows)
    dump("ambiguos.csv", [r for r in rows if r["status"] == "ambiguo"])
    dump("sem-match.csv", [r for r in rows if r["status"] == "sem_match"])
    dump("pendentes.csv", [r for r in rows if r["status"] in ("ambiguo", "sem_match")])
    from collections import Counter
    print(f"{len(rows)} nomes | ", dict(Counter((r['status'], r['confianca']) for r in rows)))
    for r in rows:
        print(f"[{r['status']:9}|{r['confianca']:9}|{r['score']}] {r['nome_atual']:32} -> {r['melhor_candidato_id']}  ({r['observacao']})")


if __name__ == "__main__":
    main()
