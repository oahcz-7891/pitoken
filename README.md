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

## Pricing

A call is priced from the rate table `PRICING` in `index.ts` only when its model id matches a key in that table **exactly**. Anything else — a routed id such as `accounts/fireworks/models/...`, or any model the table does not list — is marked `*` (Approximated) in the report and billed at the flat cost pi recorded for the call. Those calls still count toward the totals, just not at the table's rates.

## Notes

- Usage is read from `~/.pi/agent/sessions/**/*.jsonl` (assistant `usage` entries).
- The rate table is hand-maintained: pi's own model catalog (`~/.pi/agent/models.json`) is never consulted.
