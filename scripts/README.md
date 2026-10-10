# 内容质量检查

运行：

```shell
npm run check:content
```

检查器只读取内容，不生成或修改 GitBook/HonKit 中间文件。它使用 Node.js 标准库，检查：

- `SUMMARY.md` 中的页面目标是否存在；
- 内容页中的站内相对 Markdown 链接、引用式链接和图片路径；
- 每页是否恰好有一个 H1，以及 H3 是否出现在对应 H2 之后；
- 新增、复制、重命名或新加入 `SUMMARY.md` 的页面是否有非空的 front matter `description`；
- Markdown 图片和 GitBook HTML `<img>` 是否缺少替代文本；
- 被内容页引用的本地图片是否超过默认的 1 MiB 阈值。

默认模式会列出全部当前问题，但只在问题相对 Git 基线为新增时返回状态码 1。基线按顺序取 `CONTENT_CHECK_BASE`、`origin/main`、`main` 与当前 `HEAD` 的 merge base。这样历史遗留问题保持可见，同时不会阻断与它们无关的修改。无法找到 Git 基线时，所有问题均视为新增。

常用选项：

```shell
# 显式指定比较基线
npm run check:content -- --base origin/main

# 任何现存问题都返回非零状态
npm run check:content:strict

# 修改大图阈值并输出 JSON
npm run check:content -- --max-image-bytes 2097152 --json
```

环境变量 `CONTENT_CHECK_MAX_IMAGE_BYTES` 也可设置图片阈值。检查器退出码为 0（通过）、1（发现应阻断的问题）或 2（参数、Git 或运行错误）。
