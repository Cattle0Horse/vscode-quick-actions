# 快捷操作

通过 VS Code 命令面板或自定义快捷键执行常用操作。

## 复制当前文件

在命令面板运行 **Quick Actions: 复制当前文件到系统剪贴板**（`quickActions.copyCurrentFile`）

- 复制已保存到磁盘的文件，不自动保存编辑
- 差异编辑器使用右侧文件
- 虚拟内容、远程文件和已删除文件无法复制

## 复制当前文件路径及行号

在命令面板搜索 **Quick Actions**：

| 命令                       | 输出示例                    | 命令 ID                                            |
| -------------------------- | --------------------------- | -------------------------------------------------- |
| 复制当前文件绝对路径及行号 | `C:\project\src\main.ts:42` | `quickActions.copyCurrentFileAbsolutePathWithLine` |
| 复制当前文件相对路径及行号 | `src/main.ts:42`            | `quickActions.copyCurrentFileRelativePathWithLine` |

- 复制纯文本，行号从 1 开始，取当前光标所在行；选中多行时仍只复制光标行号。
- 相对路径以文件所属工作区目录为基准，多根工作区不添加工作区名称；工作区外文件回退为绝对路径。
- 使用当前聚焦的文本编辑器，差异编辑器取当前聚焦的一侧；该侧必须有本地文件路径。
- 不自动保存编辑；未命名文件、虚拟内容和无文本编辑器时提示原因并保留剪贴板。

## 打开当前文件 Git 差异

在命令面板搜索 **Quick Actions**，选择需要的比较方式：

| 命令                            | 左侧 → 右侧                                   | 命令 ID                         |
| ------------------------------- | --------------------------------------------- | ------------------------------- |
| 打开当前文件 Git 差异（未暂存） | 暂存区 → 工作区                               | `quickActions.openUnstagedDiff` |
| 打开当前文件 Git 差异（HEAD）   | 最近一次提交 → 工作区，包含已暂存和未暂存修改 | `quickActions.openHeadDiff`     |
| 打开当前文件 Git 差异（已暂存） | 最近一次提交 → 暂存区                         | `quickActions.openStagedDiff`   |
| 打开当前文件 Git 差异（自动）   | 优先未暂存差异，否则查看已暂存差异            | `quickActions.openGitDiff`      |

- 未保存的编辑视为工作区修改，直接显示缓冲区内容，不自动保存。
- 已暂存命令只显示暂存区内容，不受未保存编辑影响。
- 新文件与空文本比较；已暂存重命名使用旧路径的 HEAD 内容。
- 可从 Git Graph 历史提交的文本差异编辑器跳转到当前仓库对应文件的差异。
- 没有差异、不在 Git 仓库、Git 未启用或存在合并冲突时提示原因。

使用原生文本差异编辑器。可按个人偏好设置左右或上下布局。首版面向桌面本地文本文件；不提供二进制专用比较、Notebook 结构差异或合并冲突处理。

## 从 Git 差异打开源文件

运行 **Quick Actions: 从 Git 差异打开源文件**（`quickActions.openDiffSourceFile`），统一支持 VS Code 内置 Git 与 Git Graph 的文本差异编辑器。

- 打开差异右侧对应的当前工作区文件；已暂存差异也打开当前文件，保留未保存编辑。
- Git Graph 历史差异按其记录的仓库与文件路径定位，不会打开展示用的 `file.json`。
- 不保存文件或修改暂存区；Git Graph 文件已删除或路径无法解析时提示原因。

可为该命令绑定同一个快捷键，例如：

```json
{
  "key": "ctrl+alt+o",
  "command": "quickActions.openDiffSourceFile",
  "when": "isInDiffEditor"
}
```

## 自定义快捷键

在键盘快捷方式中搜索上述命令 ID，可为各命令分别绑定自己的按键。扩展不占用默认快捷键。例如为自动模式在 `keybindings.json` 中添加：

```json
{
  "key": "ctrl+alt+d",
  "command": "quickActions.openGitDiff",
  "when": "editorTextFocus"
}
```
