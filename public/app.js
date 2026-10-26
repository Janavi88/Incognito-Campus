const state = { token: localStorage.getItem('ic_token'), user: null, subjects: [], currentPostId: null };
const $ = (selector) => document.querySelector(selector);

function setMessage(selector, message = '', good = false) {
  const element = $(selector);
  element.textContent = message;
  element.style.color = good ? '#27805a' : '';
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function showSignedIn(user) {
  state.user = user;
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#session').hidden = false;
  const publicName = user.profile?.anonymousHandle || user.profile?.displayName || user.role;
  $('#identity').textContent = `${publicName} · ${user.role}`;
  $('#new-question').hidden = user.role !== 'student';
}

function showSignedOut() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('ic_token');
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
  $('#session').hidden = true;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadSubjects() {
  const data = await request('/api/subjects');
  state.subjects = data.subjects;
  const select = $('#subject');
  if (!select) return;
  const previousValue = select.value;
  select.replaceChildren(new Option('Choose a subject', ''));
  for (const subject of state.subjects) {
    const option = document.createElement('option');
    option.value = subject.subject_id;
    option.textContent = `${subject.subject_code} · ${subject.subject_name}`;
    select.append(option);
  }
  select.add(new Option('Other / Add a new subject…', '__other__'));
  if (previousValue && Array.from(select.options).some((o) => o.value === previousValue)) {
    select.value = previousValue;
  }
}

function setFieldError(selector, message = '') {
  const element = $(selector);
  if (element) {
    element.textContent = message;
    element.style.display = message ? 'block' : 'none';
  }
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach((element) => {
    element.textContent = '';
    element.style.display = 'none';
  });
}

function updateTopics() {
  const topicSelect = $('#topic');
  if (!topicSelect) return;
  const customTopicGroup = $('#custom-topic-group');
  const customTopicInput = $('#custom-topic');
  const customSubjectGroup = $('#custom-subject-group');
  const customSubjectInput = $('#custom-subject');
  const subjectVal = $('#subject')?.value;

  topicSelect.replaceChildren();

  if (!subjectVal) {
    topicSelect.add(new Option('Choose a subject first', ''));
    if (customTopicGroup) customTopicGroup.hidden = true;
    if (customTopicInput) customTopicInput.value = '';
    if (customSubjectGroup) customSubjectGroup.hidden = true;
    if (customSubjectInput) customSubjectInput.value = '';
    return;
  }

  if (subjectVal === '__other__') {
    if (customSubjectGroup) customSubjectGroup.hidden = false;
    if (customSubjectInput) customSubjectInput.focus();
    topicSelect.add(new Option('+ Enter custom topic…', '__custom__'));
    topicSelect.value = '__custom__';
    if (customTopicGroup) customTopicGroup.hidden = false;
    setFieldError('#subject-error', '');
    setFieldError('#custom-subject-error', '');
    return;
  }

  if (customSubjectGroup) customSubjectGroup.hidden = true;
  if (customSubjectInput) customSubjectInput.value = '';
  setFieldError('#custom-subject-error', '');

  topicSelect.add(new Option('Select a topic (required)', ''));
  const subject = state.subjects.find((item) => item.subject_id === subjectVal);
  for (const item of subject?.topics || []) {
    topicSelect.add(new Option(item.name, item.name));
  }
  topicSelect.add(new Option('+ Enter custom topic…', '__custom__'));

  if (customTopicGroup) customTopicGroup.hidden = true;
  if (customTopicInput) customTopicInput.value = '';
  setFieldError('#topic-error', '');
  setFieldError('#custom-topic-error', '');
}

let teacherSearchTimer = null;
let currentHighlightedIndex = -1;

function clearTeacherSelection() {
  const searchInput = $('#teacher-search');
  const idInput = $('#mentioned-teacher-id');
  const pill = $('#selected-teacher-pill');
  const clearBtn = $('#clear-teacher');
  const dropdown = $('#teacher-dropdown');

  if (searchInput) searchInput.value = '';
  if (idInput) idInput.value = '';
  if (pill) {
    pill.hidden = true;
    pill.textContent = '';
  }
  if (clearBtn) clearBtn.hidden = true;
  if (dropdown) {
    dropdown.hidden = true;
    dropdown.replaceChildren();
  }
  setFieldError('#teacher-error', '');
}

function selectTeacher(teacher) {
  const searchInput = $('#teacher-search');
  const idInput = $('#mentioned-teacher-id');
  const pill = $('#selected-teacher-pill');
  const clearBtn = $('#clear-teacher');
  const dropdown = $('#teacher-dropdown');

  idInput.value = teacher.user_id;
  searchInput.value = teacher.display_name;
  if (pill) {
    pill.textContent = `Mentioning: ${teacher.display_name}${teacher.department ? ` · ${teacher.department}` : ''}`;
    pill.hidden = false;
  }
  if (clearBtn) clearBtn.hidden = false;
  if (dropdown) {
    dropdown.hidden = true;
    dropdown.replaceChildren();
  }
  setFieldError('#teacher-error', '');
}

function setupTeacherAutocomplete() {
  const searchInput = $('#teacher-search');
  const dropdown = $('#teacher-dropdown');
  const clearBtn = $('#clear-teacher');
  if (!searchInput || !dropdown) return;

  async function performSearch() {
    const q = searchInput.value.trim();
    dropdown.replaceChildren();
    currentHighlightedIndex = -1;

    try {
      const data = await request(`/api/teachers?q=${encodeURIComponent(q)}`);
      dropdown.replaceChildren();
      const teachers = data.teachers || [];
      if (!teachers.length) {
        const empty = el('div', 'teacher-option-empty', 'No teachers found');
        dropdown.append(empty);
      } else {
        teachers.forEach((t) => {
          const item = el('div', 'teacher-option');
          item.setAttribute('role', 'option');
          item.setAttribute('tabindex', '0');
          const nameSpan = el('strong', '', t.display_name);
          const deptSpan = el('span', 'muted', t.department ? ` · ${t.department}` : '');
          item.append(nameSpan, deptSpan);

          item.addEventListener('click', () => selectTeacher(t));
          item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectTeacher(t);
            }
          });
          dropdown.append(item);
        });
      }
      dropdown.hidden = false;
    } catch (error) {
      const errEl = el('div', 'teacher-option-empty', error.message || 'Error searching teachers');
      dropdown.replaceChildren(errEl);
      dropdown.hidden = false;
    }
  }

  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    clearTimeout(teacherSearchTimer);
    const pill = $('#selected-teacher-pill');
    if ($('#mentioned-teacher-id').value && (!pill || !pill.textContent.includes(val))) {
      $('#mentioned-teacher-id').value = '';
      if (pill) pill.hidden = true;
    }
    if (!val) {
      dropdown.hidden = true;
      dropdown.replaceChildren();
      if (clearBtn) clearBtn.hidden = true;
      return;
    }
    if (clearBtn) clearBtn.hidden = false;
    teacherSearchTimer = setTimeout(performSearch, 200);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
      performSearch();
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    const options = dropdown.querySelectorAll('.teacher-option');
    if (dropdown.hidden || !options.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      currentHighlightedIndex = (currentHighlightedIndex + 1) % options.length;
      options[currentHighlightedIndex]?.focus();
    } else if (e.key === 'Escape') {
      dropdown.hidden = true;
    }
  });

  dropdown.addEventListener('keydown', (e) => {
    const options = dropdown.querySelectorAll('.teacher-option');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      currentHighlightedIndex = (currentHighlightedIndex + 1) % options.length;
      options[currentHighlightedIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      currentHighlightedIndex = (currentHighlightedIndex - 1 + options.length) % options.length;
      if (currentHighlightedIndex < 0) {
        searchInput.focus();
      } else {
        options[currentHighlightedIndex]?.focus();
      }
    } else if (e.key === 'Escape') {
      dropdown.hidden = true;
      searchInput.focus();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearTeacherSelection();
      searchInput.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.teacher-field-container')) {
      dropdown.hidden = true;
    }
  });
}

