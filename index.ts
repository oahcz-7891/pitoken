/**
 * /tokens — pi token & cost report (Claude Code `/cost` style output)
 *
 * Usage:
 *   /tokens              today (default)
 *   /tokens today|yesterday|week|month|all
 *   /tokens 2026-09-13   a specific local date
 *   /tokens session      only the current session file
 *   /tokens ... flat     price every call with pi's recorded (flat) cost
 *
 * Data source: ~/.pi/agent/sessions/**\/*.jsonl (per-entry assistant `usage`).
 * Cost: DeepSeek peak / off-peak rates. Peak = UTC 01:00-04:00 & 06:00-10:00
 * Mon-Fri (Beijing 09:00-12:00 & 14:00-18:00); all other hours off-peak (50%).
 * Unknown models fall back to the cost pi recorded for the call.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Pricing ($ per 1M tokens). Edit freely. Off-peak = half of peak.
// ---------------------------------------------------------------------------
type Period = "peak" | "offPeak";
interface Rates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

const PRICING: Record<string, Record<Period, Rates>> = {
	"deepseek-v4.1-flash": {
		peak: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
	},
	"deepseek-v4-flash": {
		peak: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
	},
	"deepseek-v4-flash-vision-exp": {
		peak: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
	},
	"deepseek-flash": {
		peak: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
	},
	"deepseek-v4-pro": {
		peak: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
		offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
	},
};

// DeepSeek peak windows: UTC 01:00-04:00 and 06:00-10:00, Monday-Friday.
// Everything else (incl. weekends and the 12:00-14:00 Beijing noon slot) is off-peak.
const PEAK_WINDOWS_MIN: Array<[number, number]> = [
	[1 * 60, 4 * 60], // 01:00-04:00 UTC = 09:00-12:00 Beijing
	[6 * 60, 10 * 60], // 06:00-10:00 UTC = 14:00-18:00 Beijing
];

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------
interface Range {
	label: string;
	start: number; // epoch ms, inclusive
	end: number; // epoch ms, exclusive
}

function startOfLocalDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseRange(arg: string): Range {
	const now = new Date();
	const t0 = startOfLocalDay(now);
	const DAY = 24 * 3600 * 1000;
	const key = arg.trim().toLowerCase();

	if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
		const start = new Date(`${key}T00:00:00`);
		return { label: key, start: start.getTime(), end: start.getTime() + DAY };
	}
	switch (key) {
		case "yesterday":
			return { label: "yesterday", start: t0.getTime() - DAY, end: t0.getTime() };
		case "week": {
			const start = t0.getTime() - 6 * DAY;
			return { label: "last 7 days", start, end: t0.getTime() + DAY };
		}
		case "month": {
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
			const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
			return { label: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, start: start.getTime(), end: end.getTime() };
		}
		case "all":
			return { label: "all time", start: 0, end: Number.MAX_SAFE_INTEGER };
		case "session":
		case "today":
		default:
			return { label: "today", start: t0.getTime(), end: t0.getTime() + DAY };
	}
}

function isOffPeak(ts: number): boolean {
	const d = new Date(ts);
	const dow = d.getUTCDay(); // 0 = Sunday
	if (dow === 0 || dow === 6) return true; // weekends are off-peak all day
	const min = d.getUTCHours() * 60 + d.getUTCMinutes();
	for (const [start, end] of PEAK_WINDOWS_MIN) {
		if (min >= start && min < end) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
interface Cell {
	model: string;
	period: Period;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	flatCost: number;
	calls: number;
	approximated: boolean;
}

interface Report {
	range: Range;
	flat: boolean;
	scope: "all-sessions" | "current-session";
	cells: Cell[];
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	flatCost: number;
	calls: number;
	files: number;
	peakCost: number;
	offPeakCost: number;
	peakCalls: number;
	offPeakCalls: number;
}

interface RawUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

function costFor(model: string, period: Period, u: RawUsage): number {
	const rates = PRICING[model]?.[period];
	if (!rates) {
		return u.cost?.total ?? 0; // fall back to what pi recorded
	}
	return (
		((u.input ?? 0) / 1e6) * rates.input +
		((u.output ?? 0) / 1e6) * rates.output +
		((u.cacheRead ?? 0) / 1e6) * rates.cacheRead +
		((u.cacheWrite ?? 0) / 1e6) * rates.cacheWrite
	);
}

function listSessionFiles(dir: string, minMtime: number): string[] {
	const out: string[] = [];
	const stack: string[] = [dir];
	while (stack.length > 0) {
		const cur = stack.pop() as string;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(cur, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			const p = path.join(cur, e.name);
			if (e.isDirectory()) {
				stack.push(p);
			} else if (e.isFile() && e.name.endsWith(".jsonl")) {
				try {
					if (fs.statSync(p).mtimeMs >= minMtime) out.push(p);
				} catch {
					/* ignore */
				}
			}
		}
	}
	return out;
}

