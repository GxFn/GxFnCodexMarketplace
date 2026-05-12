# GxFn Codex 插件市场

这是 GxFn 的 Codex 插件聚合市场。

安装这个市场后，Codex 会在同一个 `GxFn` 市场下同时显示这里登记的所有插件，而不是把一个插件仓库用同名 marketplace id 安装时替换掉另一个。

## 安装

```bash
codex plugin marketplace add GxFn/GxFnCodexMarketplace --ref main
```

在 Codex UI 中填写：

```text
来源：GxFn/GxFnCodexMarketplace
Git 引用：main
稀疏路径：留空
```

## 包含插件

- Alembic：Codex 本地项目记忆、Recipes、Guard 检查和可恢复 bootstrap job。
- Codex Lark Remote：从飞书/Lark 继续当前 Codex 对话。

## 开发

插件目录是 vendored release snapshot：

```bash
plugins/alembic-codex
plugins/codex-lark-remote
```

Codex 从 Git 添加 marketplace 时不会初始化 Git submodule，所以这个仓库刻意内置可安装插件根目录，而不是使用 submodule。某个插件仓库发布新版本后，刷新这里对应的插件目录，验证 Codex 市场展示，再提交 snapshot 更新。
