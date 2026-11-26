"""Automated tests for zh-CN.json, ui_hook.Translator, and compiled executable."""
import json
import pathlib
import re
import subprocess
import tempfile
import unittest

import ui_hook

ROOT = pathlib.Path(__file__).resolve().parent


class TestDictionaryAndTranslator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads((ROOT / "zh-CN.json").read_text(encoding="utf-8"))
        cls.tr = ui_hook.Translator(cls.raw, enabled=True)

    def test_dictionary_structure_and_regexes(self):
        self.assertIn("exact", self.raw)
        self.assertIn("patterns", self.raw)
        self.assertGreater(len(self.raw["exact"]), 250)
        self.assertGreater(len(self.raw["patterns"]), 40)
        for pat, _repl in self.raw["patterns"]:
            re.compile(pat, re.S)
        for pat, _repl in self.raw.get("post_patterns", []):
            re.compile(pat)

    def test_exact_and_uppercase_headers(self):
        cases = {
            "Start": "开始",
            "Pause": "暂停",
            "EXP PER HOUR": "每小时经验",
            "Last 5 min": "近5分钟",
            "LAST 5 MIN": "近5分钟",
            "Mesos / hr": "金币 / 小时",
            "MESOS / HR": "金币 / 小时",
            "Net / hr": "净值 / 小时",
            "NET / HR": "净值 / 小时",
            "Elapsed": "已用时间",
            "ELAPSED": "已用时间",
            "TRACKING": "追踪中",
            "SETTINGS": "设置",
            "Best maps": "最佳地图",
            "Log this run": "记录本次",
            "No Reset": "不重置",
            "Choose a compact look": "选择精简模式外观",
        }
        for en, zh in cases.items():
            self.assertEqual(self.tr.translate(en), zh, f"Failed for {en!r}")

    def test_dynamic_patterns(self):
        cases = {
            "Tracking · Lv 42": "追踪中 · Lv 42",
            "Lv 43 in 1h 23m": "距 Lv 43 还需 1时23分",
            "TO LV 43": "距 Lv43",
            "net +12,340": "净 +12,340",
            "·  net +12,340": "·  净 +12,340",
            "Paused: no EXP for 15 seconds, so this time doesn't count. It carries on at your next EXP gain.":
                "已暂停：已有 15 秒没有获得经验，这段时间不计入。下次获得经验时会继续。",
            "15-min run: 6 of 15 min · 2 done here today":
                "15 分钟记录：已进行 6 / 15 分钟 · 今天在此已完成 2 次",
            "3–5ppl ▸": "3–5人 ▸",
            "Jan 5, 2026": "2026年1月5日",
            "Use Square": "使用方形",
            "Use Wide": "使用宽屏",
            "Use Bar": "使用长条",
            "v0.9.17-beta is out": "v0.9.17-beta 已发布",
            "Maple Classic Exp Overlay is already running.": "Maple Classic Exp Overlay 已在运行。",
        }
        for en, zh in cases.items():
            self.assertEqual(self.tr.translate(en), zh, f"Failed for {en!r}")

    def test_multiline_and_composed_messages(self):
        multi = "Henesys Hunting Ground I\nNot logging this run."
        self.assertEqual(self.tr.translate(multi), "Henesys Hunting Ground I\n本次不记录。")

        composed = (
            "Tracking. Estimated from the % (the bar shows no number; "
            "your level was read from the badge)."
        )
        self.assertIn("由 % 估算得出", self.tr.translate(composed))

    def test_game_names_and_numbers_untouched(self):
        for keep in ("Henesys Hunting Ground I", "Warrior", "Cleric", "12,345", "12.34%", "—", ""):
            self.assertEqual(self.tr.translate(keep), keep)

    def test_toggle_language(self):
        tr = ui_hook.Translator(self.raw, enabled=True)
        self.assertEqual(tr.translate("Start"), "开始")
        tr.toggle()
        self.assertFalse(tr.enabled)
        self.assertEqual(tr.translate("Start"), "Start")
        tr.toggle()
        self.assertTrue(tr.enabled)
        self.assertEqual(tr.translate("Start"), "开始")

    def test_built_exe_extract_dict(self):
        exe = ROOT / "dist" / "mapleexp-hans-windows-amd64.exe"
        if not exe.is_file():
            self.skipTest("dist executable not built yet")
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "extracted.json"
            proc = subprocess.run(
                [str(exe), "--nogui", "--extract-dict", str(out)],
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(out.is_file())
            extracted = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(extracted["exact"], self.raw["exact"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