function renderPostCard(post) {
  const card = el('article', 'post-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Open doubt: ${post.title}`);
  const meta = el('div', 'post-meta');
  meta.append(el('span', 'subject-pill', `${post.subject_code} · ${post.subject_name}`));
  if (post.topic_name) meta.append(el('span', 'topic-pill', `› ${post.topic_name}`));
  if (post.mentioned_teacher_name) {
    meta.append(el('span', 'teacher-pill', `@${post.mentioned_teacher_name}`));
  }
  meta.append(el('span', `status-${post.status}`, `• ${post.status}`));
  card.append(meta, el('h3', '', post.title), el('p', 'excerpt', post.body));
  const bottom = el('div', 'post-bottom');
  const tags = el('div', 'post-tags');
  for (const tag of post.tags || []) tags.append(el('span', 'tag', `#${tag.name}`));
  const count = el('span', '', `${post.answer_count} ${post.answer_count === 1 ? 'answer' : 'answers'}  ·  ${post.author_name || 'Campus member'}`);
  bottom.append(tags, count);
  card.append(bottom);
  card.addEventListener('click', () => loadDetail(post.post_id));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); loadDetail(post.post_id); }
  });
  return card;
}

function makeVoteControls(endpoint, score, myVote) {
  const controls = el('div', 'vote-controls');
  const up = el('button', `vote-button${myVote === 1 ? ' active' : ''}`, '▲');
  up.type = 'button'; up.setAttribute('aria-label', 'Upvote'); up.setAttribute('aria-pressed', String(myVote === 1));
  const total = el('span', 'vote-score', String(score ?? 0));
  const down = el('button', `vote-button${myVote === -1 ? ' active' : ''}`, '▼');
  down.type = 'button'; down.setAttribute('aria-label', 'Downvote'); down.setAttribute('aria-pressed', String(myVote === -1));
  const message = el('span', 'vote-message');
  const submitVote = async (voteValue) => {
    up.disabled = true; down.disabled = true;
    try {
      await request(endpoint, { method: 'POST', body: JSON.stringify({ voteValue }) });
      await loadDetail(state.currentPostId);
    } catch (error) { message.textContent = error.message; }
    finally { up.disabled = false; down.disabled = false; }
  };
  up.addEventListener('click', () => submitVote(1));
  down.addEventListener('click', () => submitVote(-1));
  controls.append(up, total, down, message);
  return controls;
}

