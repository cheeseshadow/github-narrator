// ==UserScript==
// @name         GitHub Narrator
// @namespace    https://github.com/cheeseshadow/github-narrator
// @version      0.2.0
// @description  Renders "narrate:" review comments as block tags on the GitHub pull request Files tab.
// @match        https://github.com/*/pull/*
// @updateURL    https://github.com/cheeseshadow/github-narrator/raw/main/narrate.user.js
// @downloadURL  https://github.com/cheeseshadow/github-narrator/raw/main/narrate.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TAGS = {
    main: { collapsed: false },
    boilerplate: { collapsed: true },
    move: { collapsed: true },
    order: { collapsed: false },
  };
  const TAG_LINE = /^narrate:\s*([a-z]+)\s*(?:,\s*(\d+))?\s*$/i;
  const TOKEN_KEY = 'narrate.token';
  const STATE = Symbol('narrate');
  const ORIGINAL_INDEX = Symbol('narrate-index');
  const DIFF_LIST = '[data-testid="progressive-diffs-list"]';
  const rankByFile = new Map();
  const log = (...args) => console.log('narrate:', ...args);
  log('script loaded on', location.href);

  const style = document.createElement('style');
  style.textContent = `
    tr.narrate-dim > td { opacity: 0.4; }
    tr.narrate-main > td { background-color: var(--bgColor-accent-muted, #ddf4ff) !important; }
    tr.narrate-main > td:has(> code.addition) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-additionLine-bgColor, var(--diffBlob-addition-bgColor-line))) !important; }
    tr.narrate-main > td:has(> code.deletion) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-deletionLine-bgColor, var(--diffBlob-deletion-bgColor-line))) !important; }
    tr.narrate-main:has(code.addition) > td:not(.diff-text-cell) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-additionNum-bgColor, var(--diffBlob-addition-bgColor-num))) !important; }
    tr.narrate-main:has(code.deletion) > td:not(.diff-text-cell) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-deletionNum-bgColor, var(--diffBlob-deletion-bgColor-num))) !important; }
    tr.narrate-main > td:first-child { box-shadow: inset 4px 0 0 var(--fgColor-accent, #0969da); }
    tr.narrate-label.narrate-label-main > td { background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); box-shadow: inset 4px 0 0 var(--fgColor-accent, #0969da); }
    tr.narrate-label.narrate-label-main > td > b { color: var(--fgColor-accent, #0969da); }
    tr.narrate-hidden { display: none; }
    tr.narrate-label > td {
      padding: 2px 12px;
      font: 12px var(--fontStack-sansSerif, sans-serif);
      color: var(--fgColor-muted, #59636e);
      background: var(--bgColor-muted, #f6f8fa);
      cursor: pointer;
      user-select: none;
    }
    tr.narrate-label > td > b { color: var(--fgColor-default, #1f2328); margin-right: 6px; }
    .narrate-thread-hidden { display: none !important; }
  `;
  document.head.append(style);

  let rangesPromise = null;
  let rangesFor = null;

  function prKey() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return m ? { owner: m[1], repo: m[2], number: m[3], key: m[0] } : null;
  }

  async function fetchRanges(pr) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      log('no token in localStorage, tags cover whole hunks');
      return {};
    }
    const ranges = {};
    for (let page = 1; page < 20; page++) {
      const url = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments?per_page=100&page=${page}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
      if (!res.ok) {
        console.warn('narrate: comment fetch failed', res.status);
        return ranges;
      }
      const comments = await res.json();
      log('fetched', comments.length, 'comments from the API');
      for (const c of comments) {
        if (c.line == null) continue;
        ranges[c.id] = { side: c.side.toLowerCase(), start: c.start_line ?? c.line, end: c.line };
      }
      if (comments.length < 100) break;
    }
    return ranges;
  }

  function ranges() {
    const pr = prKey();
    if (!pr) return Promise.resolve({});
    if (rangesFor !== pr.key) {
      rangesFor = pr.key;
      rangesPromise = fetchRanges(pr).then((r) => {
        document.querySelectorAll('[data-testid="review-thread"]').forEach(clear);
        schedule();
        return r;
      });
    }
    return rangesPromise;
  }

  function parseTag(thread) {
    const first = thread.querySelector('[data-first-thread-comment="true"]');
    const body = first && first.querySelector('.markdown-body');
    if (!body) return null;
    const lines = body.textContent.trim().split('\n').map((l) => l.trim());
    const m = lines[0].match(TAG_LINE);
    if (!m || !TAGS[m[1].toLowerCase()]) return null;
    return {
      tag: m[1].toLowerCase(),
      rank: m[2] === undefined ? null : Number(m[2]),
      reason: lines.slice(1).find((l) => l) || '',
      commentId: first.id.replace(/^r/, ''),
    };
  }

  function isHunkHeader(row) {
    return !!row.querySelector('.diff-hunk-cell');
  }

  function rowsInHunk(row) {
    let r = row;
    while (r.previousElementSibling && !isHunkHeader(r.previousElementSibling)) r = r.previousElementSibling;
    const rows = [];
    for (; r && !isHunkHeader(r); r = r.nextElementSibling) {
      if (!r.classList.contains('narrate-label')) rows.push(r);
    }
    return rows;
  }

  function rowsInRange(row, range) {
    return [...row.parentElement.children].filter((r) =>
      [...r.querySelectorAll(`td[data-diff-side="${range.side}"][data-line-number]`)].some((td) => {
        const n = Number(td.dataset.lineNumber);
        return n >= range.start && n <= range.end;
      })
    );
  }

  function setCollapsed(state, collapsed) {
    state.collapsed = collapsed;
    state.rows.forEach((r) => r.classList.toggle('narrate-hidden', collapsed));
  }

  function hideThread(thread) {
    const replies = thread.querySelectorAll('.markdown-body').length > 1;
    const wrapper = thread.closest('[data-inline-markers] > *') || thread;
    wrapper.classList.toggle('narrate-thread-hidden', !replies);
  }

  function render(thread, info, rows, collapsed, range) {
    const state = { label: document.createElement('tr'), rows, collapsed };
    for (const r of rows) {
      r.classList.toggle('narrate-dim', info.tag !== 'main');
      r.classList.toggle('narrate-main', info.tag === 'main');
    }
    setCollapsed(state, collapsed);

    state.label.className = `narrate-label narrate-label-${info.tag}`;
    const td = document.createElement('td');
    td.colSpan = 100;
    const b = document.createElement('b');
    b.textContent = info.tag;
    td.append(b, `${info.reason}${info.reason ? ' · ' : ''}${rows.length} lines`);
    state.label.append(td);
    state.label.addEventListener('click', () => setCollapsed(state, !state.collapsed));
    const stale = rows[0].previousElementSibling;
    if (stale && stale.classList.contains('narrate-label')) stale.remove();
    rows[0].before(state.label);
    log('rendered', info.tag, 'over', rows.length, 'rows', range ? 'by range' : 'by hunk');

    hideThread(thread);
    thread[STATE] = state;
  }

  function clear(thread) {
    const state = thread[STATE];
    delete thread[STATE];
    if (!state || state.pending) return;
    state.label.remove();
    state.rows.forEach((r) => r.classList.remove('narrate-dim', 'narrate-main', 'narrate-hidden'));
  }

  function intact(state) {
    return state.label.isConnected && state.rows.every((r) => r.isConnected);
  }

  async function apply(thread) {
    const state = thread[STATE];
    if (state && (state.pending || intact(state))) return;
    const info = parseTag(thread);
    if (!info) return;
    log('tag comment', info.commentId, info.tag, info.rank, JSON.stringify(info.reason));
    if (info.tag === 'order') {
      hideThread(thread);
      return;
    }
    const row = thread.closest('tr');
    if (!row) return;
    if (state) clear(thread);
    thread[STATE] = { pending: true };
    const range = (await ranges())[info.commentId];
    const rows = range ? rowsInRange(row, range) : rowsInHunk(row);
    delete thread[STATE];
    if (rows.length === 0 || !row.isConnected) return;
    render(thread, info, rows, state ? state.collapsed : TAGS[info.tag].collapsed, range);
  }

  function fileKey(entry) {
    const pr = prKey();
    const diff = entry.querySelector('[id^="diff-"]');
    return pr && diff ? `${pr.key}:${diff.id}` : null;
  }

  function reorder(threads) {
    for (const thread of threads) {
      const info = parseTag(thread);
      const entry = thread.closest(`${DIFF_LIST} > *`);
      const key = entry && fileKey(entry);
      if (!info || info.rank === null || !key) continue;
      rankByFile.set(key, Math.min(info.rank, rankByFile.get(key) ?? Infinity));
    }
    const list = document.querySelector(DIFF_LIST);
    if (!list) return;
    const entries = [...list.children].filter((e) => e.tagName === 'DIV' && e.querySelector('[id^="diff-"]'));
    const rank = (e) => rankByFile.get(fileKey(e)) ?? Infinity;
    if (!entries.some((e) => rank(e) !== Infinity)) return;
    entries.forEach((e, i) => { e[ORIGINAL_INDEX] ??= i; });
    const sorted = [...entries].sort((a, b) => rank(a) - rank(b) || a[ORIGINAL_INDEX] - b[ORIGINAL_INDEX]);
    sorted.forEach((e, i) => {
      if (list.children[i] !== e) {
        list.insertBefore(e, list.children[i] || null);
        log('moved', e.querySelector('[id^="diff-"]').id.slice(0, 13), 'to position', i);
      }
    });
  }

  let pending = false;
  let lastCount = -1;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const threads = document.querySelectorAll('[data-testid="review-thread"]');
      if (threads.length !== lastCount) log('pass over', threads.length, 'review threads');
      lastCount = threads.length;
      threads.forEach(apply);
      reorder(threads);
    }, 150);
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
