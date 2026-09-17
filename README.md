# pitoken

`/tokens` — a token & cost report for pi, aggregated from local session logs and split by model and DeepSeek peak / off-peak pricing.

[中文](README.zh-CN.md)

## Install

pi install /path/to/pitoken                  # local clone
pi install git:github.com/oahcz-7891/pitoken    # from GitHub

## Usage

/tokens                     today (default)
/tokens today|yesterday|week|month|all
/tokens 2026-09-13          one local date
/tokens session             current session only
/tokens ... flat            bill every call at pi's recorded cost

## Notes

- Usage is read from `~/.pi/agent/sessions/**/*.jsonl` (assistant `usage` entries).
- Peak: UTC 01:00–04:00 & 06:00–10:00, Mon–Fri. All other hours are off-peak at half rate; rates live in `PRICING` in `index.ts`.
- `*` marks an Approximated model — no rate table, so pi's recorded (flat) cost is used.