async function loadFeed() {
  const feed = $('#feed');
  feed.replaceChildren();
  setMessage('#feed-message', 'Loading doubts…', true);
  try {
    const data = await request('/api/posts');
    if (!data.posts.length) feed.append(el('div', 'empty', 'No doubts yet. Start a discussion by asking the first one.'));
    else for (const post of data.posts) feed.append(renderPostCard(post));
    setMessage('#feed-message');
  } catch (error) { setMessage('#feed-message', error.message); }
}

function renderDetail(post) {
  const root = $('#detail-content');
  root.replaceChildren();
  const header = el('div', 'detail-header');
  const meta = el('div', 'post-meta');
  meta.append(el('span', 'subject-pill', `${post.subject_code} · ${post.subject_name}`));
  if (post.topic_name) meta.append(el('span', 'topic-pill', `› ${post.topic_name}`));
  if (post.mentioned_teacher_name) {
    meta.append(el('span', 'teacher-pill', `Mentioned: ${post.mentioned_teacher_name}`));
  }
  meta.append(el('span', `status-${post.status}`, `• ${post.status}`));
  header.append(meta, el('h2', '', post.title), el('div', 'post-meta', `Asked by ${post.author_name || 'Campus member'} · ${new Date(post.created_at).toLocaleString()}`));
  const tags = el('div', 'post-tags');
  for (const tag of post.tags || []) tags.append(el('span', 'tag', `#${tag.name}`));
  header.append(tags);
  root.append(header, makeVoteControls(`/api/posts/${post.post_id}/votes`, post.vote_score, post.my_vote), el('p', 'detail-body', post.body));

  const answersTitle = el('h3', 'answers-heading', `${post.answers.length} ${post.answers.length === 1 ? 'answer' : 'answers'}`);
  root.append(answersTitle);
  if (!post.answers.length) root.append(el('div', 'empty', 'No answers yet. Add the first explanation below.'));
  for (const answer of post.answers) {
    const card = el('article', 'answer-card');
    const author = el('div', 'answer-author');
    author.append(document.createTextNode('Answered by '), el('strong', '', answer.author_name || 'Campus member'));
    const canAccept = post.can_accept_as_owner
      || (state.user?.role === 'teacher' && state.user.profile?.isVerified === true);
    if (answer.is_accepted) author.append(el('span', 'accepted-badge', 'ACCEPTED ANSWER'));
    if (canAccept && post.status !== 'closed') {
      const acceptanceButton = el('button', 'button button-quiet accept-button', answer.is_accepted ? 'Mark as not accepted' : 'Accept answer');
      acceptanceButton.type = 'button';
      acceptanceButton.addEventListener('click', async () => {
        acceptanceButton.disabled = true;
        try {
          const action = answer.is_accepted ? 'unaccept' : 'accept';
          await request(`/api/posts/${post.post_id}/answers/${answer.answer_id}/${action}`, { method: 'POST' });
          await loadDetail(post.post_id);
        } catch (error) { acceptanceButton.textContent = error.message; acceptanceButton.disabled = false; }
      });
      author.append(acceptanceButton);
    }
    card.append(author, el('p', 'answer-text', answer.body));
    card.append(makeVoteControls(`/api/posts/${post.post_id}/answers/${answer.answer_id}/votes`, answer.vote_score, answer.my_vote));
    const comments = el('div', 'comments');
    for (const comment of answer.comments || []) {
      const commentNode = el('p', 'comment-item');
      commentNode.append(el('strong', '', comment.authorName || 'Campus member'), document.createTextNode(` · ${comment.body}`));
      comments.append(commentNode);
    }
    const commentForm = el('form', 'comment-form');
    const commentInput = document.createElement('textarea');
    commentInput.name = 'body'; commentInput.required = true; commentInput.maxLength = 5000;
    commentInput.rows = 2; commentInput.placeholder = 'Add a comment to this answer…';
    const commentFooter = el('div', 'form-footer');
    const commentMessage = el('p', 'message'); commentMessage.setAttribute('role', 'status');
    const commentButton = el('button', 'button button-quiet', 'Comment'); commentButton.type = 'submit';
    commentFooter.append(commentMessage, commentButton);
    commentForm.append(commentInput, commentFooter);
    commentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      commentButton.disabled = true;
      try {
        await request(`/api/posts/${post.post_id}/answers/${answer.answer_id}/comments`, {
          method: 'POST', body: JSON.stringify({ body: commentInput.value }),
        });
        formElement.reset();
        await loadDetail(post.post_id);
      } catch (error) { commentMessage.textContent = error.message; }
      finally { commentButton.disabled = false; }
    });
    comments.append(commentForm);
    card.append(comments);
    root.append(card);
  }

  const canAnswer = state.user?.role === 'student'
    || (state.user?.role === 'teacher' && state.user.profile?.isVerified === true);
  if (post.status !== 'closed' && canAnswer) {
    const form = el('form', 'answer-form');
    form.append(el('h3', '', 'Share an answer'));
    const textarea = document.createElement('textarea');
    textarea.name = 'body'; textarea.required = true; textarea.maxLength = 20000;
    textarea.placeholder = 'Explain it in a way that helped you understand…';
    const footer = el('div', 'form-footer');
    const message = el('p', 'message'); message.id = 'answer-message'; message.setAttribute('role', 'status');
    const button = el('button', 'button button-primary', 'Post answer →'); button.type = 'submit';
    footer.append(message, button);
    form.append(textarea, footer);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await request(`/api/posts/${post.post_id}/answers`, { method: 'POST', body: JSON.stringify({ body: textarea.value }) });
        await loadDetail(post.post_id);
      } catch (error) { setMessage('#answer-message', error.message); }
      finally { button.disabled = false; }
    });
    root.append(form);
  }
}

