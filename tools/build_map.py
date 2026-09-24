#!/usr/bin/env python3
"""Gera exercise-map.json (nome do exercício no app -> id do catálogo) a partir do
de-para aprovado (local/de-para.csv). Só nomes e ids — nenhuma carga ou dado pessoal."""
import csv, json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
catalog = {e["id"] for e in json.loads((ROOT / "exercises.json").read_text(encoding="utf-8"))["exercises"]}
rows = list(csv.DictReader(open(ROOT / "local" / "de-para.csv", encoding="utf-8-sig"), delimiter=";"))
mapping, bad = {}, []
for r in rows:
    if r["status"] not in ("sugerido", "confirmado") or r["sugestao_id"] not in catalog:
        bad.append(r["nome_atual"])
    else:
        mapping[r["nome_atual"]] = r["sugestao_id"]
if bad:
    sys.exit(f"nomes sem id válido (resolva antes): {bad}")
out = ROOT / "exercise-map.json"
out.write_text(json.dumps({"version": 1, "map": dict(sorted(mapping.items()))}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{out.name}: {len(mapping)} nomes -> {len(set(mapping.values()))} ids distintos")
