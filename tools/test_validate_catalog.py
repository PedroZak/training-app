#!/usr/bin/env python3
"""Testes do validador: cada regra precisa REPROVAR quando deve e APROVAR quando não deve.
Usa um catálogo sintético mínimo em pasta temporária (não depende dos dados reais).

    python tools/test_validate_catalog.py
"""
import copy, json, shutil, struct, subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_catalog as V  # noqa: E402


def fake_webp(payload=b"x" * 40):
    body = b"WEBP" + payload
    return b"RIFF" + struct.pack("<I", len(body)) + body


def media(slug, i=0, **over):
    m = {"type": "image", "url": f"media/{slug}/{i}.webp", "sort_order": i,
         "source": "fonte", "license": "Unlicense", "attribution": "autor"}
    m.update(over)
    return m


def exercise(slug, name, aliases=(), **over):
    e = {"id": slug, "name_pt": name, "name_pt_status": "a_revisar", "name_en": name + " en",
         "aliases": list(aliases), "muscle_primary": "peito", "muscle_secondary": [], "equipment": "barra",
         "category": "força", "thumb": f"media/{slug}/thumb.webp", "media": [media(slug, 0), media(slug, 1)],
         "custom": False, "source_id": None}
    e.update(over)
    return e


BASE = {"version": 1, "exercises": [
    exercise("supino-reto", "Supino reto", ["supino"]),
    exercise("puxada-alta", "Puxada alta", ["pulldown"]),
]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = copy.deepcopy(BASE)
        for e in self.data["exercises"]:
            for rel in [m["url"] for m in e["media"]] + [e["thumb"]]:
                p = self.root / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(fake_webp())
        (self.root / "exercise-map.json").write_text(json.dumps({"version": 1, "map": {"Supino Reto Barra": "supino-reto"}}), encoding="utf-8")
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.root / "exercises.json").write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")

    def run_v(self):
        self.save()
        return V.validate(self.root)

    def assertFails(self, needle):
        rep = self.run_v()
        self.assertTrue(any(needle in e for e in rep.errors), f"esperava erro com '{needle}', veio: {rep.errors}")
        return rep

    def ex(self, i=0):
        return self.data["exercises"][i]