function resolveSessionsDir(): string {
	const env = process.env.PI_CODING_AGENT_SESSION_DIR;
	if (env && env.trim()) return env;
	return path.join(getAgentDir(), "sessions");
}

function collect(files: string[], range: Range, flat: boolean): Report {
	const cells = new Map<string, Cell>();
	const report: Report = {
		range,
		flat,
		scope: "all-sessions",
		cells: [],
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		flatCost: 0,
		calls: 0,
		files: 0,
		peakCost: 0,
		offPeakCost: 0,
		peakCalls: 0,
		offPeakCalls: 0,
	};

	for (const file of files) {
		let content: string;
		try {
			content = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		let fileUsed = false;
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			let obj: { type?: string; timestamp?: string; message?: { role?: string; model?: string; usage?: RawUsage } };
			try {
				obj = JSON.parse(line);
			} catch {
				continue;
			}
			if (obj.type !== "message") continue;
			const msg = obj.message;
			if (!msg || msg.role !== "assistant" || !msg.usage) continue;
			const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
			if (!Number.isFinite(ts) || ts < range.start || ts >= range.end) continue;

			const model = msg.model || "unknown";
			const period: Period = isOffPeak(ts) ? "offPeak" : "peak";
			const u = msg.usage;
			const key = `${model}\u0000${period}`;
			let cell = cells.get(key);
			if (!cell) {
				cell = {
					model,
					period,
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					flatCost: 0,
					calls: 0,
					approximated: !PRICING[model],
				};
				cells.set(key, cell);
			}

			const cost = costFor(model, period, u);
			const flatCost = u.cost?.total ?? 0;
			cell.input += u.input ?? 0;
			cell.output += u.output ?? 0;
			cell.cacheRead += u.cacheRead ?? 0;
			cell.cacheWrite += u.cacheWrite ?? 0;
			cell.cost += cost;
			cell.flatCost += flatCost;
			cell.calls += 1;

			report.input += u.input ?? 0;
			report.output += u.output ?? 0;
			report.cacheRead += u.cacheRead ?? 0;
			report.cacheWrite += u.cacheWrite ?? 0;
			report.cost += cost;
			report.flatCost += flatCost;
			report.calls += 1;
			if (period === "offPeak") {
				report.offPeakCost += cost;
				report.offPeakCalls += 1;
			} else {
				report.peakCost += cost;
				report.peakCalls += 1;
			}
			fileUsed = true;
		}
		if (fileUsed) report.files += 1;
	}

	report.cells = [...cells.values()].sort((a, b) => {
		if (a.model !== b.model) return a.model < b.model ? -1 : 1;
		return a.period === "peak" ? -1 : 1;
	});
	if (flat) report.cost = report.flatCost;
	return report;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function fmtTokens(n: number): string {
	if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return String(n);
}

function fmtCost(n: number): string {
	return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
}

function fmtMoney(n: number): string {
	return `$${n.toFixed(4)}`;
}

function hitRate(input: number, cacheRead: number, cacheWrite: number): string {
	const denom = input + cacheRead + cacheWrite;
	return denom > 0 ? `${((cacheRead / denom) * 100).toFixed(1)}%` : "-";
}

const PERIOD_LABEL: Record<Period, string> = { peak: "peak", offPeak: "off-peak" };

// Money color. Every cost value in the report uses this one theme token, so the
// amounts stay visually consistent (and follow the theme).
const AMOUNT_COLOR = "success";

interface HeaderLine {
	label: string;
	value: string;
	kind: "cost" | "plain";
}

function headers(r: Report): HeaderLine[] {
	const cost = r.flat ? r.flatCost : r.cost;
	return [
		{ label: "Total cost:", value: `${fmtCost(cost)}${r.flat ? "  (flat, pi recorded)" : ""}`, kind: "cost" },
		{ label: "Total tokens:", value: fmtTokens(r.input + r.output + r.cacheRead + r.cacheWrite), kind: "plain" },
		{ label: "Cache hit rate:", value: hitRate(r.input, r.cacheRead, r.cacheWrite), kind: "plain" },
		{ label: "Peak cost:", value: `${fmtCost(r.peakCost)}  (${r.peakCalls} calls)`, kind: "cost" },
		{ label: "Off-peak cost:", value: `${fmtCost(r.offPeakCost)}  (${r.offPeakCalls} calls)`, kind: "cost" },
	];
}

function rowLine(c: Cell): { name: string; detail: string } {
	const name = `${c.model} (${PERIOD_LABEL[c.period]})${c.approximated ? "*" : ""}:`;
	const detail =
		`${fmtTokens(c.input)} input, ` +
		`${fmtTokens(c.output)} output, ` +
		`${fmtTokens(c.cacheRead)} cache read, ` +
		`${hitRate(c.input, c.cacheRead, c.cacheWrite)} cache hit ` +
		`(${fmtCost(c.cost)})`;
	return { name, detail };
}

function nameWidth(r: Report): number {
	return Math.max(0, ...r.cells.map((c) => rowLine(c).name.length));
}

function formatPlain(r: Report): string {
	const lines: string[] = [];
	lines.push(`pi token usage — ${r.range.label}`);
	for (const h of headers(r)) lines.push(` ${h.label.padEnd(22)} ${h.value}`);
	lines.push(" Usage by model:");
	const w = nameWidth(r);
	if (r.cells.length === 0) {
		lines.push("     (no usage found)");
	} else {
		for (const c of r.cells) {
			const { name, detail } = rowLine(c);
			lines.push(`     ${name.padEnd(w)}  ${detail}`);
		}
	}
	return lines.join("\n");
}

function formatThemed(r: Report, theme: ExtensionCommandContext["ui"]["theme"]): string[] {
	const lines: string[] = [];
	lines.push(theme.fg("accent", theme.bold(`Token Usage — ${r.range.label}`)));
	for (const h of headers(r)) {
		const label = theme.fg("dim", ` ${h.label.padEnd(22)} `);
		const value = h.kind === "cost" ? theme.fg(AMOUNT_COLOR, h.value) : h.value;
		lines.push(label + value);
	}
	lines.push(theme.fg("muted", " Usage by model:"));
	const w = nameWidth(r);
	if (r.cells.length === 0) {
		lines.push(theme.fg("dim", "     (no usage found)"));
	} else {
		for (const c of r.cells) {
			const { name, detail } = rowLine(c);
			const styledName =
				theme.fg("accent", c.model) +
				theme.fg("dim", ` (${PERIOD_LABEL[c.period]})${c.approximated ? "*" : ""}:`) +
				" ".repeat(Math.max(1, w - name.length + 1));
			lines.push(`     ${styledName}${theme.fg("muted", detail)}`);
		}
	}
	if (r.cells.some((c) => c.approximated)) {
		lines.push(theme.fg("dim", " * no peak/off-peak table for this model — pi's recorded cost used"));
	}
	lines.push(theme.fg("dim", ` ${r.files} session file(s), ${r.calls} calls`));
	return lines;
}

async function showReport(r: Report, ctx: ExtensionCommandContext): Promise<void> {
	const plain = formatPlain(r);
	if (!ctx.hasUI) return;
	if (ctx.mode !== "tui") {
		ctx.ui.notify(plain, "info");
		return;
	}
	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const children: Text[] = [];
		for (const line of formatThemed(r, theme)) children.push(new Text(line, 1, 0));
		children.push(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
		return {
			render: (width: number) => children.flatMap((child) => child.render(width)),
			invalidate: () => {
				for (const child of children) child.invalidate?.();
			},
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape") || data === "q") done(undefined);
			},
		};
	});
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------
const SCOPES = ["today", "yesterday", "week", "month", "all", "session", "flat"];

