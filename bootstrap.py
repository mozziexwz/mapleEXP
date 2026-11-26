"""Read-only PyInstaller archive loader & bootstrap for mapleexp-hans.

Runs inside the official client's own _internal/python3xx.dll without modifying
a single byte of the official client folder. Mounts the official .exe's
embedded PYZ archive onto sys.meta_path, activates the pure-UI localization
hook, and executes the official maple_exp entrypoint.
"""
import _frozen_importlib
import _struct as struct
import marshal
import os
import sys
import types
import zlib

_PYI_MAGIC = b"MEI\014\013\012\013\016"


def _log(msg):
    log_path = os.environ.get("MAPLEEXP_HANS_LOG")
    if log_path:
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
        except Exception:
            pass


def _parse_carchive(exe_path):
    with open(exe_path, "rb") as f:
        data = f.read()
    idx = data.rfind(_PYI_MAGIC)
    if idx < 0:
        raise RuntimeError(f"Not a PyInstaller executable (cookie not found): {exe_path}")
    cookie_len = len(data) - idx
    if cookie_len >= 88:
        _m, pkg_len, toc_off, toc_len, pyver, pylib = struct.unpack("!8sIIII64s", data[idx:idx + 88])
    else:
        _m, pkg_len, toc_off, toc_len, pyver = struct.unpack("!8sIIII", data[idx:idx + 24])
        pylib = b""
    pkg_start = idx + cookie_len - pkg_len
    entries = {}
    pos = pkg_start + toc_off
    end = pos + toc_len
    while pos < end:
        elen, dpos, dlen, ulen, cflag, tcode = struct.unpack("!IIIIBB", data[pos:pos + 18])
        name = data[pos + 18:pos + elen].rstrip(b"\0").decode("utf-8", "replace")
        entries[name] = (chr(tcode), dpos, dlen, ulen, cflag)
        pos += elen
    return data, pkg_start, entries, pyver, pylib.rstrip(b"\0").decode("utf-8", "replace")


def _extract_entry(data, pkg_start, entry):
    _tcode, dpos, dlen, _ulen, cflag = entry
    raw = data[pkg_start + dpos:pkg_start + dpos + dlen]
    if cflag:
        raw = zlib.decompress(raw)
    return raw


class _PyiReadOnlyFinder:
    """Loads pure-Python modules directly from the official .exe's PYZ in memory."""

    def __init__(self, data, pkg_start, entries, pyz_data, pyz_toc, internal_dir, post_import=None):
        self.data = data
        self.pkg_start = pkg_start
        self.entries = entries
        self.pyz_data = pyz_data
        self.pyz_toc = pyz_toc
        self.internal_dir = internal_dir
        self.post_import = post_import

    def find_spec(self, fullname, path, target=None):
        if fullname in self.pyz_toc:
            ispkg = bool(self.pyz_toc[fullname][0])
            spec = _frozen_importlib.ModuleSpec(fullname, self, is_package=ispkg)
            if ispkg:
                pkg_dir = os.path.join(self.internal_dir, *fullname.split("."))
                spec.submodule_search_locations = [pkg_dir] if os.path.isdir(pkg_dir) else []
            return spec
        entry = self.entries.get(fullname)
        if entry and entry[0] in ("m", "M"):
            ispkg = (entry[0] == "M")
            spec = _frozen_importlib.ModuleSpec(fullname, self, is_package=ispkg)
            if ispkg:
                spec.submodule_search_locations = []
            return spec
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        name = module.__name__
        if name in self.pyz_toc:
            ispkg, pos, length = self.pyz_toc[name]
            code = marshal.loads(zlib.decompress(self.pyz_data[pos:pos + length]))
            ispkg = bool(ispkg)
        else:
            entry = self.entries[name]
            ispkg = (entry[0] == "M")
            code = marshal.loads(_extract_entry(self.data, self.pkg_start, entry))
        rel = os.path.join(*name.split("."))
        module.__file__ = os.path.join(self.internal_dir, rel + (os.sep + "__init__.pyc" if ispkg else ".pyc"))
        if ispkg:
            pkg_dir = os.path.join(self.internal_dir, rel)
            module.__path__ = [pkg_dir] if os.path.isdir(pkg_dir) else []
            module.__package__ = name
        else:
            module.__package__ = name.rpartition(".")[0]
        exec(code, module.__dict__)
        if self.post_import is not None:
            self.post_import(module)


def _setup_tcl_tk(internal_dir):
    for cand in ("_tcl_data", "tcl", os.path.join("tcl", "tcl8.6")):
        p = os.path.join(internal_dir, cand)
        if os.path.isdir(p) and os.path.isfile(os.path.join(p, "init.tcl")):
            os.environ["TCL_LIBRARY"] = p
            break
    for cand in ("_tk_data", "tk", os.path.join("tk", "tk8.6")):
        p = os.path.join(internal_dir, cand)
        if os.path.isdir(p) and os.path.isfile(os.path.join(p, "tk.tcl")):
            os.environ["TK_LIBRARY"] = p
            break


