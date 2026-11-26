# MapleEXP Hans — Maple Classic Exp Overlay 零修改外部汉化启动器

受 [Antigravity-Hans](https://github.com/yuexps/Antigravity-Hans) 启发，本项目为 [beanguri/Maple-Classic-Exp-Overlay](https://github.com/beanguri/Maple-Classic-Exp-Overlay) 提供**零修改客户端**的外部汉化方案：一条命令直接启动官方原版程序，实时将整个界面汉化为简体中文。

**[下载最新版本](../../releases/latest)**

## 核心特点

- **官方客户端零修改**：官方原版 `Maple Classic Exp Overlay.exe` 与 `_internal/` 保持 100% 原始状态，原版发布新版本后直接覆盖官方目录即可继续汉化。
- **零跨进程注入**：不对其他进程注入 DLL 或读写内存，而是在自身进程内复用官方目录自带的 `python3xx.dll` 并以只读方式加载原版字节码，安全可靠。
- **纯界面汉化**：仅在 Tkinter / Pillow 渲染层拦截显示文案并自动切换中文字体（微软雅黑等），不改动任何 OCR、游戏画面识别、地图名/职业名、配置或日志格式。
- **单文件极小体积**：仅约 **100 KB**，内置引导脚本与完整 `zh-CN.json` 词典，用户电脑无需安装 Python。
- **实时中英切换**：在悬浮窗右下角 **`…`（更多）** 菜单中点击 **「切换为 English / 切换为 简体中文」** 即可即时切换，无需重启。

## 使用方法

1. 从 [官方仓库](https://github.com/beanguri/Maple-Classic-Exp-Overlay/releases/latest) 下载并解压原版 `Maple Classic Exp Overlay`。
2. 从本仓库 [Releases](../../releases/latest) 下载 `mapleexp-hans-windows-amd64.exe`，放在官方 `Maple Classic Exp Overlay` 文件夹旁边（或任意目录）。
3. 双击运行，或通过命令行 / 快捷方式启动：

```powershell
# 自动查找同级目录中的官方客户端并静默启动（无黑框）
.\mapleexp-hans-windows-amd64.exe --app --nogui

# 指定官方原版目录路径
.\mapleexp-hans-windows-amd64.exe --app "C:\Games\Maple Classic Exp Overlay" --nogui

# 也兼容 conhost 无头写法
C:\Windows\System32\conhost.exe --headless "C:\path\to\mapleexp-hans-windows-amd64.exe" --app --nogui
```

### 命令行参数

| 参数 | 说明 |
|---|---|
| `--app [路径]` | 启动并汉化官方客户端；省略路径时自动查找同级目录或上次记住的路径 |
| `--nogui` | 静默模式（不弹目录选择框或错误弹窗，适合命令行与快捷方式调用） |
| `--lang zh\|en` | 指定启动语言（默认 `zh`） |
| `--dict <文件>` | 指定外部词典 JSON（若 `.exe` 同目录存在 `zh-CN.json` 会自动优先加载） |
| `--extract-dict [文件]` | 导出内置 `zh-CN.json` 到磁盘，方便自定义或补充新版本词条 |
| `--check` | 仅校验官方客户端、Python DLL 与汉化钩子是否正常，不打开界面 |
| `--log <文件>` | 输出诊断日志到指定文件 |
| `-h, --help` | 显示帮助信息 |

## 自定义或更新词典（无需重新编译）

如果官方新版增加了少量英文文案，无需等待或重新编译：

1. 导出内置词典：
   ```powershell
   .\mapleexp-hans-windows-amd64.exe --extract-dict zh-CN.json
   ```
2. 编辑与 `.exe` 同目录的 `zh-CN.json`，在 `exact`（精确匹配）或 `patterns`（正则模板）中补充词条；
3. 下次启动时会自动优先加载外部 `zh-CN.json`。

## 从源码构建

仅需 Windows 10/11 自带的 .NET Framework 编译器（`csc.exe`）与 Python 3：

```powershell
python build.py
python test_hans.py
```

编译产物位于 `dist/mapleexp-hans-windows-amd64.exe`（并同步复制一份 `mapleexp-hans.exe` 到项目根目录）。

## 致谢与许可

- 目标客户端：[beanguri/Maple-Classic-Exp-Overlay](https://github.com/beanguri/Maple-Classic-Exp-Overlay)（MIT）
- 灵感来源：[yuexps/Antigravity-Hans](https://github.com/yuexps/Antigravity-Hans)
- 许可证：[MIT](LICENSE)
