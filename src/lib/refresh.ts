/**
 * The refresh orchestrator.
 *
 * Pulls from all three sources, merges, and upserts. Called by the Vercel
 * cron route and by `npm run refresh` for local seeding.
 *
 * Design rule throughout: a partial failure degrades, it does not wipe. Every
 * source is allowed to fail independently and the database keeps whatever the
 * last good run wrote for the sources that did fail.
 */

import { fetchMacroEvents } from './fred/releases';
import { fetchFomcEvents, fomcCoverageEndsOn } from './fomc';
import { fetchConstituents } from './earnings/constituents';
import { fetchEarningsEvents } from './earnings/events';
import { logRefresh, upsertEvents } from './db/events';
import { addDays, todayET } from './time';
import type { MarketEvent } from './types';

/**
 * How much calendar we keep loaded.
 *
 * Backwards 30 days so "what happened last week" still renders; forwards 90
 * because that is roughly one earnings season plus the next, and because the
 * NASDAQ leg costs one request per weekday (~64 requests at this width).
 * Widening the forward window is the main lever on refresh runtime.
 */
export const WINDOW_BACK_DAYS = 30;
export const WINDOW_FORWARD_DAYS = 90;

export interface RefreshSummary {
	ok: boolean;
	window: { start: string; end: string };
	macroEvents: number;
	fomcEvents: number;
	earningsEvents: number;
	totalUpserted: number;
	warnings: string[];
	errors: string[];
	durationMs: number;
}

export async function runRefresh(): Promise<RefreshSummary> {
	const startedAt = Date.now();
	const today = todayET();
	const start = addDays(today, -WINDOW_BACK_DAYS);
	const end = addDays(today, WINDOW_FORWARD_DAYS);

	const warnings: string[] = [];
	const errors: string[] = [];
	const all: MarketEvent[] = [];

	let macroCount = 0;
	let earningsCount = 0;

	/* ---- FOMC: local table, cannot fail over the network ---- */
	const fomc = fetchFomcEvents({ start, end });
	all.push(...fomc);

	const coverageEnd = fomcCoverageEndsOn();
	if (coverageEnd && coverageEnd < addDays(today, 90)) {
		warnings.push(
			`FOMC date table runs out on ${coverageEnd}. Top it up from federalreserve.gov/monetarypolicy/fomccalendars.htm.`,
		);
	}

	/* ---- Macro releases from FRED ---- */
	try {
		const macro = await fetchMacroEvents({ start, end });
		all.push(...macro.events);
		macroCount = macro.events.length;
		if (macro.unresolved.length > 0) {
			warnings.push(
				`FRED release names that did not resolve to an id: ${macro.unresolved.join(', ')}`,
			);
		}
		if (macro.empty.length > 0) {
			warnings.push(
				`FRED releases returning no dates in window: ${macro.empty.join(', ')}`,
			);
		}
	} catch (err) {
		errors.push(`FRED leg failed: ${String(err)}`);
	}

	/* ---- Earnings from NASDAQ, filtered to index constituents ---- */
	try {
		const constituents = await fetchConstituents();
		warnings.push(...constituents.warnings);

		const earnings = await fetchEarningsEvents({ start, end }, constituents);
		all.push(...earnings.events);
		earningsCount = earnings.events.length;

		if (earnings.failedDates.length > 0) {
			warnings.push(
				`NASDAQ fetch failed for ${earnings.failedDates.length} date(s): ${earnings.failedDates.slice(0, 5).join(', ')}${earnings.failedDates.length > 5 ? '…' : ''}`,
			);
		}
	} catch (err) {
		errors.push(`Earnings leg failed: ${String(err)}`);
	}

	/* ---- One merged write ---- */
	let totalUpserted = 0;
	try {
		totalUpserted = await upsertEvents(all);
	} catch (err) {
		errors.push(`Database write failed: ${String(err)}`);
	}

	const summary: RefreshSummary = {
		ok: errors.length === 0,
		window: { start, end },
		macroEvents: macroCount,
		fomcEvents: fomc.length,
		earningsEvents: earningsCount,
		totalUpserted,
		warnings,
		errors,
		durationMs: Date.now() - startedAt,
	};

	await logRefresh(summary.ok, JSON.stringify(summary)).catch(() => {
		// Logging must never be the thing that fails a refresh.
	});

	return summary;
}
