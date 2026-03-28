# Main Source Register Desktop Release

本仓库是子项目专属发布仓库：

- GitHub: `https://github.com/lin-han-li/Main_Source_Rigister.git`
- 目标：稳定产出 Windows / Linux / macOS 三平台安装包并挂载到 Release

## 项目形态

当前不是 Electron/Tauri GUI 壳，而是两个 Python 程序：

- `register_only.py`
- `register_success.py`

通过 `PyInstaller` 先构建平台原生二进制，再做安装包封装。

## 发布原则

- Windows 只在 Windows 主机/runner 打包
- Linux 只在 Linux 主机/runner 打包
- macOS 只在 macOS 主机/runner 打包

不要在 Windows 上强行交叉打 Linux/macOS 包。

## 本地 Windows 打包

依赖：

- Node.js 20+
- Python 3.11+
- Inno Setup 6

安装：

```powershell
npm install
python -m pip install -r requirements.txt pyinstaller
```

最小回归检查：

```powershell
npm run verify:desktop
```

本地只打 Windows 包：

```powershell
npm run dist:win
```

产物目录：

- `dist/releases/win`

## 从 Windows 发起三平台发布

在准备发布时执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-cross-platform.ps1
```

它会做：

1. 本地 `verify:desktop`
2. 本地 `dist:win`
3. push 当前分支
4. 创建并 push `v<package.json.version>` tag

## GitHub Actions 与 Release

工作流支持：

- `workflow_dispatch`
- `push tags: v*`

当 tag（例如 `v1.0.0`）推送后，GitHub Actions 会在原生 runner 依次构建：

- `windows-latest` -> Windows 安装包
- `ubuntu-latest` -> Linux `.deb` / `.rpm`
- `macos-latest` -> macOS `.dmg`（默认 unsigned）

构建完成后自动把三平台产物上传到当前仓库 Release。

## 安装说明

Windows：

- 下载 `*-windows-*-setup.exe`
- 双击安装

Linux：

- Debian/Ubuntu：`sudo dpkg -i <package>.deb`
- Fedora/RHEL/CentOS：`sudo rpm -i <package>.rpm`

macOS：

- 下载 `*.dmg`
- 打开后将应用目录拖到可写目录
- 运行其中的 `.command` 启动器

## 未完成能力

- Windows 代码签名
- macOS 签名与公证
- 自动更新
## Dedicated Repo Helper Script (Windows)

For the dedicated repository `[Main_Source_Rigister](https://github.com/lin-han-li/Main_Source_Rigister.git)`, you can use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-cross-platform-dedicated.ps1
```

What this script does:

1. Verifies repository context (dedicated git root + expected `origin` URL + local workflow file).
2. Runs `npm run verify:desktop`.
3. Builds Windows installer with `npm run dist:win -- --skip-verify`.
4. Pushes current branch.
5. Creates and pushes `v<package.json.version>` tag.

Optional flags:

- `-SkipPush` creates tag locally only.
- `-AllowDirty` skips clean-worktree guard.
- `-SkipNpmInstall` skips `npm ci`/`npm install`.
- `-AllowNestedRepo` bypasses dedicated-repo root check (migration only).
- `-RemoteName <name>` overrides remote (default `origin`).
- `-ExpectedRepoUrl <url>` overrides expected remote URL.
