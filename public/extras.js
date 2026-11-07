// extras.js: search, duplicate suggestions, reporting and moderation screens.
//
// Loaded after app.js (see index.html). It does NOT edit app.js: it reuses its helpers
// (state, $, el, request, setMessage, loadDetail, ...) and wraps three of its functions
// (renderDetail, loadDetail, showSignedIn/showSignedOut) to add the extra controls.
// All text goes through textContent (via el()), so nothing user-written is ever inserted as HTML.
(() => {
  const isModerator = () => Boolean(state.user)
    && (state.user.role === 'admin' || (state.user.role === 'teacher' && state.user.profile?.isVerified === true));
  let moderationCourseBy = 'id';

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

  function barChart(title, rows, labelFor, valueKey, valueName, onSelect = null) {
    const section = el('section', 'mod-chart');
    section.append(el('h3', '', title));
    if (!rows.length) { section.append(el('p', 'muted', 'No data for this period.')); return section; }
    const max = Math.max(1, ...rows.map((row) => Number(row[valueKey]) || 0));
    const bars = el('div', 'chart-bars');
    for (const row of rows) {
      const line = el('div', 'chart-row');
      const label = el('span', 'chart-label', labelFor(row));
      label.title = label.textContent;
      if (onSelect) {
        line.classList.add('chart-row-interactive');
        line.tabIndex = 0; line.setAttribute('role', 'button');
        line.setAttribute('aria-label', `Open ${label.textContent}`);
        line.addEventListener('click', () => onSelect(row));
        line.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row); }
        });
      }
      const track = el('div', 'chart-track');
      const fill = el('div', 'chart-fill');
      const value = Number(row[valueKey]) || 0;
      fill.style.width = `${value ? Math.max(3, value / max * 100) : 0}%`;
      track.append(fill);
      line.append(label, track, el('strong', 'chart-value', `${value} ${valueName}`));
      bars.append(line);
    }
    section.append(bars);
    return section;
  }

  function reportStatusChart(rows, courseKey, selectedStatus = null) {
    const section = el('section', 'mod-chart');
    section.id = 'report-status-chart';
    section.append(el('h3', '', 'Report outcomes by course'));
    if (!rows.length) { section.append(el('p', 'muted', 'No reports to chart.')); return section; }
    const max = Math.max(1, ...rows.map((row) => Number(row.reports) || 0));
    const legend = el('div', 'chart-legend');
    for (const [name, cls] of [['Pending', 'pending'], ['Actioned', 'actioned'], ['Dismissed', 'dismissed']]) {
      const key = el('span', 'legend-item', name);
      key.prepend(el('i', `legend-swatch ${cls}`));
      legend.append(key);
    }
    const bars = el('div', 'chart-bars');
    for (const row of rows) {
      const line = el('div', 'chart-row');
      const total = Number(row.reports) || 0;
      const label = el('span', 'chart-label', row[courseKey]);
      const track = el('div', 'chart-track chart-stack-track');
      const statuses = [['pending', 'pending'], ['actioned', 'actioned'], ['dismissed', 'dismissed']]
        .filter(([key]) => !selectedStatus || key === selectedStatus);
      for (const [key, cls] of statuses) {
        const segment = el('div', `chart-segment ${cls}`);
        segment.style.width = `${total ? Number(row[key] || 0) / max * 100 : 0}%`;
        segment.title = `${key}: ${row[key] || 0}`;
        track.append(segment);
      }
      line.append(label, track, el('strong', 'chart-value', `${total} reports`));
      bars.append(line);
    }
    section.append(legend, bars);
    return section;
  }

  function pieChart(title, slices, onSelect = null) {
    const section = el('section', 'mod-chart');
    section.append(el('h3', '', title));
    const total = slices.reduce((sum, slice) => sum + Number(slice.value || 0), 0);
    if (!total) { section.append(el('p', 'muted', 'No reports to chart.')); return section; }
    const colors = { pending: '#d99c3b', actioned: '#4c8a65', dismissed: '#9aa4b1' };
    const wrap = el('div', 'pie-layout');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${title}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(', ')}`);
    svg.classList.add('pie-svg');
    let selectedKey = null;
    const activate = (key) => {
      if (!onSelect) return;
      selectedKey = selectedKey === key ? null : key;
      onSelect(selectedKey);
      legend.querySelectorAll('button[data-status]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item.dataset.status === selectedKey));
      });
    };
    const active = slices.filter((slice) => Number(slice.value) > 0);
    if (active.length === 1) {
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      circle.setAttribute('cx', '60'); circle.setAttribute('cy', '60'); circle.setAttribute('r', '58');
      circle.setAttribute('fill', colors[active[0].key]);
      if (onSelect) {
        circle.classList.add('pie-slice-interactive'); circle.setAttribute('tabindex', '0');
        circle.setAttribute('role', 'button'); circle.setAttribute('aria-label', `Filter by ${active[0].label}`);
        circle.addEventListener('click', () => activate(active[0].key));
        circle.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(active[0].key); }
        });
      }
      svg.append(circle);
    } else {
      let start = -90;
      for (const slice of active) {
        const sweep = Number(slice.value) / total * 360;
        const end = start + sweep;
        const rad = Math.PI / 180;
        const x1 = 60 + 58 * Math.cos(start * rad); const y1 = 60 + 58 * Math.sin(start * rad);
        const x2 = 60 + 58 * Math.cos(end * rad); const y2 = 60 + 58 * Math.sin(end * rad);
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', `M 60 60 L ${x1} ${y1} A 58 58 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2} Z`);
        path.setAttribute('fill', colors[slice.key]);
        path.setAttribute('stroke', '#fff'); path.setAttribute('stroke-width', '1');
        if (onSelect) {
          path.classList.add('pie-slice-interactive'); path.setAttribute('tabindex', '0');
          path.setAttribute('role', 'button'); path.setAttribute('aria-label', `Filter by ${slice.label}`);
          path.addEventListener('click', () => activate(slice.key));
          path.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(slice.key); }
          });
        }
        const tip = document.createElementNS(svg.namespaceURI, 'title'); tip.textContent = `${slice.label}: ${slice.value}`;
        path.append(tip); svg.append(path); start = end;
      }
    }
    const legend = el('div', 'pie-legend');
    for (const slice of slices) {
      const item = el(onSelect ? 'button' : 'div', 'pie-legend-item');
      if (onSelect) {
        item.type = 'button'; item.dataset.status = slice.key; item.setAttribute('aria-pressed', 'false');
        item.addEventListener('click', () => activate(slice.key));
      }
      const swatch = el('i', 'legend-swatch'); swatch.style.background = colors[slice.key];
      item.append(swatch, el('span', '', `${slice.label}: ${slice.value}`)); legend.append(item);
    }
    wrap.append(svg, legend); section.append(wrap);
    return section;
  }

  function lineChart(title, rows, onDateSelect = null) {
    const section = el('section', 'mod-chart');
    section.append(el('h3', '', title));
    if (!rows.length) { section.append(el('p', 'muted', 'No date data to chart.')); return section; }
    const width = 760; const height = 250; const left = 42; const right = 16; const top = 16; const bottom = 38;
    const plotWidth = width - left - right; const plotHeight = height - top - bottom;
    const max = Math.max(1, ...rows.map((row) => Number(row.doubts) || 0));
    const x = (index) => left + (rows.length < 2 ? plotWidth / 2 : index / (rows.length - 1) * plotWidth);
    const y = (value) => top + plotHeight - (Number(value) || 0) / max * plotHeight;
    const sectionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sectionSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    sectionSvg.setAttribute('role', 'img');
    sectionSvg.setAttribute('aria-label', `${title}; daily doubt counts over ${rows.length} days`);
    sectionSvg.classList.add('line-svg');
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = Math.round(max * (4 - tick) / 4); const gy = top + plotHeight * tick / 4;
      const grid = document.createElementNS(sectionSvg.namespaceURI, 'line');
      grid.setAttribute('x1', String(left)); grid.setAttribute('x2', String(width - right));
      grid.setAttribute('y1', String(gy)); grid.setAttribute('y2', String(gy)); grid.setAttribute('class', 'line-grid');
      sectionSvg.append(grid);
      const label = document.createElementNS(sectionSvg.namespaceURI, 'text');
      label.setAttribute('x', String(left - 8)); label.setAttribute('y', String(gy + 4)); label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'line-axis-label'); label.textContent = String(value); sectionSvg.append(label);
    }
    const points = rows.map((row, index) => `${x(index)},${y(row.doubts)}`).join(' ');
    const area = document.createElementNS(sectionSvg.namespaceURI, 'polygon');
    area.setAttribute('points', `${left},${top + plotHeight} ${points} ${x(rows.length - 1)},${top + plotHeight}`);
    area.setAttribute('class', 'line-area'); sectionSvg.append(area);
    const line = document.createElementNS(sectionSvg.namespaceURI, 'polyline');
    line.setAttribute('points', points); line.setAttribute('class', 'line-stroke'); sectionSvg.append(line);
    rows.forEach((row, index) => {
      const dot = document.createElementNS(sectionSvg.namespaceURI, 'circle');
      dot.setAttribute('cx', String(x(index))); dot.setAttribute('cy', String(y(row.doubts)));
      dot.setAttribute('r', Number(row.doubts) === max ? '4' : '2'); dot.setAttribute('class', 'line-dot');
      if (onDateSelect) {
        dot.setAttribute('r', Number(row.doubts) === max ? '5' : '3');
        dot.setAttribute('tabindex', '0'); dot.setAttribute('role', 'button');
        dot.setAttribute('aria-label', `Show doubts from ${row.date}: ${row.doubts} doubts`);
        dot.classList.add('line-dot-interactive');
        dot.addEventListener('click', () => onDateSelect(row.date));
        dot.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDateSelect(row.date); }
        });
      }
      const tip = document.createElementNS(sectionSvg.namespaceURI, 'title');
      tip.textContent = `${formatCampusDate(`${row.date}T12:00:00+05:30`, { dateStyle: 'medium' })}: ${row.doubts} doubts`;
      dot.append(tip); sectionSvg.append(dot);
    });
    const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 3), Math.floor((rows.length - 1) * 2 / 3), rows.length - 1])];
    for (const index of labelIndexes) {
      const label = document.createElementNS(sectionSvg.namespaceURI, 'text');
      label.setAttribute('x', String(x(index))); label.setAttribute('y', String(height - 10));
      label.setAttribute('text-anchor', index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle');
      label.setAttribute('class', 'line-axis-label');
      label.textContent = formatCampusDate(`${rows[index].date}T12:00:00+05:30`, { month: 'short', day: 'numeric' });
      sectionSvg.append(label);
    }
    const peak = rows.reduce((best, row) => Number(row.doubts) > Number(best.doubts) ? row : best, rows[0]);
    const note = el('p', 'muted chart-summary', `Peak: ${formatCampusDate(`${peak.date}T12:00:00+05:30`, { dateStyle: 'medium' })} · ${peak.doubts} doubts`);
    section.append(sectionSvg, note);
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
      const [queue, history, dash] = await Promise.all([
        request('/api/moderation/queue'),
        request('/api/moderation/history'),
        request(`/api/moderation/dashboard?courseBy=${moderationCourseBy}`),
      ]);
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

      const historySection = el('section', 'mod-section');
      historySection.append(el('h3', '', `Recently reviewed (${history.reports.length})`));
      if (!history.reports.length) historySection.append(el('p', 'muted', 'No reports have been reviewed yet.'));
      for (const report of history.reports) {
        const item = el('div', 'mod-item');
        const meta = el('div', 'post-meta');
        const decisionLabel = report.status === 'dismissed' ? 'Dismissed' : 'Action taken';
        meta.append(
          el('span', 'subject-pill', report.target_type === 'post' ? 'Doubt' : 'Answer'),
          el('span', report.status === 'dismissed' ? 'status-dismissed' : 'status-actioned', decisionLabel),
        );
        const reviewerLine = `${report.reviewer_name} (${report.reviewer_role}) · ${report.reviewer_email}`;
        const reviewedLine = report.reviewed_at
          ? `Reviewed ${formatCampusDate(report.reviewed_at, { dateStyle: 'medium', timeStyle: 'short' })}`
          : 'Review time unavailable for this older record';
        const actions = el('div', 'mod-actions');
        actions.append(button('Open', 'button button-quiet', () => loadDetail(report.post_id)));
        item.append(meta, el('p', 'result-title', report.preview), el('p', 'muted', `Reason: ${report.reason}`),
          el('p', 'review-audit', `Reviewed by ${reviewerLine}`), el('p', 'muted', reviewedLine), actions);
        historySection.append(item);
      }
      content.append(historySection);

      content.append(el('h3', 'answers-heading', `Dashboard (last ${dash.days} days)`));
      const dashboardControls = el('div', 'dashboard-controls');
      const courseLabel = el('label', '', 'Group reports by');
      courseLabel.htmlFor = 'moderation-course-by';
      const courseSelect = document.createElement('select');
      courseSelect.id = 'moderation-course-by';
      courseSelect.add(new Option('Course ID', 'id'));
      courseSelect.add(new Option('Course name', 'name'));
      courseSelect.value = dash.courseBy;
      courseSelect.addEventListener('change', () => {
        moderationCourseBy = courseSelect.value;
        loadModeration();
      });
      dashboardControls.append(courseLabel, courseSelect, el('span', 'muted', 'Uses the project’s subject ID and name fields.'));
      content.append(dashboardControls);
      const reportTotals = ['pending', 'actioned', 'dismissed'].map((key) => ({
        key,
        label: key[0].toUpperCase() + key.slice(1),
        value: dash.reportsByCourse.reduce((sum, row) => sum + Number(row[key] || 0), 0),
      }));
      const courseKey = dash.courseBy === 'name' ? 'course_name' : 'course_id';
      let selectedReportStatus = null;
      let courseStatusChart = reportStatusChart(dash.reportsByCourse, courseKey);
      content.append(pieChart('Report outcomes', reportTotals, (status) => {
        selectedReportStatus = status;
        const updatedChart = reportStatusChart(dash.reportsByCourse, courseKey, selectedReportStatus);
        courseStatusChart.replaceWith(updatedChart);
        courseStatusChart = updatedChart;
      }));

      async function showDoubtsForDate(date) {
        let details = $('#date-doubt-details');
        if (!details) {
          details = el('section', 'mod-chart date-doubt-details');
          details.id = 'date-doubt-details';
          content.append(details);
        }
        details.replaceChildren(el('h3', '', `Doubts from ${formatCampusDate(`${date}T12:00:00+05:30`, { dateStyle: 'medium' })}`), el('p', 'muted', 'Loading doubts…'));
        try {
          const data = await request(`/api/moderation/doubts?date=${encodeURIComponent(date)}`);
          details.replaceChildren(el('h3', '', `Doubts from ${formatCampusDate(`${date}T12:00:00+05:30`, { dateStyle: 'medium' })}`));
          if (!data.doubts.length) details.append(el('p', 'muted', 'No doubts were created on this date.'));
          for (const doubt of data.doubts) {
            const item = el('div', 'mod-item date-doubt-item');
            const meta = el('div', 'post-meta');
            meta.append(el('span', 'subject-pill', doubt.subject_name), el('span', `status-${doubt.status}`, doubt.status));
            const openDoubt = button('Open doubt', 'button button-quiet', () => loadDetail(doubt.post_id));
            item.append(meta, el('p', 'result-title', doubt.title), el('span', 'muted', `${formatCampusDate(doubt.created_at, { timeStyle: 'short' })} · ${doubt.vote_score} net votes`), openDoubt);
            details.append(item);
          }
        } catch (error) {
          details.replaceChildren(el('h3', '', 'Could not load doubts for this date'), el('p', 'message', error.message));
        }
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      content.append(lineChart(`Doubts created each day (last ${dash.days} days)`, dash.doubtsByDate, showDoubtsForDate));
      content.append(barChart('Most reported items', dash.mostReported, (row) => `${row.kind}: ${row.preview}`, 'total_reports', 'reports', (row) => loadDetail(row.post_id)));
      content.append(courseStatusChart);
      content.append(barChart('Trending topics', dash.trendingTopics, (row) => `${row[courseKey]} · ${row.topic_name}`, 'new_doubts', 'doubts'));
      content.append(barChart('Unanswered doubts by course', dash.agingUnanswered, (row) => row[courseKey], 'unanswered', 'doubts'));
      const peakDates = dash.doubtsByDate.filter((row) => Number(row.doubts) > 0)
        .slice().sort((a, b) => Number(b.doubts) - Number(a.doubts) || a.date.localeCompare(b.date)).slice(0, 10);
      content.append(barChart('Busiest doubt dates', peakDates, (row) => formatCampusDate(`${row.date}T12:00:00+05:30`, { dateStyle: 'medium' }), 'doubts', 'doubts'));
      content.append(table('Most reported', [['Type', 'kind'], ['Preview', 'preview'], ['Reports', 'total_reports'], ['Pending', 'pending']], dash.mostReported));
      content.append(table('Reports by course', [['Course', courseKey], ['Reports', 'reports'], ['Pending', 'pending'], ['Actioned', 'actioned'], ['Dismissed', 'dismissed']], dash.reportsByCourse));
      content.append(table('Trending topics', [['Course', courseKey], ['Topic', 'topic_name'], ['New doubts', 'new_doubts'], ['Answers', 'answers']], dash.trendingTopics));
      content.append(table('Unanswered for over 48 hours', [['Course', courseKey], ['Unanswered', 'unanswered'], ['Oldest', 'oldest']], dash.agingUnanswered.map((r) => ({ ...r, oldest: formatCampusDate(r.oldest, { dateStyle: 'medium' }) }))));
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