def main():
    exe_path = os.environ["MAPLEEXP_HANS_EXE"]
    internal_dir = os.environ["MAPLEEXP_HANS_INTERNAL"]
    lang = os.environ.get("MAPLEEXP_HANS_LANG", "zh")
    check_only = os.environ.get("MAPLEEXP_HANS_CHECK") == "1"

    _log(f"[hans] exe={exe_path} internal={internal_dir} lang={lang}")

    # Mirror PyInstaller frozen environment
    sys.frozen = True
    sys._MEIPASS = internal_dir
    sys.executable = exe_path
    if not sys.argv:
        sys.argv = [exe_path]
    else:
        sys.argv[0] = exe_path
    if internal_dir not in sys.path:
        sys.path.insert(0, internal_dir)
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(internal_dir)
        except Exception:
            pass
    _setup_tcl_tk(internal_dir)

    # Parse official .exe CArchive read-only
    data, pkg_start, entries, pyver, pylib = _parse_carchive(exe_path)
    pyz_name = next((k for k, v in entries.items() if v[0] == "z"), None)
    if not pyz_name:
        raise RuntimeError("PYZ archive not found inside official executable")
    pyz_data = _extract_entry(data, pkg_start, entries[pyz_name])
    toc_pos = struct.unpack("!i", pyz_data[8:12])[0]
    pyz_toc = dict(marshal.loads(pyz_data[toc_pos:]))

    # Load ui_hook module (embedded by launcher or local file)
    ui_hook_mod = types.ModuleType("_mapleexp_hans_ui_hook")
    hook_src = globals().get("_HANS_UI_HOOK_SRC")
    if hook_src is None:
        hook_path = os.environ.get("MAPLEEXP_HANS_HOOK_PATH")
        with open(hook_path, "r", encoding="utf-8") as f:
            hook_src = f.read()

    finder = _PyiReadOnlyFinder(
        data, pkg_start, entries, pyz_data, pyz_toc, internal_dir,
        post_import=lambda m: ui_hook_mod.patch_module(m) if hasattr(ui_hook_mod, "patch_module") else None,
    )
    # Insert right before PathFinder so PYZ packages (PIL, numpy, etc.) win over
    # namespace-looking _internal directories while .pyd C-extensions fall through.
    insert_at = len(sys.meta_path)
    for i, mp in enumerate(sys.meta_path):
        if getattr(mp, "__name__", "") == "PathFinder":
            insert_at = i
            break
    sys.meta_path.insert(insert_at, finder)

    # Now stdlib (json, re, tkinter, etc.) is fully importable from official PYZ
    exec(compile(hook_src, "_mapleexp_hans_ui_hook.py", "exec"), ui_hook_mod.__dict__)

    dict_path = os.environ.get("MAPLEEXP_HANS_DICT_PATH")
    if dict_path and os.path.isfile(dict_path):
        with open(dict_path, "r", encoding="utf-8") as f:
            dict_src = f.read()
        _log(f"[hans] loaded external dict: {dict_path}")
    else:
        dict_src = globals().get("_HANS_DICT_JSON")
        if dict_src is None:
            raise RuntimeError("No zh-CN.json dictionary provided")
        _log("[hans] loaded embedded dict")

    tr = ui_hook_mod.install(dict_src, lang=lang, log_fn=_log)

    # Locate official entrypoint script ('s' entry that isn't a PyInstaller bootstrap/rthook)
    entry_script = next(
        (k for k, v in entries.items() if v[0] == "s" and not k.startswith(("pyiboot", "pyi_rth"))),
        None,
    )
    if not entry_script:
        raise RuntimeError("Entry script not found inside official executable")

    if check_only:
        import ui_gfx
        import ui_main
        assert getattr(ui_gfx.Gfx, "_hans_patched", False), "ui_gfx not patched"
        assert getattr(ui_main.PopupMenu, "_hans_patched", False), "ui_main not patched"
        assert tr.translate("Start") == "开始"
        assert tr.translate("EXP PER HOUR") == "每小时经验"
        assert tr.translate("Tracking · Lv 42") == "追踪中 · Lv 42"
        assert tr.translate("Lv 43 in 1h 23m") == "距 Lv 43 还需 1时23分"
        assert tr.translate("Henesys Hunting Ground I") == "Henesys Hunting Ground I"
        msg = (
            f"OK: target={exe_path} pyver={pyver} pylib={pylib} "
            f"entry={entry_script} exact={len(tr.exact)} patterns={len(tr.patterns)}"
        )
        _log(msg)
        print(msg)
        return

    # Execute the official unmodified main script in __main__
    main_code = marshal.loads(_extract_entry(data, pkg_start, entries[entry_script]))
    main_mod = sys.modules["__main__"]
    main_mod.__file__ = os.path.join(internal_dir, entry_script + ".py")
    main_mod.__package__ = None
    exec(main_code, main_mod.__dict__)


try:
    main()
except SystemExit:
    raise
except Exception:
    import traceback
    tb = traceback.format_exc()
    _log("[hans] UNHANDLED EXCEPTION:\n" + tb)
    raise

