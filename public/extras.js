// extras.js: search, duplicate suggestions, reporting and moderation screens.
//
// Loaded after app.js (see index.html). It does NOT edit app.js: it reuses its helpers
// (state, $, el, request, setMessage, loadDetail, ...) and wraps three of its functions
// (renderDetail, loadDetail, showSignedIn/showSignedOut) to add the extra controls.
// All text goes through textContent (via el()), so nothing user-written is ever inserted as HTML.
(() => {
  const isModerator = () => Boolean(state.user)
    && (state.user.role === 'admin' || (state.user.role === 'teacher' && state.user.profile?.isVerified === true));

  function ago(iso) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h`;
    return `${Math.round(minutes / 1440)} days`;
  }

  function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  // ---------------------------------------------------------------- search
  function resultCard(item, actionLabel, onAction) {
    const card = el('div', 'result-card');
    const top = el('div', 'post-meta');
    top.append(el('span', 'subject-pill', item.subject_code || ''));
    top.append(el('span', `status-${item.status}`, `• ${item.status}`));
    if (typeof item.similarity === 'number') top.append(el('span', 'similarity', `${Math.round(item.similarity * 100)}% match`));
    const title = el('p', 'result-title', item.title);
    const open = button(actionLabel, 'button button-quiet', () => onAction(item));
    card.append(top, title, open);
    return card;
  }

  function buildSearch() {
    if ($('#search-box')) return;
    const box = el('section', 'search-box');
    box.id = 'search-box';
    const form = el('form', 'search-form');
    const input = document.createElement('input');
    input.id = 'search-input'; input.type = 'search'; input.maxLength = 300;
    input.placeholder = 'Search by meaning, e.g. "BCNF vs 3NF"'; input.setAttribute('aria-label', 'Search doubts');
    const go = el('button', 'button button-primary', 'Search'); go.type = 'submit';
    const clear = button('Clear', 'button button-quiet'); clear.hidden = true;
    form.append(input, go, clear);
    const note = el('p', 'muted search-note'); note.id = 'search-note';
    const results = el('div', 'search-results'); results.id = 'search-results';
    box.append(form, note, results);
    $('#feed-view').insertBefore(box, $('#feed-view').firstChild);

    const reset = () => { results.replaceChildren(); note.textContent = ''; clear.hidden = true; };
    clear.addEventListener('click', () => { input.value = ''; reset(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const q = input.value.trim();
      if (q.length < 3) { note.textContent = 'Type at least 3 characters.'; return; }
      go.disabled = true; note.textContent = 'Searching…';
      try {
        const data = await request(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
        results.replaceChildren();
        clear.hidden = false;
        if (!data.results.length) {
          note.textContent = '';
          results.append(el('div', 'empty', 'Nothing similar yet. Try other words, or ask it as a new doubt.'));
        } else {
          note.textContent = data.mode === 'keyword'
            ? 'Smart search is offline, so these are keyword matches.'
            : `${data.results.length} similar ${data.results.length === 1 ? 'doubt' : 'doubts'}, best match first`;
          for (const item of data.results) results.append(resultCard(item, 'Open', (hit) => loadDetail(hit.post_id)));
        }
      } catch (error) { note.textContent = error.message; }
      finally { go.disabled = false; }
    });
  }

  // ------------------------------------------------- duplicate suggestions
  function buildDuplicateCheck() {
    const form = $('#post-form');
    if (!form || $('#dup-box')) return;
    const box = el('div', 'dup-box span-two');
    box.id = 'dup-box'; box.hidden = true; box.setAttribute('role', 'status');
    form.insertBefore(box, form.querySelector('.form-footer'));

    let timer = null; let sequence = 0;
    const hide = () => { box.hidden = true; box.replaceChildren(); };
    async function check() {
      const title = form.elements.title.value.trim();
      if (title.length < 8) { hide(); return; }
      const mine = ++sequence;
      try {
        const data = await request('/api/search/duplicates', {
          method: 'POST',
          body: JSON.stringify({ title, body: form.elements.body.value, subjectId: $('#subject').value || null }),
        });
        if (mine !== sequence) return;            // a newer keystroke already started another check
        if (!data.available || !data.duplicates.length) { hide(); return; }
        box.replaceChildren(
          el('strong', '', 'This looks like a doubt that was already asked'),
          el('p', 'muted', 'Take a look before you publish. Your draft stays here.'),
        );
        for (const item of data.duplicates) {
          box.append(resultCard(item, 'Open it', (hit) => { $('#composer').hidden = true; loadDetail(hit.post_id); }));
        }
        box.hidden = false;
      } catch { hide(); }                          // never get in the way of writing a doubt
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 700); };
    form.elements.title.addEventListener('input', schedule);
    form.elements.body.addEventListener('input', schedule);
    form.addEventListener('reset', () => { clearTimeout(timer); sequence += 1; hide(); });
  }

  // ------------------------------------------------------------- reporting
  function makeReport(target) {
    const wrap = el('span', 'report-wrap');
    const open = button('Report', 'link-button');
    const form = el('form', 'report-form'); form.hidden = true;
    const reason = document.createElement('input');
    reason.type = 'text'; reason.maxLength = 1000; reason.required = true; reason.minLength = 3;
    reason.placeholder = 'What is wrong with this?'; reason.setAttribute('aria-label', 'Reason for reporting');
    const send = el('button', 'button button-quiet', 'Send report'); send.type = 'submit';
    const cancel = button('Cancel', 'link-button');
    const message = el('span', 'report-message'); message.setAttribute('role', 'status');
    form.append(reason, send, cancel);
    open.addEventListener('click', () => { form.hidden = false; open.hidden = true; message.textContent = ''; reason.focus(); });
    cancel.addEventListener('click', () => { form.hidden = true; open.hidden = false; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      send.disabled = true;
      try {
        await request('/api/reports', { method: 'POST', body: JSON.stringify({ ...target, reason: reason.value }) });
        form.hidden = true; reason.value = '';
        message.style.color = '#27805a'; message.textContent = 'Thanks. A moderator will take a look.';
      } catch (error) {
        message.style.color = ''; message.textContent = error.message; form.hidden = true; open.hidden = false;
      } finally { send.disabled = false; }
    });
    wrap.append(open, form, message);
    return wrap;
  }

  // -------------------------------------------- moderator: merge a duplicate
  function makeMergeTool(post) {
    const wrap = el('div', 'merge-tool');
    const open = button('Mark as duplicate…', 'button button-quiet');
    const panel = el('div', 'merge-panel'); panel.hidden = true;
    const form = el('form', 'search-form');
    const input = document.createElement('input');
    input.type = 'search'; input.value = post.title; input.maxLength = 300; input.setAttribute('aria-label', 'Find the original doubt');
    const go = el('button', 'button button-primary', 'Find original'); go.type = 'submit';
    form.append(input, go);
    const message = el('p', 'message'); message.setAttribute('role', 'status');
    const results = el('div', 'search-results');
    panel.append(el('p', 'muted', 'Find the doubt that already answers this one, then merge into it. Answers stay visible under the original.'), form, message, results);
    open.addEventListener('click', () => { panel.hidden = !panel.hidden; });

    async function merge(original) {
      if (!window.confirm(`Merge this doubt into “${original.title}”? This closes this doubt.`)) return;
      try {
        await request('/api/moderation/merge', {
          method: 'POST', body: JSON.stringify({ duplicatePostId: post.post_id, originalPostId: original.post_id }),
        });
        await loadFeed();
        await loadDetail(original.post_id);
      } catch (error) { message.textContent = error.message; }
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.style.color = ''; message.textContent = 'Searching…'; results.replaceChildren();
      try {
        const data = await request(`/api/search?q=${encodeURIComponent(input.value.trim())}&limit=8&excludePostId=${encodeURIComponent(post.post_id)}`);
        message.textContent = data.results.length ? '' : 'No other doubts found.';
        for (const item of data.results) results.append(resultCard(item, 'Merge into this one', merge));
      } catch (error) { message.textContent = error.message; }
    });
    wrap.append(open, panel);
    return wrap;
  }

  // ----------------------------------------------- wrap app.js's renderDetail
  const baseRenderDetail = renderDetail;
  renderDetail = function renderDetailWithExtras(post) {
    baseRenderDetail(post);
    const root = $('#detail-content');
    const header = root.querySelector('.detail-header');
    if (!header) return;

    if (post.merged_into) {
      const banner = el('div', 'notice');
      banner.append(el('span', '', 'This doubt was merged into an earlier one that covers the same question. '),
        button('Open the original', 'link-button', () => loadDetail(post.merged_into)));
      root.insertBefore(banner, header);
    }

    const tools = el('div', 'detail-tools');
    tools.append(makeReport({ postId: post.post_id }));
    if (isModerator() && !post.merged_into) tools.append(makeMergeTool(post));
    header.append(tools);

    const cards = root.querySelectorAll('.answer-card');
    post.answers.forEach((answer, index) => {
      const card = cards[index];
      if (!card) return;
      const author = card.querySelector('.answer-author');
      if (answer.from_merged_duplicate) {
        // This answer lives on a merged duplicate. Voting, accepting and commenting for it happen
        // on that duplicate's own page, so the controls are switched off here.
        card.querySelectorAll('button, textarea').forEach((node) => { node.disabled = true; });
        author.append(el('span', 'merged-badge', 'FROM A MERGED DUPLICATE'));
      }
      author.append(makeReport({ answerId: answer.answer_id }));
    });
  };

  // ------------------------------------------------------ moderation screen
  function table(title, columns, rows) {
    const section = el('section', 'mod-section');
    section.append(el('h3', '', title));
    if (!rows.length) { section.append(el('p', 'muted', 'Nothing to show.')); return section; }
    const wrapper = el('div', 'table-scroll');
    const t = el('table', 'data-table');
    const head = el('tr');
    for (const [label] of columns) head.append(el('th', '', label));
    t.append(head);
    for (const row of rows) {
      const tr = el('tr');
      for (const [, key] of columns) tr.append(el('td', '', String(row[key] ?? '')));
      t.append(tr);
    }
    wrapper.append(t); section.append(wrapper);
    return section;
  }

  function buildModeration() {
    if ($('#mod-view')) return;
    const view = el('section', 'panel detail'); view.id = 'mod-view'; view.hidden = true;
    const back = button('← All doubts', 'back-link', () => { view.hidden = true; $('#feed-view').hidden = false; });
    const content = el('div'); content.id = 'mod-content';
    view.append(back, content);
    $('#detail-view').after(view);

    const open = button('Moderation', 'button button-quiet', async () => {
      $('#feed-view').hidden = true; $('#detail-view').hidden = true; $('#composer').hidden = true;
      view.hidden = false;
      await loadModeration();
    });
    open.id = 'open-moderation'; open.hidden = true;
    $('#new-question').after(open);
  }

  async function loadModeration() {
    const content = $('#mod-content');
    content.replaceChildren(el('p', 'muted', 'Loading…'));
    try {
      const [queue, dash] = await Promise.all([request('/api/moderation/queue'), request('/api/moderation/dashboard')]);
      content.replaceChildren(el('h2', '', 'Moderation'));

      const section = el('section', 'mod-section');
      section.append(el('h3', '', `Review queue (${queue.reports.length} pending)`));
      if (!queue.reports.length) section.append(el('div', 'empty', 'No reports waiting. Nice and quiet.'));
      for (const report of queue.reports) {
        const item = el('div', 'mod-item');
        const meta = el('div', 'post-meta');
        meta.append(el('span', 'subject-pill', report.target_type === 'post' ? 'Doubt' : 'Answer'), el('span', '', `waiting ${ago(report.created_at)}`));
        const status = el('p', 'message'); status.setAttribute('role', 'status');
        const decide = async (decision) => {
          try {
            await request(`/api/moderation/reports/${report.report_id}/review`, { method: 'POST', body: JSON.stringify({ decision }) });
            await loadModeration();
          } catch (error) { status.textContent = error.message; }
        };
        const actions = el('div', 'mod-actions');
        actions.append(
          button('Open', 'button button-quiet', () => loadDetail(report.post_id)),
          button('Dismiss', 'button button-quiet', () => decide('dismissed')),
          button('Action taken', 'button button-primary', () => decide('actioned')),
        );
        item.append(meta, el('p', 'result-title', report.preview), el('p', 'muted', `Reason: ${report.reason}`), actions, status);
        section.append(item);
      }
      content.append(section);

      content.append(el('h3', 'answers-heading', `Dashboard (last ${dash.days} days)`));
      content.append(table('Most reported', [['Type', 'kind'], ['Preview', 'preview'], ['Reports', 'total_reports'], ['Pending', 'pending']], dash.mostReported));
      content.append(table('Reports by subject', [['Subject', 'subject_code'], ['Reports', 'reports'], ['Pending', 'pending'], ['Actioned', 'actioned'], ['Dismissed', 'dismissed']], dash.reportsBySubject));
      content.append(table('Trending topics', [['Subject', 'subject_code'], ['Topic', 'topic_name'], ['New doubts', 'new_doubts'], ['Answers', 'answers']], dash.trendingTopics));
      content.append(table('Unanswered for over 48 hours', [['Subject', 'subject_code'], ['Unanswered', 'unanswered'], ['Oldest', 'oldest']], dash.agingUnanswered.map((r) => ({ ...r, oldest: new Date(r.oldest).toLocaleDateString() }))));
      const health = el('p', 'muted', dash.postsMissingEmbedding === 0
        ? 'Search index: every doubt is indexed.'
        : `Search index: ${dash.postsMissingEmbedding} doubt(s) are waiting to be indexed (they appear in search after the next retry).`);
      content.append(health);
    } catch (error) { content.replaceChildren(el('p', 'message', error.message)); }
  }

  // ------------------------------------------------------- wire into app.js
  const baseLoadDetail = loadDetail;
  loadDetail = function loadDetailWithExtras(postId) {
    const mod = $('#mod-view');
    if (mod) mod.hidden = true;
    return baseLoadDetail(postId);
  };

  function setup() {
    buildSearch();
    buildDuplicateCheck();
    buildModeration();
    $('#open-moderation').hidden = !isModerator();
    $('#mod-view').hidden = true;
  }

  const baseShowSignedIn = showSignedIn;
  showSignedIn = function showSignedInWithExtras(user) {
    baseShowSignedIn(user);
    setup();
  };
  const baseShowSignedOut = showSignedOut;
  showSignedOut = function showSignedOutWithExtras() {
    baseShowSignedOut();
    const mod = $('#mod-view'); if (mod) mod.hidden = true;
    const results = $('#search-results'); if (results) results.replaceChildren();
    const note = $('#search-note'); if (note) note.textContent = '';
  };

  if (state.user) setup();   // already signed in before this file ran
})();