async function loadDetail(postId) {
  state.currentPostId = postId;
  $('#feed-view').hidden = true;
  $('#detail-view').hidden = false;
  $('#detail-content').replaceChildren(el('p', 'muted', 'Loading doubt…'));
  try {
    const data = await request(`/api/posts/${postId}`);
    renderDetail(data.post);
  } catch (error) { $('#detail-content').replaceChildren(el('p', 'message', error.message)); }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage('#login-message', 'Signing in…', true);
  const form = new FormData(event.currentTarget);
  try {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: form.get('identifier'), password: form.get('password') }) });
    state.token = result.token;
    localStorage.setItem('ic_token', result.token);
    showSignedIn(result.user);
    await loadSubjects();
    await loadFeed();
    setMessage('#login-message');
  } catch (error) { setMessage('#login-message', error.message); }
  finally { button.disabled = false; }
});

$('#post-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors();
  setMessage('#post-message');

  const formElement = event.currentTarget;
  const button = formElement.querySelector('button[type="submit"]');
  const form = new FormData(formElement);

  const title = String(form.get('title') || '').trim();
  const body = String(form.get('body') || '').trim();
  const subjectId = String(form.get('subjectId') || '').trim();
  const customSubject = ($('#custom-subject')?.value || '').trim();
  const topicSelect = $('#topic').value;
  const customTopic = ($('#custom-topic')?.value || '').trim();
  const mentionedTeacherId = ($('#mentioned-teacher-id')?.value || '').trim() || null;
  const teacherSearchVal = ($('#teacher-search')?.value || '').trim();

  let hasError = false;

  if (!title) {
    setFieldError('#title-error', 'Please enter a title.');
    hasError = true;
  }
  if (!body) {
    setFieldError('#body-error', 'Please provide a doubt description.');
    hasError = true;
  }
  if (!subjectId) {
    setFieldError('#subject-error', 'Please choose a subject.');
    hasError = true;
  } else if (subjectId === '__other__') {
    if (!customSubject) {
      setFieldError('#custom-subject-error', 'Custom subject name cannot be empty or only whitespace.');
      hasError = true;
    } else if (customSubject.length > 150) {
      setFieldError('#custom-subject-error', 'Subject name must be 150 characters or fewer.');
      hasError = true;
    }
  }

  let finalTopic = '';
  if (!topicSelect) {
    setFieldError('#topic-error', 'Please choose a topic.');
    hasError = true;
  } else if (topicSelect === '__custom__') {
    if (!customTopic) {
      setFieldError('#custom-topic-error', 'Custom topic cannot be empty or only whitespace.');
      hasError = true;
    } else if (customTopic.length > 100) {
      setFieldError('#custom-topic-error', 'Topic name must be 100 characters or fewer.');
      hasError = true;
    } else {
      finalTopic = customTopic;
    }
  } else {
    finalTopic = topicSelect.trim();
  }

  if (teacherSearchVal && !mentionedTeacherId) {
    setFieldError('#teacher-error', 'Please select a teacher from the dropdown, or clear the search field to post without mentioning.');
    hasError = true;
  }

  if (hasError) return;

  button.disabled = true;
  const tags = String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean);

  try {
    const result = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({
        subjectId,
        customSubject: subjectId === '__other__' ? customSubject : undefined,
        topicName: finalTopic,
        title,
        body,
        tags,
        mentionedTeacherId,
      }),
    });
    formElement.reset();
    clearTeacherSelection();
    if ($('#custom-subject-group')) $('#custom-subject-group').hidden = true;
    if ($('#custom-subject')) $('#custom-subject').value = '';
    await loadSubjects();
    updateTopics();
    clearFieldErrors();
    $('#composer').hidden = true;
    setMessage('#post-message', 'Doubt posted.', true);
    await loadFeed();
    await loadDetail(result.post.post_id);
  } catch (error) {
    setMessage('#post-message', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#subject').addEventListener('change', updateTopics);
$('#topic').addEventListener('change', () => {
  const customGroup = $('#custom-topic-group');
  const customInput = $('#custom-topic');
  if ($('#topic').value === '__custom__') {
    if (customGroup) customGroup.hidden = false;
    if (customInput) customInput.focus();
  } else {
    if (customGroup) customGroup.hidden = true;
    if (customInput) customInput.value = '';
  }
  setFieldError('#topic-error', '');
  setFieldError('#custom-topic-error', '');
});

$('#new-question').addEventListener('click', () => {
  $('#composer').hidden = false;
  $('#composer').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#close-composer').addEventListener('click', () => {
  $('#composer').hidden = true;
  if ($('#custom-subject-group')) $('#custom-subject-group').hidden = true;
  if ($('#custom-subject')) $('#custom-subject').value = '';
  clearFieldErrors();
  clearTeacherSelection();
  updateTopics();
});
$('#refresh').addEventListener('click', loadFeed);
$('#back-to-feed').addEventListener('click', () => { $('#detail-view').hidden = true; $('#feed-view').hidden = false; });
$('#logout').addEventListener('click', () => {
  clearTeacherSelection();
  clearFieldErrors();
  showSignedOut();
});

setupTeacherAutocomplete();

async function start() {
  if (!state.token) return;
  try {
    const result = await request('/api/me');
    showSignedIn(result.user);
    await loadSubjects();
    await loadFeed();
  } catch { showSignedOut(); }
}
start();
