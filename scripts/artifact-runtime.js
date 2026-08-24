/**
 * Artifact runtime.
 *
 * Mirrors the DOM that src/components/{DayList,Toolbar,TickerStrip}.tsx render,
 * using the same class names, so src/app/globals.css styles both without
 * modification. Plain DOM APIs — no framework, no build step.
 *
 * The date logic here is a direct port of src/lib/time.ts. It is duplicated
 * rather than imported because the artifact is a single static file with no
 * module loader; keep the two in step if you change the originals.
 */
(function () {
	'use strict';

	var EVENTS = window.__EVENTS__ || [];
	var TODAY = window.__TODAY__;
	var ET_ZONE = 'America/New_York';

	var SOURCE_LABEL = {
		fred: 'FRED',
		federalreserve: 'FED',
		nasdaq: 'NASDAQ',
	};
	var SOURCE_DETAIL = {
		fred: 'Release date from the FRED API (St. Louis Fed) release/dates endpoint',
		federalreserve:
			'FOMC decision date from federalreserve.gov/monetarypolicy/fomccalendars.htm',
		nasdaq:
			'Reporting date and consensus EPS from NASDAQ’s public calendar API',
	};
	var SESSION_LABEL = {
		premarket: 'pre-mkt',
		intraday: 'intraday',
		afterhours: 'after hrs',
		unspecified: '',
	};
	var IMPACT_RANK = { High: 0, Medium: 1, Low: 2 };

	/* ------------------------------ date helpers ---------------------------- */

	function parts(key) {
		var p = key.split('-');
		return [Number(p[0]), Number(p[1]), Number(p[2])];
	}

	function addDays(key, days) {
		var p = parts(key);
		var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
		dt.setUTCDate(dt.getUTCDate() + days);
		return dt.toISOString().slice(0, 10);
	}

	function dayOfWeek(key) {
		var p = parts(key);
		return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).getUTCDay();
	}

	function startOfWeek(key) {
		var dow = dayOfWeek(key);
		return addDays(key, dow === 0 ? -6 : 1 - dow);
	}

	function weekDays(key) {
		var monday = startOfWeek(key);
		var out = [];
		for (var i = 0; i < 7; i++) out.push(addDays(monday, i));
		return out;
	}

	function formatDayHeading(key) {
		var p = parts(key);
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		}).format(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)));
	}

	/**
	 * Port of etWallClockToInstant: find the UTC instant whose ET rendering
	 * matches the stored wall clock. Trying both candidate offsets keeps this
	 * exact across DST changeovers without an offset table.
	 */
	function etToInstant(key, etMinutes) {
		var p = parts(key);
		var hour = Math.floor(etMinutes / 60);
		var minute = etMinutes % 60;
		var offsets = [4, 5];

		for (var i = 0; i < offsets.length; i++) {
			var cand = new Date(
				Date.UTC(p[0], p[1] - 1, p[2], hour + offsets[i], minute),
			);
			var f = new Intl.DateTimeFormat('en-CA', {
				timeZone: ET_ZONE,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			}).formatToParts(cand);
			var get = function (type) {
				for (var j = 0; j < f.length; j++) if (f[j].type === type) return f[j].value;
				return '';
			};
			var back = get('year') + '-' + get('month') + '-' + get('day');
			var mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
			if (back === key && mins === etMinutes) return cand;
		}
		return new Date(Date.UTC(p[0], p[1] - 1, p[2], hour + 4, minute));
	}

	function formatTime(key, etMinutes, mode) {
		if (etMinutes === null || etMinutes === undefined) return '—';
		if (mode === 'ET') {
			var h = Math.floor(etMinutes / 60);
			var m = etMinutes % 60;
			var suffix = h >= 12 ? 'PM' : 'AM';
			var h12 = h % 12 === 0 ? 12 : h % 12;
			return h12 + ':' + String(m).padStart(2, '0') + ' ' + suffix + ' ET';
		}
		return new Intl.DateTimeFormat(undefined, {
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short',
		}).format(etToInstant(key, etMinutes));
	}

	function direction(value) {
		if (!value) return null;
		if (value.charAt(0) === '+') return 'pos';
		if (value.charAt(0) === '-') return 'neg';
		return null;
	}

	/* --------------------------------- state -------------------------------- */

	var byDate = {};
	EVENTS.forEach(function (e) {
		(byDate[e.date] = byDate[e.date] || []).push(e);
	});
	Object.keys(byDate).forEach(function (d) {
		byDate[d].sort(function (a, b) {
			var at = a.etMinutes === null ? Infinity : a.etMinutes;
			var bt = b.etMinutes === null ? Infinity : b.etMinutes;
			if (at !== bt) return at - bt;
			return IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];
		});
	});

	var state = { anchor: TODAY, view: 'week', mode: 'ET' };

	/* --------------------------------- render ------------------------------- */

	function el(tag, className, text) {
		var n = document.createElement(tag);
		if (className) n.className = className;
		if (text !== undefined && text !== null) n.textContent = text;
		return n;
	}

	function renderRow(e) {
		var row = el('div', 'row kind-' + e.kind);

		var time = el(
			'div',
			'cell-time mono' + (e.etMinutes === null ? ' none' : ''),
		);
		time.appendChild(
			el('span', 'time', formatTime(e.date, e.etMinutes, state.mode)),
		);
		var sess = SESSION_LABEL[e.session];
		if (sess) time.appendChild(el('span', 'session', sess));
		row.appendChild(time);

		row.appendChild(el('span', 'chip ' + e.impact, e.impact));

		var evc = el('div', 'cell-event');
		var name = el('div', 'event-name');
		name.appendChild(el('span', null, e.title));
		if (e.symbol) name.appendChild(el('span', 'sym mono', e.symbol));
		evc.appendChild(name);
		row.appendChild(evc);

		var nums = el('div', 'nums');
		[
			['Forecast', e.forecast],
			['Previous', e.previous],
		].forEach(function (pair) {
			var dir = direction(pair[1]);
			var cell = el(
				'div',
				'num mono' + (pair[1] ? '' : ' empty') + (dir ? ' ' + dir : ''),
			);
			cell.appendChild(el('span', 'lbl', pair[0]));
			cell.appendChild(document.createTextNode(pair[1] || '—'));
			nums.appendChild(cell);
		});
		row.appendChild(nums);

		var stamp = el('span', 'stamp mono src-' + e.source, SOURCE_LABEL[e.source] || e.source);
		stamp.title = SOURCE_DETAIL[e.source] || '';
		row.appendChild(stamp);

		return row;
	}

	function renderDay(date) {
		var events = byDate[date] || [];
		var isToday = date === TODAY;
		var section = el(
			'section',
			'day' + (isToday ? ' today' : '') + (events.length === 0 ? ' is-empty' : ''),
		);

		var head = el('div', 'day-head');
		var heading = formatDayHeading(date).split(', ');
		var h2 = el('h2', 'day-date');
		h2.appendChild(el('span', 'day-dow', heading[0]));
		h2.appendChild(el('span', 'day-full mono', heading.slice(1).join(', ')));
		if (isToday) h2.appendChild(el('span', 'today-flag', 'Today'));
		head.appendChild(h2);

		var meta = el('div', 'day-meta mono');
		if (events.length === 0) {
			meta.appendChild(el('span', null, 'nothing scheduled'));
		} else {
			var macro = events.filter(function (e) { return e.kind === 'macro'; }).length;
			var high = events.filter(function (e) { return e.impact === 'High'; }).length;
			var counts = [
				[high, 'high', 'var(--high)'],
				[macro, 'macro', 'var(--macro)'],
				[events.length - macro, 'earnings', 'var(--earnings)'],
			];
			counts.forEach(function (c) {
				if (!c[0]) return;
				var pip = el('span', 'pip');
				var dot = el('i');
				dot.style.background = c[2];
				pip.appendChild(dot);
				pip.appendChild(document.createTextNode(c[0] + ' ' + c[1]));
				meta.appendChild(pip);
			});
		}
		head.appendChild(meta);
		section.appendChild(head);

		if (events.length) {
			var rows = el('div', 'rows');
			events.forEach(function (e) { rows.appendChild(renderRow(e)); });
			section.appendChild(rows);
		}
		return section;
	}

	function shortDate(key) {
		var p = parts(key);
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			month: 'long',
			day: 'numeric',
		}).format(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)));
	}

	function renderTicker() {
		var host = document.getElementById('ticker');
		host.textContent = '';

		var upcoming = EVENTS.filter(function (e) {
			return e.date >= TODAY && e.impact === 'High';
		}).slice(0, 10);
		if (!upcoming.length) {
			host.parentNode.style.display = 'none';
			return;
		}

		var label = el('div', 'ticker-label');
		label.appendChild(el('span', 'ticker-dot'));
		label.appendChild(document.createTextNode('High impact'));
		host.appendChild(label);

		upcoming.forEach(function (e) {
			var days = Math.round(
				(Date.UTC.apply(null, parts(e.date)) - Date.UTC.apply(null, parts(TODAY))) /
					86400000,
			);
			var rel =
				days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'in ' + days + 'd' : 'in ' + Math.round(days / 7) + 'w';

			var item = el('div', 'ticker-item');
			item.appendChild(el('span', 'ticker-date mono', e.date.slice(5).replace('-', '/')));
			item.appendChild(el('span', 'ticker-name', e.title));
			if (e.etMinutes !== null) {
				item.appendChild(
					el('span', 'ticker-date mono', formatTime(e.date, e.etMinutes, 'ET').replace(' ET', '')),
				);
			}
			item.appendChild(el('span', 'ticker-in mono', rel));
			host.appendChild(item);
		});
	}

	function render() {
		var host = document.getElementById('days');
		host.textContent = '';

		var dates =
			state.view === 'week' ? weekDays(state.anchor) : [state.anchor];
		dates.forEach(function (d) { host.appendChild(renderDay(d)); });

		document.getElementById('range').textContent =
			state.view === 'week'
				? shortDate(dates[0]) + ' – ' + formatDayHeading(dates[6]).replace(/^\w+, /, '')
				: formatDayHeading(state.anchor);

		set('view-week', state.view === 'week');
		set('view-day', state.view === 'day');
		set('tz-et', state.mode === 'ET');
		set('tz-local', state.mode === 'local');
	}

	function set(id, on) {
		document.getElementById(id).setAttribute('aria-pressed', on ? 'true' : 'false');
	}

	function step(dir) {
		state.anchor = addDays(state.anchor, dir * (state.view === 'week' ? 7 : 1));
		render();
	}

	/* --------------------------------- wire up ------------------------------ */

	document.getElementById('prev').onclick = function () { step(-1); };
	document.getElementById('next').onclick = function () { step(1); };
	document.getElementById('today').onclick = function () {
		state.anchor = TODAY;
		render();
	};
	document.getElementById('view-week').onclick = function () {
		state.view = 'week';
		render();
	};
	document.getElementById('view-day').onclick = function () {
		state.view = 'day';
		render();
	};
	document.getElementById('tz-et').onclick = function () {
		state.mode = 'ET';
		render();
	};
	document.getElementById('tz-local').onclick = function () {
		state.mode = 'local';
		render();
	};

	document.addEventListener('keydown', function (ev) {
		if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
		if (ev.key === 'ArrowLeft') { step(-1); }
		else if (ev.key === 'ArrowRight') { step(1); }
		else if (ev.key === 't' || ev.key === 'T') {
			state.anchor = TODAY;
			render();
		}
	});

	renderTicker();
	render();
})();
