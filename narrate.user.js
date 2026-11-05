// ==UserScript==
// @name         GitHub Narrator
// @namespace    https://github.com/cheeseshadow/github-narrator
// @version      0.4.1
// @license      MIT
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
    boilerplate: { collapsed: false },
    move: { collapsed: false },
    order: { collapsed: false },
  };
  const TAG_LINE = /^narrate:\s*([a-z]+)\s*(?:,\s*(\d+))?\s*$/i;
  const STATE = Symbol('narrate');
  const ORIGINAL_INDEX = Symbol('narrate-index');
  const OWNER = Symbol('narrate-owner');
  const DIFF_LIST = '[data-testid="progressive-diffs-list"]';
  const rankByFile = new Map();
  const log = (...args) => console.log('narrate:', ...args);
  log('script loaded on', location.href);

  const style = document.createElement('style');
  style.textContent = `
    tr[data-narrate="dim"] > td { background-color: var(--bgColor-muted, #f6f8fa) !important; color: var(--fgColor-muted, #59636e) !important; opacity: 0.75; }
    tr[data-narrate="dim"] > td:has(> code.addition) { background-color: color-mix(in srgb, var(--bgColor-muted, #f6f8fa) 70%, var(--diffBlob-additionLine-bgColor, var(--diffBlob-addition-bgColor-line))) !important; }
    tr[data-narrate="dim"] > td:has(> code.deletion) { background-color: color-mix(in srgb, var(--bgColor-muted, #f6f8fa) 70%, var(--diffBlob-deletionLine-bgColor, var(--diffBlob-deletion-bgColor-line))) !important; }
    tr[data-narrate="dim"]:has(code.addition) > td:not(.diff-text-cell) { background-color: color-mix(in srgb, var(--bgColor-muted, #f6f8fa) 70%, var(--diffBlob-additionNum-bgColor, var(--diffBlob-addition-bgColor-num))) !important; }
    tr[data-narrate="dim"]:has(code.deletion) > td:not(.diff-text-cell) { background-color: color-mix(in srgb, var(--bgColor-muted, #f6f8fa) 70%, var(--diffBlob-deletionNum-bgColor, var(--diffBlob-deletion-bgColor-num))) !important; }
    tr[data-narrate="dim"] > td code, tr[data-narrate="dim"] > td code * { color: var(--fgColor-muted, #59636e) !important; }
    tr[data-narrate="dim"] > td:first-child { box-shadow: inset 4px 0 0 var(--borderColor-muted, #d1d9e0); }
    tr[data-narrate="main"] > td { background-color: var(--bgColor-accent-muted, #ddf4ff) !important; }
    tr[data-narrate="main"] > td:has(> code.addition) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-additionLine-bgColor, var(--diffBlob-addition-bgColor-line))) !important; }
    tr[data-narrate="main"] > td:has(> code.deletion) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-deletionLine-bgColor, var(--diffBlob-deletion-bgColor-line))) !important; }
    tr[data-narrate="main"]:has(code.addition) > td:not(.diff-text-cell) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-additionNum-bgColor, var(--diffBlob-addition-bgColor-num))) !important; }
    tr[data-narrate="main"]:has(code.deletion) > td:not(.diff-text-cell) { background-color: color-mix(in srgb, var(--bgColor-accent-muted, #ddf4ff) 50%, var(--diffBlob-deletionNum-bgColor, var(--diffBlob-deletion-bgColor-num))) !important; }
    tr[data-narrate="main"] > td:first-child { box-shadow: inset 4px 0 0 var(--fgColor-accent, #0969da); }
    tr.narrate-label.narrate-label-main > td { background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); box-shadow: inset 4px 0 0 var(--fgColor-accent, #0969da); }
    tr.narrate-label.narrate-label-main > td > b { color: var(--fgColor-accent, #0969da); }
    tr[data-narrate-collapsed] { display: none; }
    tr.narrate-label > td {
      padding: 2px 12px;
      font: 12px var(--fontStack-sansSerif, sans-serif);
      color: var(--fgColor-muted, #59636e);
      background: var(--bgColor-muted, #f6f8fa);
      cursor: pointer;
      user-select: none;
    }
    tr.narrate-label > td > b { color: var(--fgColor-default, #1f2328); margin-right: 6px; }
    [data-narrate-thread-hidden] { display: none !important; }
  `;
  document.head.append(style);

  function prKey() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return m ? { key: m[0] } : null;
  }

  function rangeFromHeading(thread) {
    const wrapper = thread.closest('[data-inline-markers] > *');
    const heading = wrapper && wrapper.querySelector('h2');
    if (!heading) return null;
    const refs = [...heading.querySelectorAll('span')].map((e) => e.textContent.trim().match(/^([LR])(\d+)$/)).filter(Boolean);
    if (refs.length === 0) return null;
    return { side: refs[0][1] === 'L' ? 'left' : 'right', start: Number(refs[0][2]), end: Number(refs[refs.length - 1][2]) };
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
    state.rows.forEach((r) => r.toggleAttribute('data-narrate-collapsed', collapsed));
  }

  function hideThread(thread) {
    const replies = thread.querySelectorAll('.markdown-body').length > 1;
    const wrapper = thread.closest('[data-inline-markers] > *') || thread;
    wrapper.toggleAttribute('data-narrate-thread-hidden', !replies);
    const markers = thread.closest('[data-inline-markers]');
    if (!markers) return;
    const threadWrappers = [...markers.children].filter((c) => c.querySelector('[data-testid="review-thread"]'));
    markers.toggleAttribute('data-narrate-thread-hidden', threadWrappers.every((c) => c.hasAttribute('data-narrate-thread-hidden')));
  }

  function render(thread, info, rows, collapsed, range) {
    const state = { label: document.createElement('tr'), rows, collapsed };
    for (const r of rows) r.dataset.narrate = info.tag === 'main' ? 'main' : 'dim';
    setCollapsed(state, collapsed);

    state.label.className = `narrate-label narrate-label-${info.tag}`;
    const td = document.createElement('td');
    td.colSpan = 100;
    const b = document.createElement('b');
    b.textContent = info.tag;
    td.append(b, `${info.reason}${info.reason ? ' · ' : ''}${rows.length} lines`);
    state.label.append(td);
    state.label.addEventListener('click', () => setCollapsed(state, !state.collapsed));
    state.label[OWNER] = thread;
    rows[0].before(state.label);
    log('rendered', info.tag, 'over', rows.length, 'rows', range ? 'by range' : 'by hunk');

    hideThread(thread);
    thread[STATE] = state;
  }

  function clear(thread) {
    const state = thread[STATE];
    delete thread[STATE];
    if (!state) return;
    state.label.remove();
    state.rows.forEach((r) => {
      delete r.dataset.narrate;
      r.removeAttribute('data-narrate-collapsed');
    });
  }

  function takenByAnother(firstRow, thread) {
    const label = firstRow.previousElementSibling;
    if (!label || !label.classList.contains('narrate-label')) return false;
    const owner = label[OWNER];
    if (owner !== thread && owner.isConnected && owner[STATE] && intact(owner[STATE])) return true;
    label.remove();
    return false;
  }

  function intact(state) {
    return state.label.isConnected && state.rows.every((r) => r.isConnected);
  }

  function apply(thread) {
    const state = thread[STATE];
    if (state && intact(state)) return;
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
    const range = rangeFromHeading(thread);
    const rows = range ? rowsInRange(row, range) : rowsInHunk(row);
    if (rows.length === 0) return;
    if (takenByAnother(rows[0], thread)) {
      hideThread(thread);
      return;
    }
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
