# 开发者文档

**从源码运行。** 需要 Python 3.10 或更新版本，以及用于读取地图名的 [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki)。

```
py -3 -m pip install -r requirements.txt
run.bat
```

**在 macOS 上从源码运行：** `brew install tesseract`，然后 `python3 -m pip install -r requirements.txt` 和 `python3 maple_exp.py`。请在“屏幕录制”中允许你的终端（或 Python），而不是该应用。

Windows 和 macOS 之间所有不同的部分（查找游戏窗口、屏幕缩放、快捷键、同一时间只运行一份的锁）都在 `platforms/` 里：`base.py` 中有一个 `Platform` 接口，每个系统一个实现，由 `create_platform()` 选择当前系统对应的那个。

**构建下载包**（会在 `release/` 中生成 `Maple-Classic-Exp-Overlay-v<version>.zip`，并在项目文件夹中生成一份可直接使用的副本：`Maple Classic Exp Overlay.exe` 及其 `_internal` 文件夹）：

```
py -3 -m pip install -r requirements.txt pyinstaller
py -3 build.py
```

**Mac 版下载包**由 `build_macos.py` 在 Mac 上构建（Apple Silicon 或 Intel，针对你运行的那台 Mac）；用法在该文件开头。`check_macos.py` 用于检查构建结果。

**测试绝不会分享任何东西：** 当设置了 `MAPLE_EXP_DATA` 时（它会移动数据文件夹，测试正是借此避开你真实的日志），悬浮窗会拒绝向真实网站发送记录，所以编造的测试记录不可能到达那里。（只有在针对本地的服务器副本做测试时，才设置 `MAPLE_EXP_ALLOW_SHARE=1`。）

**运行测试：**

```
py -3 tests/test_logic.py
py -3 tests/test_screen.py
py -3 tests/test_ui.py     # 会打开真实窗口几秒钟（备注框）
```

要使用与发布版完全相同的软件包来构建：`py -3 -m pip install --require-hashes -r requirements-build.txt`。

GitHub 会在每次推送时运行逻辑测试（[Tests 工作流](../.github/workflows/tests.yml)）。[Build 工作流](../.github/workflows/build.yml)会在 GitHub 上构建下载包（Actions 标签页，**Build**，**Run workflow**），先运行全部测试，并在设置好代码签名后对 .exe 签名。推送版本标签时还会为压缩包生成证明，并用它起草发布；发布只会以这种方式进行。

**统计网站**在 `server/` 中：一个带有 D1 数据库的 Cloudflare Pages 站点（免费套餐）。页面是 `server/public/`，API 是 `server/src/index.js`。`npm --prefix server install`，然后 `npm --prefix server run dev` 在本地运行，`py -3 server/test_server.py http://localhost:8787` 进行测试，`npm --prefix server run deploy` 上线。

**它如何读取屏幕：**
- 它先找到 `MapleStory.exe` 的窗口，然后在状态栏中找到经验数字（形如 `12,345 [12.34%]`）。
- 每个数字都会被缩放到标准大小，并与 `assets/` 中保存的游戏字体样本对比。
- 只有当经验和百分比与该等级所需的经验吻合时，一次读取才会被计入，所以读错的会被忽略。
- 金币以同样的方式读取。金币框是通过它的轮廓找到的，即使背包是半透明的也能工作。
- 药水数量、你的等级（橙色的 **LV** 徽章）和经验数字，是用游戏自己的字体读取的，字体绘制自 `assets/fonts_v2/`；队伍人数则通过队伍列表血条的精确形状来读取（`assets/party_shapes.json`）。旧的经验读取器和队伍计数仍作为备用。金币仍按旧方式读取；较新的金币读取器运行在只做对比的测试模式下，绝不会改变你看到的数字；每日运行状况报告会统计这些读取器吻合的频率。
- 队伍人数就是队伍列表中血条的数量。
- 地图名使用 Tesseract 读取。
- 设置、日志和 `errors.log` 保存在 `%APPDATA%\MapleEXP`（macOS 上是 `~/Library/Application Support/MapleEXP`；沿用它的旧名称 Maple EXP/hr，这样更新后数据仍然保留）。

## 复刻或修改这份代码

[MIT](../LICENSE) 允许你修改和分享这份代码。有一个请求：**修改过的副本不得向 mcwo.app 发送任何东西。** 该网站只接受来自官方发布版的分享记录、每日运行状况报告和错误报告，所以会拒绝它不认识的版本。来自修改版的数字只会给“最佳地图”和运行状况数字增加噪声。

中文版已经遵循这一点：`maple_exp.py` 中的 `SEND_TO_STATS_SITE = False` 关闭了 `post_runs`、`post_health` 和 `post_report`，并且更新检查指向本仓库（`GITHUB_REPO`）。

要关闭发送，或者让它指向你自己的服务器，请在 `maple_exp.py` 中：

- `STATS_SITE` 是网站的地址。把它改成你自己的服务器。
- `post_runs`、`post_health` 和 `post_report` 是向它发送数据的三个函数。让它们什么都不做（或抛出异常）即可停止发送。
- `check_for_update` 会向 GitHub 询问本项目的最新发布。把 `GITHUB_REPO` 指向你自己的仓库，或者让它什么都不做。

这些检查只看版本号：保留某个正式发布版本号的副本无法被区分出来，所以请不要那样做。
