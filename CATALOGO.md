# Catálogo de exercícios

Fonte única: `exercises.json` (somente leitura no navegador; editado por commit). O app só lê o arquivo;
seus treinos e cargas ficam no `localStorage` do aparelho e nunca vão para o repositório.

## Estrutura de cada exercício
`id` (slug estável), `name_pt`, `name_en`, `aliases[]`, `muscle_primary`, `muscle_secondary[]`, `equipment`,
`category`, `thumb`, `media[]` (`type` image|gif|video, `url`, `source`, `license`, `attribution`, `sort_order`),
`custom` (true = fora do dataset), `name_pt_status` (`a_revisar` | `revisado`).

Exercícios criados dentro do app usam ids `custom-…` e ficam só no aparelho (entram no backup).
O prefixo `custom-` é reservado a eles; os do repositório usam slug normal.

## Adicionar exercício do dataset (free-exercise-db, domínio público)
1. Inclua uma linha em `tools/curated.txt`: `id_do_dataset | slug | Nome em PT | alias1; alias2`
2. `python tools/build_catalog.py` (precisa de Pillow) — gera `exercises.json`, as fotos (WebP 600 px) e a miniatura.
3. `python tools/validate_catalog.py`

## Adicionar mídia própria (vídeo, GIF ou foto)
1. Coloque o arquivo em `media/<id-do-exercicio>/` (`.mp4`, `.webm`, `.gif`, `.webp`…).
2. Registre em `tools/own_media.json`:
   ```json
   { "supino-reto-barra": [ { "type": "video", "url": "media/supino-reto-barra/execucao.mp4",
       "source": "gravação própria", "license": "uso pessoal", "attribution": "seu nome" } ] }
   ```
3. `python tools/build_catalog.py` — a mídia própria é acrescentada e **não é apagada** ao regenerar.
No app, vídeo tem prioridade sobre GIF, que tem prioridade sobre as fotos em loop.

## Exercício que não existe no dataset
Adicione em `tools/custom_exercises.json` (`id`, `name_pt`, `name_en`, `aliases`, `muscle_primary`, `equipment`, `category`)
e, se quiser mídia, em `tools/own_media.json`. Ele entra como `custom: true`.

## Validação (local e no GitHub)
`python tools/validate_catalog.py` (e `python tools/test_validate_catalog.py` para os testes do validador).
O GitHub Actions (`.github/workflows/validar-catalogo.yml`) roda a cada commit e reprova se:
- algum exercício não tem `name_pt`, ou há `id` repetido ou fora do padrão slug;
- alguma mídia não tem `source` e `license`, aponta para URL externa (hotlink) ou o arquivo não existe / está vazio / truncado;
- dois exercícios diferentes compartilham nome ou alias (comparação sem acento e sem maiúsculas);
- o `exercise-map.json` aponta para um id que não existe;
- há backup ou arquivo pessoal versionado (`local/`, `backup-treino-*.json`, `*.bundle`).

O resumo de cada execução lista os **exercícios sem mídia** (também como artefato `exercicios-sem-midia.csv`).
Arquivos em `media/` que nenhum exercício usa geram apenas um aviso.

## Publicação
O site é servido pelo GitHub Pages a partir do `master`. Suba `CACHE_NAME` em `sw.js` a cada release do app e
`MEDIA_CACHE` só se um arquivo de `media/` for regenerado com o mesmo nome.
