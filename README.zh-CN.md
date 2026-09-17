# pitoken

`/tokens` —— pi 的 token 与费用报告：汇总本地会话日志，按模型和 DeepSeek 峰谷电价拆分。

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

## 说明

- 用量读取自 `~/.pi/agent/sessions/**/*.jsonl`（assistant 的 `usage` 字段）。
- 高峰：周一至周五 09:00–12:00、14:00–18:00（北京时间）；其余时段为低谷，按半价计费。费率见 `index.ts` 里的 `PRICING`。
- 模型名后的 `*` 表示 Approximated —— 没有峰谷费率表，改用 pi 记录的费用（flat cost）。