export default function tokensExtension(pi: ExtensionAPI) {
	pi.registerCommand("tokens", {
		description: "Token & cost report (Claude Code style), split by model and peak/off-peak",
		getArgumentCompletions: (prefix: string) => {
			const filtered = SCOPES.filter((s) => s.startsWith(prefix.trim().toLowerCase()));
			return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (args, ctx) => {
			const parts = args
				.trim()
				.toLowerCase()
				.split(/\s+/)
				.filter(Boolean);
			const flat = parts.includes("flat");
			const scopeWord = parts.find((p) => p !== "flat") ?? "today";

			let files: string[];
			let range: Range;
			let scope: Report["scope"] = "all-sessions";

			if (scopeWord === "session") {
				const file = ctx.sessionManager.getSessionFile();
				if (!file) {
					ctx.ui.notify("No session file for this session (ephemeral)", "warning");
					return;
				}
				files = [file];
				range = { label: "this session", start: 0, end: Number.MAX_SAFE_INTEGER };
				scope = "current-session";
			} else {
				range = parseRange(scopeWord === "today" ? "today" : scopeWord);
				const dir = resolveSessionsDir();
				files = listSessionFiles(dir, range.start);
			}

			const report = collect(files, range, flat);
			report.scope = scope;
			await showReport(report, ctx);
		},
	});
}