class Aprovacao(Base):
    def test_catalogo_valido_passa(self):
        rep = self.run_v()
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.stats["com mídia"], 2)

    def test_exercicio_sem_midia_passa_e_entra_na_lista(self):
        self.ex(1).update(media=[], thumb=None)
        rep = self.run_v()
        self.assertEqual(rep.errors, [])
        self.assertEqual([e["id"] for e in rep.missing], ["puxada-alta"])

    def test_custom_do_repo_sem_midia_passa(self):
        self.data["exercises"].append(exercise("meu-exercicio", "Meu exercício", custom=True, name_en="", media=[], thumb=None))
        self.assertEqual(self.run_v().errors, [])

    def test_arquivo_orfao_so_avisa(self):
        (self.root / "media" / "sobra.webp").write_bytes(fake_webp())
        rep = self.run_v()
        self.assertEqual(rep.errors, [])
        self.assertTrue(any("sem uso" in w for w in rep.warnings))

    def test_gif_e_video_validos_passam(self):
        (self.root / "media" / "a.gif").write_bytes(b"GIF89a" + b"\x00" * 10 + b";")
        (self.root / "media" / "b.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 20)
        self.ex(0)["media"] += [media("x", 2, type="gif", url="media/a.gif"), media("x", 3, type="video", url="media/b.mp4")]
        self.assertEqual(self.run_v().errors, [])


class Catalogo(Base):
    def test_name_pt_vazio(self):
        self.ex(0)["name_pt"] = "  "
        self.assertFails("name_pt vazio")

    def test_name_pt_ausente(self):
        del self.ex(0)["name_pt"]
        self.assertFails("name_pt vazio")

    def test_id_duplicado(self):
        self.ex(1)["id"] = "supino-reto"
        self.assertFails("id duplicado")

    def test_id_fora_do_padrao_slug(self):
        self.ex(0)["id"] = "Supino_Reto"
        self.assertFails("id inválido")

    def test_prefixo_custom_reservado(self):
        self.ex(0)["id"] = "custom-supino"
        self.assertFails("reservado")

    def test_status_invalido(self):
        self.ex(0)["name_pt_status"] = "talvez"
        self.assertFails("name_pt_status")

    def test_custom_precisa_ser_booleano(self):
        self.ex(0)["custom"] = "sim"
        self.assertFails("custom deve ser")

    def test_json_quebrado(self):
        (self.root / "exercises.json").write_text("{ nao e json", encoding="utf-8")
        rep = V.validate(self.root)
        self.assertTrue(any("inválido" in e for e in rep.errors))


class Aliases(Base):
    def test_alias_igual_ao_nome_de_outro(self):
        self.ex(1)["aliases"].append("Supino reto")
        self.assertFails("colisão")

    def test_colisao_ignora_acento_e_maiuscula(self):
        self.ex(0)["aliases"].append("PULLDOWN")
        self.ex(1)["aliases"] = ["Púlldown"]
        self.assertFails("colisão")

    def test_mesmo_alias_repetido_no_mesmo_exercicio_nao_e_colisao(self):
        self.ex(0)["aliases"] = ["supino", "Supino"]
        self.assertEqual(self.run_v().errors, [])

    def test_alias_vazio(self):
        self.ex(0)["aliases"].append("")
        self.assertFails("aliases deve ser")


class Midia(Base):
    def test_sem_license(self):
        self.ex(0)["media"][0]["license"] = ""
        self.assertFails("license vazio")

    def test_sem_source(self):
        del self.ex(0)["media"][0]["source"]
        self.assertFails("source vazio")

    def test_arquivo_inexistente(self):
        (self.root / "media/supino-reto/0.webp").unlink()
        self.assertFails("não existe")

    def test_arquivo_vazio(self):
        (self.root / "media/supino-reto/0.webp").write_bytes(b"")
        self.assertFails("vazio")

    def test_arquivo_corrompido(self):
        (self.root / "media/supino-reto/0.webp").write_bytes(b"isto nao e uma imagem" * 5)
        self.assertFails("WebP válido")

    def test_webp_truncado(self):
        p = self.root / "media/supino-reto/0.webp"
        p.write_bytes(p.read_bytes()[:-7])
        self.assertFails("truncado")

    def test_url_externa_hotlink(self):
        self.ex(0)["media"][0]["url"] = "https://exemplo.com/foto.webp"
        self.assertFails("hotlink")

    def test_url_fora_de_media(self):
        (self.root / "fora.webp").write_bytes(fake_webp())
        self.ex(0)["media"][0]["url"] = "fora.webp"
        self.assertFails("fora de media/")

    def test_url_com_path_traversal(self):
        self.ex(0)["media"][0]["url"] = "media/../exercises.json"
        self.assertFails("fora de media/")

    def test_extensao_nao_combina_com_type(self):
        self.ex(0)["media"][0]["type"] = "gif"
        self.assertFails("não combina")

    def test_type_invalido(self):
        self.ex(0)["media"][0]["type"] = "audio"
        self.assertFails("type deve ser")

    def test_sort_order_repetido(self):
        self.ex(0)["media"][1]["sort_order"] = 0
        self.assertFails("sort_order repetido")

    def test_thumb_inexistente(self):
        (self.root / "media/puxada-alta/thumb.webp").unlink()
        self.assertFails("thumb")


class Mapa(Base):
    def test_mapa_aponta_para_id_inexistente(self):
        (self.root / "exercise-map.json").write_text(json.dumps({"version": 1, "map": {"Algo": "nao-existe"}}), encoding="utf-8")
        self.assertFails("id inexistente")


class ArquivosPessoais(Base):
    def git(self, *a):
        return subprocess.run(["git", "-C", str(self.root), *a], capture_output=True, text=True, check=True)

    def setUp(self):
        super().setUp()
        try:
            self.git("init", "-q")
            self.git("config", "user.email", "t@t")
            self.git("config", "user.name", "t")
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("git indisponível")

    def test_backup_versionado_reprova(self):
        (self.root / "backup-treino-2026-09-24.json").write_text("{}", encoding="utf-8")
        self.git("add", "-A")
        self.assertFails("versionado no git")

    def test_pasta_local_versionada_reprova(self):
        (self.root / "local").mkdir()
        (self.root / "local" / "x.csv").write_text("a", encoding="utf-8")
        self.git("add", "-A")
        self.assertFails("versionado no git")

    def test_repo_limpo_passa(self):
        self.git("add", "-A")
        self.assertEqual(self.run_v().errors, [])


class Saida(Base):
    def test_codigo_de_saida_e_csv(self):
        self.ex(1).update(media=[], thumb=None)
        self.save()
        csv_path = self.root / "out.csv"
        self.assertEqual(V.main(["--root", str(self.root), "--csv", str(csv_path), "--summary", str(self.root / "s.md")]), 0)
        self.assertIn("puxada-alta", csv_path.read_text(encoding="utf-8-sig"))
        self.assertIn("Exercícios sem mídia", (self.root / "s.md").read_text(encoding="utf-8"))
        self.ex(0)["name_pt"] = ""
        self.save()
        self.assertEqual(V.main(["--root", str(self.root)]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
