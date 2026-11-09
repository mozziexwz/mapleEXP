# 下载来自哪里

[Releases 页面](https://github.com/mozziexwz/mapleEXP/releases)上的下载文件，是由 GitHub 根据本仓库中的代码构建的（[Build 工作流](../.github/workflows/build.yml)），而不是在某个人自己的电脑上构建的。每次构建都会：

- 安装指定的软件包文件，每个都用 SHA-256 校验（[requirements-build.txt](../requirements-build.txt)），
- 运行全部测试，
- 记录一份签名的**证明（attestation）**：哪个工作流、从哪个提交构建了哪个文件，
- 把每个文件的 **SHA-256** 放在发布页面上（`SHA256SUMS.txt`）：Windows 压缩包，以及自 v0.9.16 起的两个 Mac .dmg 文件。

**校验你的下载**可以使用免费的 [GitHub CLI](https://cli.github.com)：

```
gh attestation verify "你下载的文件" --repo mozziexwz/mapleEXP
```

它会告诉你这个文件是不是确实在这里构建的，以及来自哪个提交。或者把文件的 SHA-256 与其发布页面上的 `SHA256SUMS.txt` 对比（PowerShell 中：`Get-FileHash "你下载的文件"`；Mac 的终端中：`shasum -a 256 "你下载的文件"`）。

同样的文件也保存在构建它们的那次构建页面上（Actions，进入该次运行，页面底部的文件；下载需要 GitHub 账号）。10 月 17 日之后的构建运行会原样保存它们，所以 GitHub 在那里显示的 SHA-256 就是文件本身的，与发布页面上的相同。

**关于 v0.9.6：** 它是由 GitHub 根据其标签构建的，当时还没有加入软件包校验和证明，所以它没有证明。它的 SHA-256 在其发布页面上。[它的构建页面](https://github.com/beanguri/Maple-Classic-Exp-Overlay/actions/runs/38631744258)把压缩包放在了一个额外的压缩包里（GitHub 默认这样做），所以*那里*显示的 SHA-256 是外层压缩包的，不会匹配：解压一次，里面的压缩包才是发布页面上的 SHA-256。该页面会保留到 2027 年 1 月。v0.9.6 之前的版本是在原作者自己的电脑上构建的。

代码签名政策见 [README](../README.md#代码签名政策)。
