/**
 * Date and timezone helpers.
 *
 * No date library. Everything here is native Intl/Date, which handles US
 * Eastern DST correctly via the IANA database — a hand-rolled UTC-5/UTC-4
 * offset would be wrong twice a year, exactly around the March and November
 * release calendars.
 */

export const ET_ZONE = 'America/New_York';

/** Format a Date as YYYY-MM-DD in a given IANA zone. */
export function toDateKey(d: Date, timeZone: string = ET_ZONE): string {
	// en-CA gives ISO-style YYYY-MM-DD ordering directly.
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(d);
}

/** Today's date in ET, as YYYY-MM-DD. */
export function todayET(): string {
	return toDateKey(new Date());
}

/** Add days to a YYYY-MM-DD key, staying in plain-date space (DST-safe). */
export function addDays(dateKey: string, days: number): string {
	const [y, m, d] = dateKey.split('-').map(Number);
	// Noon UTC avoids any chance of rolling over a day boundary from offsets.
	const dt = new Date(Date.UTC(y, m - 1, d, 12));
	dt.setUTCDate(dt.getUTCDate() + days);
	return dt.toISOString().slice(0, 10);
}

/** Day of week for a date key, 0 = Sunday. */
export function dayOfWeek(dateKey: string): number {
	const [y, m, d] = dateKey.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** The Monday on or before the given date. Weeks run Mon-Sun. */
export function startOfWeek(dateKey: string): string {
	const dow = dayOfWeek(dateKey);
	const delta = dow === 0 ? -6 : 1 - dow;
	return addDays(dateKey, delta);
}

/** The seven date keys of the week containing `dateKey`. */
export function weekDays(dateKey: string): string[] {
	const monday = startOfWeek(dateKey);
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** True for a YYYY-MM-DD string. Used to reject junk route params. */
export function isDateKey(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const [y, m, d] = s.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return (
		dt.getUTCFullYear() === y &&
		dt.getUTCMonth() === m - 1 &&
		dt.getUTCDate() === d
	);
}

/**
 * Resolve an ET wall-clock (date + minutes past midnight) to a real instant.
 *
 * We store events as ET wall-clock because that is how release schedules are
 * defined. To render them in the viewer's local zone we have to pin them to an
 * actual instant first, which means finding the UTC time whose ET rendering
 * matches what we stored. ET is UTC-4 or UTC-5, so we try both candidates and
 * keep whichever round-trips — this is exact, including on DST changeover
 * days, without needing an offset table.
 */
export function etWallClockToInstant(
	dateKey: string,
	etMinutes: number,
): Date {
	const [y, m, d] = dateKey.split('-').map(Number);
	const hour = Math.floor(etMinutes / 60);
	const minute = etMinutes % 60;

	for (const offsetHours of [4, 5]) {
		const candidate = new Date(
			Date.UTC(y, m - 1, d, hour + offsetHours, minute),
		);
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: ET_ZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		}).formatToParts(candidate);
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
		const roundTripped = `${get('year')}-${get('month')}-${get('day')}`;
		const roundTrippedMins =
			Number(get('hour')) % 24 * 60 + Number(get('minute'));
		if (roundTripped === dateKey && roundTrippedMins === etMinutes) {
			return candidate;
		}
	}

	// Only reachable for a wall-clock that does not exist (the 02:00-03:00 gap
	// on the spring-forward Sunday). No US release is scheduled then, but we
	// return the UTC-4 reading rather than throwing so one bad row cannot take
	// down a whole week's render.
	return new Date(Date.UTC(y, m - 1, d, hour + 4, minute));
}

/** 'ET' shows the stored wall-clock; 'local' converts to the viewer's zone. */
export type TimeMode = 'ET' | 'local';

/** Render an event's time for display, or a dash when we have no time. */
export function formatEventTime(
	dateKey: string,
	etMinutes: number | null,
	mode: TimeMode,
): string {
	if (etMinutes === null) return '—';

	if (mode === 'ET') {
		const h = Math.floor(etMinutes / 60);
		const m = etMinutes % 60;
		const suffix = h >= 12 ? 'PM' : 'AM';
		const h12 = h % 12 === 0 ? 12 : h % 12;
		return `${h12}:${String(m).padStart(2, '0')} ${suffix} ET`;
	}

	const instant = etWallClockToInstant(dateKey, etMinutes);
	return new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
	}).format(instant);
}

/** Long-form day heading, e.g. 'Tuesday, August 25, 2026'. */
export function formatDayHeading(dateKey: string): string {
	const [y, m, d] = dateKey.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/**
 * Compact "how long ago" for news timestamps.
 *
 * Deliberately coarse and deliberately not localised: it sits next to
 * monospace clock times in a dense strip, so "4h" has to stay two or three
 * characters wide. Intl.RelativeTimeFormat would give "4 hours ago", which is
 * correct and four times too long for the space.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return '';

	const secs = Math.max(0, Math.round((now.getTime() - then) / 1000));
	if (secs < 90) return 'just now';

	const mins = Math.round(secs / 60);
	if (mins < 60) return `${mins}m ago`;

	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d ago`;

	return `${Math.round(days / 7)}w ago`;
}

/**
 * Whole days between two YYYY-MM-DD keys.
 *
 * Plain-date arithmetic via UTC noon, the same trick addDays uses, so a DST
 * boundary inside the span cannot round the answer to 0 or 2.
 */
export function daysBetween(fromKey: string, toKey: string): number {
	const at = (k: string) => {
		const [y, m, d] = k.split('-').map(Number);
		return Date.UTC(y, m - 1, d, 12);
	};
	return Math.round((at(toKey) - at(fromKey)) / 86_400_000);
}

/** "today" / "tomorrow" / "in 3d" / "in 2w", for countdown badges. */
export function relativeDays(days: number): string {
	if (days < 0) return `${-days}d ago`;
	if (days === 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days < 7) return `in ${days}d`;
	if (days < 28) return `in ${Math.round(days / 7)}w`;
	return `in ${Math.round(days / 30)}mo`;
}
