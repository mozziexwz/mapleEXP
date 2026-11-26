using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace MapleExpHans {
    static class Program {
        private const string OFFICIAL_EXE_NAME = "Maple Classic Exp Overlay.exe";
        private const uint LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;
        private const uint ATTACH_PARENT_PROCESS = 0xFFFFFFFF;
        private static readonly byte[] PYI_MAGIC = new byte[] {
            (byte)'M', (byte)'E', (byte)'I', 12, 11, 10, 11, 14
        };

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectoryW(string lpPathName);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryExW(string lpFileName, IntPtr hFile, uint dwFlags);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        private static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(uint dwProcessId);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        private delegate void Py_SetProgramName_t(string name);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        private delegate void Py_SetPath_t(string path);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void Py_InitializeEx_t(int initsigs);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int PyRun_SimpleString_t(byte[] command);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int Py_FinalizeEx_t();

        private static bool _noGui = false;
        private static string _logPath = null;

        private static void Log(string msg) {
            if (!string.IsNullOrEmpty(_logPath)) {
                try {
                    File.AppendAllText(_logPath, msg + Environment.NewLine, Encoding.UTF8);
                } catch { }
            }
        }

        private static void ReportInfo(string msg) {
            Log(msg);
            if (_noGui) {
                Console.WriteLine(msg);
            } else {
                MessageBox.Show(msg, "MapleEXP Hans", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static void ReportError(string msg) {
            Log("ERROR: " + msg);
            if (_noGui) {
                Console.Error.WriteLine(msg);
            } else {
                MessageBox.Show(msg, "MapleEXP Hans", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string ReadEmbeddedResource(string resourceName) {
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream(resourceName)) {
                if (s == null) {
                    throw new FileNotFoundException("Embedded resource missing: " + resourceName);
                }
                using (StreamReader sr = new StreamReader(s, Encoding.UTF8)) {
                    return sr.ReadToEnd();
                }
            }
        }

        private static string GetConfigPath() {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "MapleEXP", "hans_target.txt");
        }

        private static string LoadSavedTarget() {
            try {
                string cfg = GetConfigPath();
                if (File.Exists(cfg)) {
                    string p = File.ReadAllText(cfg, Encoding.UTF8).Trim();
                    if (!string.IsNullOrEmpty(p)) return p;
                }
            } catch { }
            return null;
        }

        private static void SaveTarget(string dir) {
            try {
                string cfg = GetConfigPath();
                Directory.CreateDirectory(Path.GetDirectoryName(cfg));
                File.WriteAllText(cfg, dir, Encoding.UTF8);
            } catch { }
        }

        private static string NormalizeExePath(string candidate) {
            if (string.IsNullOrEmpty(candidate)) return null;
            candidate = candidate.Trim().Trim('"');
            try {
                candidate = Path.GetFullPath(candidate);
            } catch {
                return null;
            }
            if (File.Exists(candidate) && candidate.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                return candidate;
            }
            if (Directory.Exists(candidate)) {
                string direct = Path.Combine(candidate, OFFICIAL_EXE_NAME);
                if (File.Exists(direct)) return direct;
                string nested = Path.Combine(candidate, "Maple Classic Exp Overlay", OFFICIAL_EXE_NAME);
                if (File.Exists(nested)) return nested;
            }
            return null;
        }

        private static string FindOfficialExe(string explicitTarget) {
            string p = NormalizeExePath(explicitTarget);
            if (p != null) return p;

            string selfDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? Environment.CurrentDirectory;
            string[] candidates = new string[] {
                selfDir,
                Path.Combine(selfDir, "Maple Classic Exp Overlay"),
                Environment.CurrentDirectory,
                Path.Combine(Environment.CurrentDirectory, "Maple Classic Exp Overlay"),
                Path.GetDirectoryName(selfDir) ?? "",
                LoadSavedTarget()
            };
            foreach (string c in candidates) {
                p = NormalizeExePath(c);
                if (p != null) return p;
            }
            return null;
        }

        private static int LastIndexOfBytes(byte[] haystack, byte[] needle) {
            int limit = haystack.Length - needle.Length;
            for (int i = limit; i >= 0; i--) {
                bool match = true;
                for (int j = 0; j < needle.Length; j++) {
                    if (haystack[i + j] != needle[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) return i;
            }
            return -1;
        }

        private static uint ReadUInt32BE(byte[] b, int off) {
            return ((uint)b[off] << 24) | ((uint)b[off + 1] << 16) | ((uint)b[off + 2] << 8) | b[off + 3];
        }

        private static void InspectPyInstallerExe(string exePath, out string pyLibName, out string contentsDirName) {
            pyLibName = null;
            contentsDirName = "_internal";
            byte[] data = File.ReadAllBytes(exePath);
            int idx = LastIndexOfBytes(data, PYI_MAGIC);
            if (idx < 0) {
                throw new InvalidOperationException("目标文件不是有效的 PyInstaller 可执行文件: " + exePath);
            }
            int cookieLen = data.Length - idx;
            uint pkgLen = ReadUInt32BE(data, idx + 8);
            uint tocOff = ReadUInt32BE(data, idx + 12);
            uint tocLen = ReadUInt32BE(data, idx + 16);
            if (cookieLen >= 88) {
                int len = 0;
                while (len < 64 && data[idx + 24 + len] != 0) len++;
                pyLibName = Encoding.UTF8.GetString(data, idx + 24, len);
            }
            long pkgStart = (long)idx + cookieLen - pkgLen;
            long pos = pkgStart + tocOff;
            long end = pos + tocLen;
            while (pos + 18 <= end) {
                uint elen = ReadUInt32BE(data, (int)pos);
                byte tcode = data[pos + 17];
                if (tcode == (byte)'o') {
                    int nameLen = (int)elen - 18;
                    string opt = Encoding.UTF8.GetString(data, (int)pos + 18, nameLen).TrimEnd('\0');
                    const string prefix = "pyi-contents-directory ";
                    if (opt.StartsWith(prefix, StringComparison.Ordinal)) {
                        contentsDirName = opt.Substring(prefix.Length).Trim();
                    }
                }
                if (elen == 0) break;
                pos += elen;
            }
        }

        private static string FindPythonDll(string internalDir, string pyLibName) {
            if (!string.IsNullOrEmpty(pyLibName)) {
                string direct = Path.Combine(internalDir, pyLibName);
                if (File.Exists(direct)) return direct;
            }
            foreach (string f in Directory.GetFiles(internalDir, "python3*.dll")) {
                string name = Path.GetFileName(f);
                if (!name.Equals("python3.dll", StringComparison.OrdinalIgnoreCase)) {
                    return f;
                }
            }
            return null;
        }

        private static string UsageText() {
            return
                "MapleEXP Hans — Maple Classic Exp Overlay 零修改外部汉化启动器\n\n" +
                "用法:\n" +
                "  mapleexp-hans.exe [选项] [官方目录或.exe路径]\n\n" +
                "选项:\n" +
                "  --app [路径]          启动并汉化官方客户端（可省略路径以自动查找）\n" +
                "  --nogui               静默模式（不弹错误框/目录选择框，适合命令行调用）\n" +
                "  --lang zh|en          启动语言（默认 zh，可在悬浮窗「…」菜单实时切换）\n" +
                "  --dict <文件>         指定外部词典 JSON（默认优先加载同目录 zh-CN.json）\n" +
                "  --extract-dict [文件] 导出内置 zh-CN.json 词典到磁盘以便自定义\n" +
                "  --check               仅校验官方客户端、Python DLL 与汉化钩子，不启动窗口\n" +
                "  --log <文件>          输出诊断日志到指定文件\n" +
                "  -h, --help            显示此帮助信息\n\n" +
                "示例:\n" +
                "  mapleexp-hans.exe --app --nogui\n" +
                "  mapleexp-hans.exe --app \"C:\\Games\\Maple Classic Exp Overlay\" --nogui\n";
        }

        [STAThread]
        static int Main(string[] args) {
            string targetArg = null;
            string dictArg = null;
            string lang = "zh";
            string extractDictOut = null;
            bool checkOnly = false;
            bool showHelp = false;

            for (int i = 0; i < args.Length; i++) {
                string a = args[i];
                if (a == "--nogui") {
                    _noGui = true;
                } else if (a == "--check") {
                    checkOnly = true;
                    _noGui = true;
                } else if (a == "-h" || a == "--help") {
                    showHelp = true;
                    _noGui = true;
                } else if (a == "--app" || a == "--dir" || a == "--target") {
                    if (i + 1 < args.Length && !args[i + 1].StartsWith("-")) {
                        targetArg = args[++i];
                    }
                } else if (a.StartsWith("--app=") || a.StartsWith("--dir=") || a.StartsWith("--target=")) {
                    targetArg = a.Substring(a.IndexOf('=') + 1);
                } else if (a == "--lang" && i + 1 < args.Length) {
                    lang = args[++i].Trim().ToLowerInvariant();
                } else if (a.StartsWith("--lang=")) {
                    lang = a.Substring(7).Trim().ToLowerInvariant();
                } else if (a == "--dict" && i + 1 < args.Length) {
                    dictArg = args[++i];
                } else if (a.StartsWith("--dict=")) {
                    dictArg = a.Substring(7);
                } else if (a == "--log" && i + 1 < args.Length) {
                    _logPath = args[++i];
                } else if (a.StartsWith("--log=")) {
                    _logPath = a.Substring(6);
                } else if (a == "--extract-dict") {
                    if (i + 1 < args.Length && !args[i + 1].StartsWith("-")) {
                        extractDictOut = args[++i];
                    } else {
                        extractDictOut = "zh-CN.json";
                    }
                } else if (!a.StartsWith("-") && targetArg == null) {
                    targetArg = a;
                }
            }

            if (_noGui || showHelp || checkOnly || extractDictOut != null) {
                AttachConsole(ATTACH_PARENT_PROCESS);
            }

            if (showHelp) {
                Console.WriteLine(UsageText());
                return 0;
            }

            if (extractDictOut != null) {
                try {
                    string dictJson = ReadEmbeddedResource("zh-CN.json");
                    string fullOut = Path.GetFullPath(extractDictOut);
                    File.WriteAllText(fullOut, dictJson, new UTF8Encoding(false));
                    ReportInfo("已导出词典到: " + fullOut);
                    return 0;
                } catch (Exception ex) {
                    ReportError("导出词典失败: " + ex.Message);
                    return 1;
                }
            }

            try {
                string officialExe = FindOfficialExe(targetArg);
                if (officialExe == null && !_noGui) {
                    using (var dlg = new FolderBrowserDialog()) {
                        dlg.Description = "请选择官方原版 Maple Classic Exp Overlay 所在文件夹";
                        if (dlg.ShowDialog() == DialogResult.OK) {
                            officialExe = NormalizeExePath(dlg.SelectedPath);
                        }
                    }
                }
                if (officialExe == null) {
                    ReportError(
                        "未找到官方原版 \"" + OFFICIAL_EXE_NAME + "\"。\n" +
                        "请将 mapleexp-hans.exe 放在官方目录旁边，或通过 --app \"官方目录路径\" 指定。"
                    );
                    return 2;
                }

                string officialDir = Path.GetDirectoryName(officialExe);
                SaveTarget(officialDir);

                string pyLibName, contentsDirName;
                InspectPyInstallerExe(officialExe, out pyLibName, out contentsDirName);
                string internalDir = string.IsNullOrEmpty(contentsDirName) || contentsDirName == "."
                    ? officialDir
                    : Path.Combine(officialDir, contentsDirName);
                if (!Directory.Exists(internalDir)) {
                    internalDir = officialDir;
                }

                string pythonDllPath = FindPythonDll(internalDir, pyLibName);
                if (pythonDllPath == null) {
                    ReportError("未在官方目录中找到 Python 运行时 DLL: " + internalDir);
                    return 3;
                }

                // Resolve optional external zh-CN.json next to mapleexp-hans.exe
                string selfDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? Environment.CurrentDirectory;
                string externalDict = null;
                if (!string.IsNullOrEmpty(dictArg)) {
                    externalDict = Path.GetFullPath(dictArg);
                    if (!File.Exists(externalDict)) {
                        ReportError("指定的词典文件不存在: " + externalDict);
                        return 4;
                    }
                } else {
                    string sideBySide = Path.Combine(selfDir, "zh-CN.json");
                    if (File.Exists(sideBySide)) {
                        externalDict = sideBySide;
                    }
                }

                Log("[launcher] officialExe=" + officialExe);
                Log("[launcher] internalDir=" + internalDir);
                Log("[launcher] pythonDll=" + pythonDllPath);

                // Configure DLL search path and environment for in-process CPython hosting
                SetDllDirectoryW(internalDir);
                Environment.SetEnvironmentVariable("PATH", internalDir + ";" + Environment.GetEnvironmentVariable("PATH"));
                Environment.SetEnvironmentVariable("MAPLEEXP_HANS_EXE", officialExe);
                Environment.SetEnvironmentVariable("MAPLEEXP_HANS_INTERNAL", internalDir);
                Environment.SetEnvironmentVariable("MAPLEEXP_HANS_LANG", lang == "en" ? "en" : "zh");
                Environment.SetEnvironmentVariable("MAPLEEXP_HANS_CHECK", checkOnly ? "1" : "0");
                if (!string.IsNullOrEmpty(externalDict)) {
                    Environment.SetEnvironmentVariable("MAPLEEXP_HANS_DICT_PATH", externalDict);
                } else {
                    Environment.SetEnvironmentVariable("MAPLEEXP_HANS_DICT_PATH", null);
                }
                if (!string.IsNullOrEmpty(_logPath)) {
                    Environment.SetEnvironmentVariable("MAPLEEXP_HANS_LOG", Path.GetFullPath(_logPath));
                }

                IntPtr hPy = LoadLibraryExW(pythonDllPath, IntPtr.Zero, LOAD_WITH_ALTERED_SEARCH_PATH);
                if (hPy == IntPtr.Zero) {
                    ReportError("加载官方 Python DLL 失败 (Win32=" + Marshal.GetLastWin32Error() + "): " + pythonDllPath);
                    return 5;
                }

                var setProg = Marshal.GetDelegateForFunctionPointer<Py_SetProgramName_t>(GetProcAddress(hPy, "Py_SetProgramName"));
                var setPath = Marshal.GetDelegateForFunctionPointer<Py_SetPath_t>(GetProcAddress(hPy, "Py_SetPath"));
                var initEx = Marshal.GetDelegateForFunctionPointer<Py_InitializeEx_t>(GetProcAddress(hPy, "Py_InitializeEx"));
                var runStr = Marshal.GetDelegateForFunctionPointer<PyRun_SimpleString_t>(GetProcAddress(hPy, "PyRun_SimpleString"));
                var finalize = Marshal.GetDelegateForFunctionPointer<Py_FinalizeEx_t>(GetProcAddress(hPy, "Py_FinalizeEx"));

                IntPtr pNoSite = GetProcAddress(hPy, "Py_NoSiteFlag");
                if (pNoSite != IntPtr.Zero) Marshal.WriteInt32(pNoSite, 1);
                IntPtr pNoBytecode = GetProcAddress(hPy, "Py_DontWriteBytecodeFlag");
                if (pNoBytecode != IntPtr.Zero) Marshal.WriteInt32(pNoBytecode, 1);
                IntPtr pIgnoreEnv = GetProcAddress(hPy, "Py_IgnoreEnvironmentFlag");
                if (pIgnoreEnv != IntPtr.Zero) Marshal.WriteInt32(pIgnoreEnv, 1);
                IntPtr pUtf8 = GetProcAddress(hPy, "Py_UTF8Mode");
                if (pUtf8 != IntPtr.Zero) Marshal.WriteInt32(pUtf8, 1);

                setProg(officialExe);
                string baseZip = Path.Combine(internalDir, "base_library.zip");
                setPath(File.Exists(baseZip) ? (baseZip + ";" + internalDir) : internalDir);
                initEx(0);

                string bootstrapSrc = ReadEmbeddedResource("bootstrap.py");
                string uiHookSrc = ReadEmbeddedResource("ui_hook.py");
                string dictJson = string.IsNullOrEmpty(externalDict) ? ReadEmbeddedResource("zh-CN.json") : "";

                // Pass embedded sources cleanly via base64 (decoded inside bootstrap with zero temp files)
                string hookB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(uiHookSrc));
                string dictB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(dictJson));
                string bootB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(bootstrapSrc));

                StringBuilder sb = new StringBuilder();
                sb.AppendLine("import binascii as _b");
                sb.Append("_HANS_UI_HOOK_SRC = _b.a2b_base64('").Append(hookB64).AppendLine("').decode('utf-8')");
                if (!string.IsNullOrEmpty(dictB64)) {
                    sb.Append("_HANS_DICT_JSON = _b.a2b_base64('").Append(dictB64).AppendLine("').decode('utf-8')");
                }
                sb.AppendLine("exec(compile(_b.a2b_base64('" + bootB64 + "').decode('utf-8'), '<hans_bootstrap>', 'exec'))");

                byte[] cmdBytes = Encoding.UTF8.GetBytes(sb.ToString() + "\0");
                int rc = runStr(cmdBytes);
                finalize();
                return rc;
            } catch (Exception ex) {
                ReportError("启动失败: " + ex.Message + "\n" + ex.StackTrace);
                return 1;
            }
        }
    }
}
