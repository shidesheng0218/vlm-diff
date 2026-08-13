# GitHub 发布指南

## 1. 创建 GitHub 仓库

访问 https://github.com/new 创建新仓库：
- **仓库名**: `vlm-diff` (推荐) 或 `ui-visual-regression-benchmark`
- **描述**: Hybrid DOM+VLM pipeline for UI visual regression testing
- **公开/私有**: Public (开源项目)
- **不要**初始化 README/LICENSE/.gitignore (本地已有)

## 2. 推送到 GitHub

创建完成后，运行以下命令（替换 `YOUR_USERNAME` 为你的 GitHub 用户名）：

```bash
cd "/Users/eastbuy/Documents/Claude code项目/多模态强化工具"

# 添加远程仓库
git remote add origin https://github.com/YOUR_USERNAME/vlm-diff.git

# 推送所有内容
git push -u origin master
```

## 3. 更新 README 和 paper 中的链接

推送成功后，更新以下文件中的占位符链接：

### README.md
将 `[Code and dataset available on GitHub]` 替换为实际链接：
```markdown
📦 [Code and dataset available on GitHub](https://github.com/YOUR_USERNAME/vlm-diff)
```

### paper/vlm-diff.tex
替换两处：
1. Abstract 中：`\url{https://github.com/[your-repo]}` → `\url{https://github.com/YOUR_USERNAME/vlm-diff}`
2. LICENSE 中：`[Your Name]` → 你的实际姓名

### hn-post.md
添加实际链接：
```markdown
GitHub: https://github.com/YOUR_USERNAME/vlm-diff
Paper: https://arxiv.org/abs/XXXX.XXXXX (arXiv 上传后填写)
```

## 4. 提交 arXiv

访问 https://arxiv.org/submit

1. 选择类别：**cs.CV** (Computer Vision) 或 **cs.HC** (Human-Computer Interaction)
2. 上传 `paper/vlm-diff.tex`
3. 标题：VLM-Diff: Hybrid Deterministic-VLM Pipeline for UI Visual Regression Detection
4. 作者：填写你的真实信息
5. Abstract：复制 LaTeX 文件中的 abstract 内容
6. Comments 建议写：4 pages, 1 table. Code and dataset available at https://github.com/YOUR_USERNAME/vlm-diff

arXiv 审核通常需要 1-2 个工作日。

## 5. 发布到 Hacker News

审核通过后，访问 https://news.ycombinator.com/submit

- **Title**: 直接使用 `hn-post.md` 中的标题
- **URL**: 填写 GitHub 仓库链接或 arXiv 论文链接
- **Text**: 复制 `hn-post.md` 中的 Body 部分，记得更新链接

最佳发帖时间（太平洋时间）：
- 工作日 8-10am (UTC-8)
- 避开周五下午和周末

## 当前状态

✅ Git 仓库已提交所有文件 (2 commits)
✅ arXiv paper 已完成 (paper/vlm-diff.tex)
✅ HN post 模板已就绪 (hn-post.md)
⏳ 等待推送到 GitHub
⏳ 等待上传到 arXiv
⏳ 等待发布到 HN

---

**需要我帮你做的**：提供你的 GitHub 用户名，我可以生成完整的推送命令。
