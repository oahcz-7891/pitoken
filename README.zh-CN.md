# pitoken

`/tokens` —— pi 的 token 与费用报告：汇总本地会话日志。

[English](README.md)

## 安装

pi install /path/to/pitoken                  # 本地克隆
pi install git:github.com/oahcz-7891/pitoken    # 从 GitHub 安装

## 用法

/tokens                     今天（默认）
/tokens today|yesterday|week|month|all
/tokens 2026-09-13          指定本地日期
/tokens session             仅当前会话
/tokens ... flat            全部按 pi 记录的费用计算

## 定价

只有当调用的模型 id 与 `index.ts` 里 `PRICING` 费率表的键**完全相等**时，才用该表计价。其余情况——例如 `accounts/fireworks/models/...` 这类路由 id，或表里没有的任何模型——在报告中标记为 `*`（Approximated），改用 pi 为这次调用记录的 flat cost 计费。这些调用仍然计入总量，只是不按本表的费率。

## 说明

- 用量读取自 `~/.pi/agent/sessions/**/*.jsonl`（assistant 的 `usage` 字段）。
- 费率表是手工维护的：pi 自己的模型目录（`~/.pi/agent/models.json`）不参与计算。
