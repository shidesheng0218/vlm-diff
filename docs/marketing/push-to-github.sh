#!/bin/bash

# VLM-Diff GitHub 推送脚本
# 使用前请先在 https://github.com/new 创建仓库 vlm-diff

set -e

cd "/Users/eastbuy/Documents/Claude code项目/多模态强化工具"

echo "检查 Git 状态..."
git status

echo ""
echo "添加远程仓库..."
git remote add origin https://github.com/shidesheng0218/vlm-diff.git

echo ""
echo "推送到 GitHub..."
git push -u origin master

echo ""
echo "✅ 推送成功！"
echo ""
echo "仓库地址: https://github.com/shidesheng0218/vlm-diff"
echo ""
echo "接下来："
echo "1. 访问仓库确认所有文件已上传"
echo "2. 更新 README.md 中的 GitHub 链接"
echo "3. 更新 paper/vlm-diff.tex 中的 \\url{} 和作者信息"
echo "4. 提交到 arXiv: https://arxiv.org/submit"
