"""Builds standalone mapleexp-hans-windows-amd64.exe using Windows built-in csc.exe.

Produces a tiny (~100 KB) single-file Windows GUI executable with bootstrap.py,
ui_hook.py, and zh-CN.json embedded as resources. Zero external dependencies,
no Python required on the end user's PC, and zero modifications to the official
Maple Classic Exp Overlay folder.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
CSC = pathlib.Path(r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe")
ASSET_NAME = "mapleexp-hans-windows-amd64.exe"


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if not CSC.is_file():
        sys.exit(f"csc.exe not found at {CSC}")

    dict_path = ROOT / "zh-CN.json"
    data = json.loads(dict_path.read_text(encoding="utf-8"))
    print(f"Validated {dict_path.name}: {len(data['exact'])} exact, {len(data['patterns'])} patterns")

    dist_dir = ROOT / "dist"
    dist_dir.mkdir(exist_ok=True)
    out_exe = dist_dir / ASSET_NAME
    icon = ROOT / "assets" / "icon.ico"

    cmd = [
        str(CSC),
        "/nologo",
        "/platform:x64",
        "/target:winexe",
        "/optimize+",
        "/utf8output",
        "/r:System.Windows.Forms.dll",
        f"/resource:{ROOT / 'bootstrap.py'},bootstrap.py",
        f"/resource:{ROOT / 'ui_hook.py'},ui_hook.py",
        f"/resource:{dict_path},zh-CN.json",
        f"/out:{out_exe}",
    ]
    if icon.is_file():
        cmd.append(f"/win32icon:{icon}")
    cmd.append(str(ROOT / "launcher.cs"))

    print(f"Compiling {ASSET_NAME} ...")
    subprocess.run(cmd, check=True)

    # Copy dictionary and SHA256SUMS into dist/ for GitHub Releases
    dist_dict = dist_dir / "zh-CN.json"
    shutil.copy2(dict_path, dist_dict)
    sums = [
        f"{sha256_file(out_exe)}  {out_exe.name}",
        f"{sha256_file(dist_dict)}  {dist_dict.name}",
    ]
    (dist_dir / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="utf-8")

    # Also place a ready-to-run copy in project root
    root_exe = ROOT / "mapleexp-hans.exe"
    shutil.copy2(out_exe, root_exe)

    size_kb = out_exe.stat().st_size / 1024
    print(f"Done: {out_exe} ({size_kb:.1f} KB)")
    print(f"Local copy: {root_exe}")


if __name__ == "__main__":
    main()
