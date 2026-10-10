# GitBook 人工配置清单

> **记录状态：** 待管理员逐项核对
> **重要说明：** 本文件只记录操作和验收方法，不表示 Git Sync、Edit on Git、反馈或 Insights 已经启用。GitBook 界面和套餐能力可能变化，操作时应同时参考官方文档。

每次配置后，请在本文末尾的记录表中填写操作者、日期、对象和验证结果，不要在仓库中保存令牌、组织内部信息或后台截图中的敏感数据。

## 配置前准备

- 确认操作者同时拥有目标 GitBook 组织/站点和 GitHub 仓库所需权限。
- 确认目标仓库、内容所在目录和实际发布分支。不要仅因为仓库默认分支名为 `main` 就假定后台也使用该分支。
- 备份或记录 GitBook 与 GitHub 两侧当前内容状态，安排低风险时段进行首次同步。
- GitHub App 应只授权所需仓库，并遵循最小权限原则。

## 1. Git Sync

官方说明：Git Sync 需要在 GitBook space 中连接 GitHub/GitLab 仓库，并选择同步分支；首次同步还要选择初始同步方向。已有 Markdown 仓库通常应选择 **GitHub → GitBook**，避免用空白或旧的 GitBook 内容覆盖仓库。

人工步骤：

1. 在 GitBook 中打开承载本站内容的 space，找到 **Set up Git Sync**（若已连接，则进入对应的 Git Sync 设置）。
2. 按提示安装或授权 GitBook GitHub App，只选择本仓库。
3. 选择正确的仓库、内容根目录和发布分支。
4. 首次连接前比较两侧内容；对于本仓库已有内容的情形，确认选择 **GitHub → GitBook**。
5. 启动同步，等待完成并检查冲突、失败提示和目录结构。
6. 建立一个无敏感信息的小型测试 PR，合并后验证 GitBook 中出现对应变更；若允许从 GitBook 反向编辑，再用独立测试确认生成分支和 PR 的行为。

验收证据：记录连接的仓库、分支、目录、初始方向、测试提交 SHA、核验日期和结果。不要记录访问令牌。

## 2. Edit on Git

Edit on Git 依赖已配置的 Git Sync。GitBook 官方文档将它列为站点的可选 page action；未完成 Git Sync 时不要尝试启用。

人工步骤：

1. 确认上一节 Git Sync 验收通过。
2. 从目标 Docs site 的概览进入 **Customization → Configure**。
3. 在 page actions / Git Sync actions 中找到 **Edit on Git** 并启用，然后保存配置。
4. 打开已发布站点的一篇页面，在页面操作菜单中检查入口。
5. 以没有仓库写权限的普通读者视角打开入口，确认它指向正确仓库、分支和文件路径，并且只引导提出修改，不暴露后台权限。

验收证据：记录测试页面、目标 GitHub 路径、测试日期和结果。若界面中没有该选项，先复查 Git Sync、权限和当前套餐，不要在文档中宣称已启用。

## 3. 页面反馈

GitBook 当前将页面评分作为站点配置项；评分启用后，读者可在页面上反馈，结果可在 Insights 中查看。

人工步骤：

1. 在目标 Docs site 打开站点设置或 **Customization → Configure**；不同版本界面可能将该选项显示在 **Features** 或配置页中。
2. 找到 **Page ratings / page feedback**，阅读当前界面中的数据与隐私说明后再启用。
3. 保存并发布配置。
4. 在无痕窗口打开已发布页面，确认评分入口存在且不要求读者公开个人信息。
5. 提交一次明确标记为测试的反馈（若后台无法删除测试数据，则跳过提交，仅检查入口），并确认维护者知道在哪里查看和处理反馈。

验收证据：记录启用范围、隐私审查人、测试日期和结果。不要把自由文本反馈原样复制到公开 issue，先移除个人信息。

## 4. Insights

GitBook 官方资料显示，站点 Insights 可用于查看流量、热门页面、搜索和页面反馈等数据；具体数据集和保留范围可能受套餐与站点配置影响。

人工步骤：

1. 打开目标 Docs site，在站点导航中查找 **Insights**。
2. 核对当前账号能看到的数据类型、时间范围和筛选条件；记录不可用或受套餐限制的项目。
3. 确认页面评分已启用后，检查 Feedback 数据是否进入预期站点，而不是其他 space/site。
4. 指定维护责任人和查看节奏，例如每月检查负面反馈、零结果搜索和高流量但状态为“可能过时”的页面。
5. 导出或共享数据前进行隐私评估；仅保留内容改进所需的聚合信息，不尝试识别访客。

验收证据：记录可见数据集、检查周期、负责人、日期和限制。Insights 页面可访问不等于所有数据类型都已启用或已有数据。

## 配置记录

| 功能 | 状态 | GitBook 对象 / GitHub 分支 | 操作者 | 核验日期 | 验证结果或后续动作 |
| --- | --- | --- | --- | --- | --- |
| Git Sync | 未核验 | 待填写 | 待填写 | 待填写 | 待填写 |
| Edit on Git | 未核验 | 待填写 | 待填写 | 待填写 | 待填写 |
| 页面反馈 | 未核验 | 待填写 | 待填写 | 待填写 | 待填写 |
| Insights | 未核验 | 待填写 | 待填写 | 待填写 | 待填写 |

## 官方参考

- [导入或迁移内容并配置 Git Sync](https://gitbook.com/docs/guides/editing-and-publishing-documentation/import-or-migrate-your-content-to-gitbook-with-git-sync)
- [配置站点行为、页面反馈和 Edit on Git](https://gitbook.com/docs/guides/customizing-your-site/how-to-customize-your-sites-configuration)
- [文档分析与 Insights 指标](https://gitbook.com/docs/guides/docs-analytics/documentation-analytics)
