/**
 * Artifact runtime.
 *
 * Mirrors the DOM that src/components/* render, using the same class names, so
 * src/app/globals.css styles both without modification. Plain DOM APIs — no
 * framework, no build step.
 *
 * WHAT IS THE SAME AS THE LIVE APP: the quote board, the scrolling wire, the
 * stat band and countdown, the filter bar, expandable rows with their impact
 * rationale, and the Hot Story / Latest Stories windows with their topic and
 * ticker chips.
 *
 * WHAT IS NECESSARILY DIFFERENT: everything here reads a frozen snapshot taken
 * at export time. Neither the headlines nor the quote board polls, because
 * there is no /api to poll. The clock and the countdown DO still run — they
 * are computed from the viewer's own clock, so they stay honest in a static
 * file. Prices cannot be, so the board is stamped "frozen" and its beacon does
 * not pulse: a live-looking price that is hours old is the one genuinely
 * misleading thing this export could show.
 *
 * The date logic is a direct port of src/lib/time.ts. It is duplicated rather
 * than imported because the artifact is a single static file with no module
 * loader; keep the two in step if you change the originals.
 */
(function () {
	'use strict';

	var EVENTS = window.__EVENTS__ || [];
	var NEWS = window.__NEWS__ || { items: [], symbolDates: {} };
	var HOT = window.__HOT__ || null;
	var QUOTES = window.__QUOTES__ || { quotes: [], marketStatus: null };
	var DETAILS = window.__DETAILS__ || {};
	var TOPICS = window.__TOPICS__ || [];
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
	var ALL_KINDS = ['macro', 'earnings'];
	var ALL_IMPACTS = ['High', 'Medium', 'Low'];

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

	function daysBetween(a, b) {
		return Math.round(
			(Date.UTC.apply(null, parts(b)) - Date.UTC.apply(null, parts(a))) /
				86400000,
		);
	}

	function relativeDays(d) {
		if (d < 0) return -d + 'd ago';
		if (d === 0) return 'today';
		if (d === 1) return 'tomorrow';
		if (d < 7) return 'in ' + d + 'd';
		if (d < 28) return 'in ' + Math.round(d / 7) + 'w';
		return 'in ' + Math.round(d / 30) + 'mo';
	}

	function timeAgo(iso) {
		var then = Date.parse(iso);
		if (!isFinite(then)) return '';
		var secs = Math.max(0, Math.round((Date.now() - then) / 1000));
		if (secs < 90) return 'just now';
		var mins = Math.round(secs / 60);
		if (mins < 60) return mins + 'm ago';
		var hours = Math.round(mins / 60);
		if (hours < 24) return hours + 'h ago';
		var days = Math.round(hours / 24);
		if (days < 7) return days + 'd ago';
		return Math.round(days / 7) + 'w ago';
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

	var state = {
		anchor: TODAY,
		view: 'week',
		mode: 'ET',
		query: '',
		kinds: ALL_KINDS.slice(),
		impacts: ALL_IMPACTS.slice(),
		topic: null,
		open: null,
	};

	/** Port of FilterContext's toggleIn: emptying a set turns everything back on. */
	function toggleIn(list, value, all) {
		var i = list.indexOf(value);
		if (i === -1) list.push(value);
		else list.splice(i, 1);
		return list.length === 0 ? all.slice() : list;
	}

	/* --------------------------------- render ------------------------------- */

	function el(tag, className, text) {
		var n = document.createElement(tag);
		if (className) n.className = className;
		if (text !== undefined && text !== null) n.textContent = text;
		return n;
	}

	function eventKey(e) {
		var p = e.id.split(':');
		return p.length >= 3 ? p.slice(2).join(':') : '';
	}

	function detailFor(e) {
		if (e.kind === 'earnings') {
			var d = Object.assign({}, DETAILS.__earnings__ || {});
			d.sourceUrl = e.symbol
				? 'https://www.nasdaq.com/market-activity/stocks/' +
					e.symbol.toLowerCase() +
					'/earnings'
				: null;
			if (e.etMinutes === null && d.notesNoTime) {
				d = Object.assign({}, d, { notes: (d.notes || []).concat(d.notesNoTime) });
			}
			return d;
		}
		return DETAILS[eventKey(e)] || null;
	}

	function relatedNews(e) {
		if (e.kind === 'earnings') {
			if (!e.symbol) return [];
			return NEWS.items
				.filter(function (n) { return n.symbols.indexOf(e.symbol) !== -1; })
				.slice(0, 4);
		}
		var key = eventKey(e);
		var keys = TOPICS.filter(function (t) {
			return t.eventKeys.indexOf(key) !== -1;
		}).map(function (t) { return t.key; });
		if (!keys.length) return [];
		return NEWS.items
			.filter(function (n) {
				return n.topics.some(function (t) { return keys.indexOf(t) !== -1; });
			})
			.slice(0, 4);
	}

	function renderDetail(e) {
		var d = detailFor(e);
		var wrap = el('div', 'row-detail');
		var grid = el('div', 'rd-grid');

		var why = el('div', 'rd-block');
		why.appendChild(el('h4', null, 'Why ' + e.impact));
		why.appendChild(
			el('p', null, (d && d.rationale) || 'No classification note recorded.'),
		);
		grid.appendChild(why);

		var prov = el('div', 'rd-block');
		prov.appendChild(el('h4', null, 'Provenance'));
		prov.appendChild(el('p', null, SOURCE_DETAIL[e.source] || e.source));
		((d && d.notes) || []).forEach(function (n) {
			prov.appendChild(el('p', 'rd-note', n));
		});
		if (d && d.sourceUrl) {
			var a = el('a', 'rd-link mono', 'Open source ↗');
			a.href = d.sourceUrl;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			prov.appendChild(a);
		}
		grid.appendChild(prov);

		var cov = el('div', 'rd-block');
		var h = el('h4', null, 'Coverage');
		var rel = relatedNews(e);
		if (rel.length) h.appendChild(el('span', 'rd-count mono', String(rel.length)));
		cov.appendChild(h);
		if (!rel.length) {
			cov.appendChild(
				el('p', 'rd-note', 'Nothing in the snapshot matches this row.'),
			);
		} else {
			var ul = el('ul', 'rd-news');
			rel.forEach(function (n) {
				var li = el('li');
				var a = el('a', null, n.title);
				a.href = n.url;
				a.target = '_blank';
				a.rel = 'noopener noreferrer';
				li.appendChild(a);
				li.appendChild(
					el(
						'span',
						'rd-news-meta mono',
						n.sourceLabel + (n.publishedAt ? ' · ' + timeAgo(n.publishedAt) : ''),
					),
				);
				ul.appendChild(li);
			});
			cov.appendChild(ul);
		}
		grid.appendChild(cov);

		wrap.appendChild(grid);
		return wrap;
	}

	function renderRow(e) {
		var wrap = el('div', 'row-wrap');
		var isOpen = state.open === e.id;
		var row = el('button', 'row kind-' + e.kind + (isOpen ? ' is-open' : ''));
		row.type = 'button';
		row.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
		row.onclick = function () {
			state.open = isOpen ? null : e.id;
			render();
		};

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

		var stamp = el(
			'span',
			'stamp mono src-' + e.source,
			SOURCE_LABEL[e.source] || e.source,
		);
		stamp.title = SOURCE_DETAIL[e.source] || '';
		row.appendChild(stamp);

		var caret = el('span', 'row-caret', '›');
		caret.setAttribute('aria-hidden', 'true');
		row.appendChild(caret);

		wrap.appendChild(row);
		if (isOpen) wrap.appendChild(renderDetail(e));
		return wrap;
	}

	function renderDay(date, events) {
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
			[
				[high, 'high', 'var(--high)'],
				[macro, 'macro', 'var(--macro)'],
				[events.length - macro, 'earnings', 'var(--earnings)'],
			].forEach(function (c) {
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

	/* ------------------------------- stat band ------------------------------ */

	function nextHighImpact() {
		var future = EVENTS.filter(function (e) {
			return e.date >= TODAY && e.impact === 'High';
		}).sort(function (a, b) {
			if (a.date !== b.date) return a.date < b.date ? -1 : 1;
			var at = a.etMinutes === null ? Infinity : a.etMinutes;
			var bt = b.etMinutes === null ? Infinity : b.etMinutes;
			return at - bt;
		});
		return future[0] || null;
	}

	var countdownTimer = null;

	function renderBand(events) {
		var band = el('div', 'band');
		var next = el('div', 'band-next');
		next.appendChild(el('span', 'band-k', 'Next high impact'));

		var target = nextHighImpact();
		if (!target) {
			next.appendChild(
				el('span', 'band-title band-none', 'Nothing High-impact ahead in this snapshot'),
			);
		} else {
			next.appendChild(el('span', 'band-title', target.title));
			var cd = el('span', 'cd mono', '··:··:··');
			next.appendChild(cd);

			// The countdown is live even in a static file: it is the viewer's
			// own clock measured against a fixed instant, so it stays correct
			// however long after export the file is opened.
			var at = etToInstant(target.date, target.etMinutes === null ? 570 : target.etMinutes);
			var tick = function () {
				var delta = at.getTime() - Date.now();
				if (delta <= 0) {
					cd.textContent = 'underway';
					cd.className = 'cd mono is-live';
					return;
				}
				var s = Math.floor(delta / 1000);
				var d = Math.floor(s / 86400);
				var pad = function (n) { return String(n).padStart(2, '0'); };
				cd.textContent =
					(d > 0 ? d + 'd ' : '') +
					pad(Math.floor((s % 86400) / 3600)) + ':' +
					pad(Math.floor((s % 3600) / 60)) + ':' +
					pad(s % 60);
			};
			tick();
			if (countdownTimer) clearInterval(countdownTimer);
			countdownTimer = setInterval(tick, 1000);
		}
		band.appendChild(next);

		var macro = events.filter(function (e) { return e.kind === 'macro'; }).length;
		var stats = el('div', 'band-stats');
		[
			[events.length, state.view === 'week' ? 'This week' : 'This day', ''],
			[events.filter(function (e) { return e.impact === 'High'; }).length, 'High', ' is-high'],
			[macro, 'Macro', ' is-macro'],
			[events.length - macro, 'Earnings', ' is-earnings'],
		].forEach(function (s) {
			var st = el('div', 'band-stat' + s[2]);
			st.appendChild(el('span', 'band-n mono', String(s[0])));
			st.appendChild(el('span', 'band-k', s[1]));
			stats.appendChild(st);
		});
		band.appendChild(stats);
		return band;
	}

	/* -------------------------------- filters ------------------------------- */

	function topicKeysFor(topic) {
		if (!topic) return null;
		if (topic === 'earnings') return 'kind:earnings';
		var t = TOPICS.filter(function (x) { return x.key === topic; })[0];
		return t && t.eventKeys.length ? t.eventKeys : null;
	}

	function passes(e) {
		if (state.kinds.indexOf(e.kind) === -1) return false;
		if (state.impacts.indexOf(e.impact) === -1) return false;

		var tk = topicKeysFor(state.topic);
		if (tk === 'kind:earnings') {
			if (e.kind !== 'earnings') return false;
		} else if (tk) {
			var key = eventKey(e);
			if (tk.indexOf(key) === -1) return false;
		}

		var q = state.query.trim().toLowerCase();
		if (q) {
			var hay = (e.title + ' ' + (e.symbol || '')).toLowerCase();
			if (hay.indexOf(q) === -1) return false;
		}
		return true;
	}

	function renderFilters(shown, total) {
		var bar = el('div', 'filters');

		var search = el('div', 'search');
		var icon = el('span', 'search-icon', '⌕');
		icon.setAttribute('aria-hidden', 'true');
		search.appendChild(icon);
		var input = el('input');
		input.type = 'search';
		input.value = state.query;
		input.placeholder = 'Filter by name or ticker';
		input.setAttribute('aria-label', 'Filter events by name or ticker');
		input.oninput = function () {
			state.query = input.value;
			render();
			// Re-rendering replaces the node, so focus has to be restored or a
			// second keystroke would land nowhere.
			var live = document.querySelector('.search input');
			if (live) { live.focus(); live.setSelectionRange(live.value.length, live.value.length); }
		};
		search.appendChild(input);
		search.appendChild(el('kbd', 'mono', '/'));
		bar.appendChild(search);

		var kindSet = el('div', 'fset');
		[['macro', 'Macro'], ['earnings', 'Earnings']].forEach(function (k) {
			var on = state.kinds.indexOf(k[0]) !== -1;
			var b = el('button', 'fchip kind-' + k[0] + (on ? ' on' : ''), k[1]);
			b.type = 'button';
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
			b.onclick = function () {
				state.kinds = toggleIn(state.kinds, k[0], ALL_KINDS);
				render();
			};
			kindSet.appendChild(b);
		});
		bar.appendChild(kindSet);

		var impSet = el('div', 'fset');
		ALL_IMPACTS.forEach(function (i) {
			var on = state.impacts.indexOf(i) !== -1;
			var b = el('button', 'fchip imp-' + i + (on ? ' on' : ''), i);
			b.type = 'button';
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
			b.onclick = function () {
				state.impacts = toggleIn(state.impacts, i, ALL_IMPACTS);
				render();
			};
			impSet.appendChild(b);
		});
		bar.appendChild(impSet);

		var count = el('div', 'fcount mono');
		count.appendChild(document.createTextNode(String(shown)));
		count.appendChild(el('span', null, ' / ' + total));
		var active =
			state.query.trim() !== '' ||
			state.kinds.length !== ALL_KINDS.length ||
			state.impacts.length !== ALL_IMPACTS.length ||
			state.topic !== null;
		if (active) {
			var reset = el('button', 'freset', 'clear');
			reset.type = 'button';
			reset.onclick = function () {
				state.query = '';
				state.kinds = ALL_KINDS.slice();
				state.impacts = ALL_IMPACTS.slice();
				state.topic = null;
				render();
			};
			count.appendChild(reset);
		}
		bar.appendChild(count);

		return bar;
	}

	/* -------------------------------- marquee ------------------------------- */

	function marqueeEntries() {
		var high = EVENTS.filter(function (e) {
			return e.date >= TODAY && e.impact === 'High';
		})
			.sort(function (a, b) { return a.date < b.date ? -1 : 1; })
			.slice(0, 8)
			.map(function (e) {
				return {
					type: 'event',
					lead: e.date.slice(5).replace('-', '/'),
					text:
						e.etMinutes === null
							? e.title
							: e.title + ' · ' + formatTime(e.date, e.etMinutes, 'ET').replace(' ET', ''),
					trail: relativeDays(daysBetween(TODAY, e.date)),
					tone: 'high',
				};
			});

		var news = NEWS.items.slice(0, 8).map(function (n) {
			return {
				type: 'news',
				lead: n.sourceLabel,
				text: n.title,
				trail: n.publishedAt ? timeAgo(n.publishedAt) : '',
				href: n.url,
			};
		});

		var out = [];
		for (var i = 0; i < Math.max(high.length, news.length); i++) {
			if (i < high.length) out.push(high[i]);
			if (i < news.length) out.push(news[i]);
		}
		return out;
	}

	function renderEntry(entry) {
		var node = entry.href ? el('a', 'mq-item is-' + entry.type + ' is-link') : el('span', 'mq-item is-' + entry.type);
		if (entry.href) {
			node.href = entry.href;
			node.target = '_blank';
			node.rel = 'noopener noreferrer';
		}
		node.appendChild(
			el('span', 'mq-lead mono' + (entry.tone ? ' tone-' + entry.tone : ''), entry.lead),
		);
		node.appendChild(el('span', 'mq-text', entry.text));
		if (entry.trail) node.appendChild(el('span', 'mq-trail mono', entry.trail));
		return node;
	}

	function renderTicker() {
		var host = document.getElementById('ticker');
		var entries = marqueeEntries();
		if (!entries.length) {
			host.style.display = 'none';
			return;
		}

		var label = el('div', 'mq-label');
		label.appendChild(el('span', 'mq-label-dot'));
		label.appendChild(document.createTextNode('Wire'));
		host.appendChild(label);

		var mq = el('div', 'mq');
		var track = el('div', 'mq-track');

		var chars = entries.reduce(function (n, e) {
			return n + e.lead.length + e.text.length + (e.trail || '').length + 6;
		}, 0);
		track.style.setProperty('--mq-duration', Math.max(36, Math.round(chars / 11)) + 's');

		// Two identical runs, translated by -50%: the clone lands exactly where
		// the original started, so the loop has no seam.
		for (var copy = 0; copy < 2; copy++) {
			var run = el('div', 'mq-run');
			if (copy === 1) run.setAttribute('aria-hidden', 'true');
			entries.forEach(function (entry) { run.appendChild(renderEntry(entry)); });
			track.appendChild(run);
		}
		mq.appendChild(track);

		var toggle = el('button', 'mq-toggle mono', '❚❚');
		toggle.type = 'button';
		toggle.setAttribute('aria-label', 'Pause ticker');
		toggle.onclick = function () {
			var paused = mq.classList.toggle('is-paused');
			toggle.textContent = paused ? '▶' : '❚❚';
			toggle.setAttribute('aria-label', paused ? 'Resume ticker' : 'Pause ticker');
			toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
		};
		mq.appendChild(toggle);

		host.appendChild(mq);
	}

	/* ------------------------------ quote board ----------------------------- */

	function renderBoard() {
		var host = document.getElementById('board');
		if (!QUOTES.quotes.length) {
			host.style.display = 'none';
			return;
		}

		host.className = 'bw phase-frozen';

		var status = el('div', 'bw-status');
		var phase = el('span', 'bw-phase');
		phase.appendChild(el('i', 'bw-beacon'));
		phase.appendChild(
			document.createTextNode(QUOTES.marketStatus || 'Market'),
		);
		status.appendChild(phase);
		status.appendChild(el('span', 'bw-time mono', 'frozen ' + TODAY));
		host.appendChild(status);

		var rail = el('div', 'bw-rail');
		QUOTES.quotes.forEach(function (q, i) {
			var first = i > 0 && q.group !== QUOTES.quotes[i - 1].group;
			// Every tile is static here. In the app a mega-cap tile jumps to the
			// week it reports; the snapshot keeps the read-out and drops the
			// navigation rather than shipping a control that half works.
			var tile = el(
				'div',
				['bw-tile', 'dir-' + q.direction, 'grp-' + q.group, 'is-static']
					.concat(first ? ['is-group-start'] : [])
					.join(' '),
			);
			tile.title = [q.asOf ? 'Last: ' + q.asOf : '', 'Frozen at export time']
				.filter(Boolean)
				.join('\n');

			var head = el('span', 'bw-head');
			head.appendChild(el('span', 'bw-sym mono', q.symbol));
			head.appendChild(el('span', 'bw-label', q.label));
			tile.appendChild(head);

			var nums = el('span', 'bw-nums');
			nums.appendChild(el('span', 'bw-price mono', q.price));
			nums.appendChild(el('span', 'bw-pct mono', q.percent));
			tile.appendChild(nums);

			if (q.session) {
				tile.appendChild(
					el(
						'span',
						'bw-session mono dir-' + q.session.direction,
						'close ' + q.session.percent,
					),
				);
			}
			rail.appendChild(tile);
		});
		host.appendChild(rail);
	}

	/* ------------------------------- news desk ------------------------------ */

	function newsMeta(n) {
		var meta = el('div', 'nitem-meta');
		meta.appendChild(el('span', 'stamp mono src-news-' + n.tier, n.sourceLabel));
		if (n.tier === 'primary') {
			var badge = el('span', 'nitem-badge mono', 'issuer');
			badge.title =
				'Published by the agency that produces the data, not reported second-hand';
			meta.appendChild(badge);
		}
		meta.appendChild(
			el('span', 'nitem-when mono', n.publishedAt ? timeAgo(n.publishedAt) : ''),
		);
		return meta;
	}

	function newsTags(n) {
		if (!n.topics.length && !n.symbols.length) return null;
		var tags = el('div', 'nitem-tags');
		n.topics.forEach(function (t) {
			var tt = TOPICS.filter(function (x) { return x.key === t; })[0];
			var b = el('button', 'ntag topic-' + t + (state.topic === t ? ' on' : ''), (tt && tt.label) || t);
			b.type = 'button';
			b.onclick = function () {
				state.topic = state.topic === t ? null : t;
				render();
			};
			tags.appendChild(b);
		});
		n.symbols.forEach(function (sym) {
			var date = NEWS.symbolDates[sym];
			var b = el('button', 'ntag is-sym mono' + (state.query === sym ? ' on' : ''), sym);
			b.type = 'button';
			b.title = date ? 'Go to ' + sym + ' on ' + date : 'Filter the calendar to ' + sym;
			b.onclick = function () {
				if (state.query === sym) { state.query = ''; render(); return; }
				state.query = sym;
				// Same reasoning as the app: coverage runs after the print, so
				// filtering the week in view would usually find nothing.
				if (date) state.anchor = date;
				render();
			};
			tags.appendChild(b);
		});
		return tags;
	}

	function winHead(title, extra) {
		var head = el('div', 'win-head');
		var h2 = el('h2');
		h2.appendChild(el('span', 'win-kicker', 'News'));
		h2.appendChild(document.createTextNode(title));
		head.appendChild(h2);
		if (extra) head.appendChild(extra);
		return head;
	}

	function renderDesk() {
		var host = document.getElementById('desk');
		host.textContent = '';

		if (!NEWS.items.length) {
			var win0 = el('section', 'win');
			win0.appendChild(winHead('News'));
			win0.appendChild(
				el('p', 'win-empty', 'No headlines were captured when this snapshot was exported.'),
			);
			host.appendChild(win0);
			return;
		}

		/* ---- hot story ---- */
		var lead = null;
		if (HOT) {
			lead = NEWS.items.filter(function (n) { return n.id === HOT.id; })[0] || null;
		}
		if (!lead) lead = NEWS.items[0];

		var hotWin = el('section', 'win win-hot');
		var note = el('span', 'win-note mono', 'why?');
		note.title =
			'Scored by topic weight, whether the issuing agency published it, how many outlets are covering the subject, and how recent it is. See src/lib/news/rank.ts.';
		hotWin.appendChild(winHead('Hot Story', note));

		var art = el('article', 'hot tier-' + lead.tier);
		art.appendChild(newsMeta(lead));
		var a = el('a', 'hot-title', lead.title);
		a.href = lead.url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		art.appendChild(a);
		if (lead.summary) art.appendChild(el('p', 'hot-sum', lead.summary));
		if (HOT && HOT.reasons && HOT.reasons.length) {
			var why = el('ul', 'hot-why');
			HOT.reasons.forEach(function (r) { why.appendChild(el('li', null, r)); });
			art.appendChild(why);
		}
		var ht = newsTags(lead);
		if (ht) art.appendChild(ht);
		hotWin.appendChild(art);
		host.appendChild(hotWin);

		/* ---- latest stories ---- */
		var latestWin = el('section', 'win win-latest');
		var snap = el('span', 'live', 'Snapshot');
		snap.title = 'Frozen at export time. The live site refreshes every few minutes.';
		snap.appendChild(el('i'));
		latestWin.appendChild(winHead('Latest Stories', snap));

		var counts = {};
		NEWS.items.forEach(function (n) {
			n.topics.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
		});

		var topics = el('div', 'win-topics');
		var all = el('button', 'tchip' + (state.topic === null ? ' on' : ''), 'All');
		all.type = 'button';
		all.appendChild(el('span', 'tchip-n mono', String(NEWS.items.length)));
		all.onclick = function () { state.topic = null; render(); };
		topics.appendChild(all);

		TOPICS.forEach(function (t) {
			if (!counts[t.key]) return;
			var b = el('button', 'tchip topic-' + t.key + (state.topic === t.key ? ' on' : ''), t.label);
			b.type = 'button';
			b.appendChild(el('span', 'tchip-n mono', String(counts[t.key])));
			b.onclick = function () {
				state.topic = state.topic === t.key ? null : t.key;
				render();
			};
			topics.appendChild(b);
		});
		latestWin.appendChild(topics);

		var pool = state.topic
			? NEWS.items.filter(function (n) { return n.topics.indexOf(state.topic) !== -1; })
			: NEWS.items.filter(function (n) { return n.id !== lead.id; });
		var visible = pool.slice(0, 7);

		var list = el('ol', 'win-list');
		visible.forEach(function (n) {
			var li = el('li', 'nitem tier-' + n.tier);
			li.appendChild(newsMeta(n));
			var link = el('a', 'nitem-title', n.title);
			link.href = n.url;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			li.appendChild(link);
			var tg = newsTags(n);
			if (tg) li.appendChild(tg);
			list.appendChild(li);
		});
		latestWin.appendChild(list);

		if (!visible.length) {
			latestWin.appendChild(
				el('p', 'win-empty', 'Nothing tagged with that topic in this snapshot.'),
			);
		}

		latestWin.appendChild(
			el(
				'p',
				'win-foot',
				'Six public RSS feeds - the Federal Reserve, BEA and Census directly, plus CNBC and MarketWatch - captured when this file was exported.',
			),
		);
		host.appendChild(latestWin);
	}

	/* --------------------------------- shell -------------------------------- */

	function shortDate(key) {
		var p = parts(key);
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			month: 'long',
			day: 'numeric',
		}).format(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)));
	}

	function render() {
		var host = document.getElementById('days');
		host.textContent = '';

		var dates = state.view === 'week' ? weekDays(state.anchor) : [state.anchor];
		var all = [];
		dates.forEach(function (d) { all = all.concat(byDate[d] || []); });
		var shown = all.filter(passes);

		host.appendChild(renderBand(all));
		host.appendChild(renderFilters(shown.length, all.length));

		dates.forEach(function (d) {
			host.appendChild(renderDay(d, (byDate[d] || []).filter(passes)));
		});

		document.getElementById('range').textContent =
			state.view === 'week'
				? shortDate(dates[0]) + ' – ' + formatDayHeading(dates[6]).replace(/^\w+, /, '')
				: formatDayHeading(state.anchor);

		set('view-week', state.view === 'week');
		set('view-day', state.view === 'day');
		set('tz-et', state.mode === 'ET');
		set('tz-local', state.mode === 'local');

		renderDesk();
	}

	function set(id, on) {
		document.getElementById(id).setAttribute('aria-pressed', on ? 'true' : 'false');
	}

	function step(dir) {
		state.anchor = addDays(state.anchor, dir * (state.view === 'week' ? 7 : 1));
		state.open = null;
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
		var t = ev.target;
		var typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
		if (ev.key === 'Escape' && typing) {
			state.query = '';
			render();
			return;
		}
		if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;

		if (ev.key === '/') {
			ev.preventDefault();
			var input = document.querySelector('.search input');
			if (input) input.focus();
		} else if (ev.key === 'ArrowLeft') step(-1);
		else if (ev.key === 'ArrowRight') step(1);
		else if (ev.key === 't' || ev.key === 'T') { state.anchor = TODAY; render(); }
		else if (ev.key === 'w' || ev.key === 'W') { state.view = 'week'; render(); }
		else if (ev.key === 'd' || ev.key === 'D') { state.view = 'day'; render(); }
	});

	renderBoard();
	renderTicker();
	render();
})();
