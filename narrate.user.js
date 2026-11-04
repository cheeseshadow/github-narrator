// ==UserScript==
// @name         GitHub Narrator
// @namespace    https://github.com/cheeseshadow/github-narrator
// @version      0.1.1
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
  };
  const TAG_LINE = /^narrate:\s*([a-z]+)\s*(.*)$/i;
  const TOKEN_KEY = 'narrate.token';
  const STATE = Symbol('narrate');
  const log = (...args) => console.log('narrate:', ...args);
  log('script loaded on', location.href);

  const style = document.createElement('style');
  style.textContent = `
    tr.narrate-dim > td { opacity: 0.4; }
    tr.narrate-main > td:first-child { box-shadow: inset 4px 0 0 var(--fgColor-accent, #0969da); }
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
    const line = body.textContent.trim().split('\n')[0].trim();
    const m = line.match(TAG_LINE);
    if (!m || !TAGS[m[1].toLowerCase()]) return null;
    return { tag: m[1].toLowerCase(), reason: m[2].trim(), commentId: first.id.replace(/^r/, '') };
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

  function render(thread, info, rows, collapsed, range) {
    const state = { label: document.createElement('tr'), rows, collapsed };
    for (const r of rows) {
      r.classList.toggle('narrate-dim', info.tag !== 'main');
      r.classList.toggle('narrate-main', info.tag === 'main');
    }
    setCollapsed(state, collapsed);

    state.label.className = 'narrate-label';
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

    const replies = thread.querySelectorAll('.markdown-body').length > 1;
    const wrapper = thread.closest('[data-inline-markers] > *') || thread;
    wrapper.classList.toggle('narrate-thread-hidden', !replies);
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
    log('tag comment', info.commentId, info.tag, JSON.stringify(info.reason));
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
    }, 150);
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
