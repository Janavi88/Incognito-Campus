// tests/smoke_integration.js: end-to-end check of search, duplicate detection, reporting,
// moderation and merge through the real HTTP API.
//
//   node tests/smoke_integration.js                 service UP     (python search_service.py running)
//   node tests/smoke_integration.js --service-down  service DOWN   (python search_service.py stopped)
//
// Needs: the web app running, a freshly loaded database (this test creates posts, reports and
// a merge), and every user's password set to demo1234 (see README, "Demo logins").
// Settings: BASE_URL (default http://localhost:3000), SEARCH_URL (default http://localhost:8001).
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SEARCH = process.env.SEARCH_URL || 'http://localhost:8001';
const SERVICE_DOWN = process.argv.includes('--service-down');
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

let passed = 0; let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`); }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(identifier) {
  const { status, json } = await api('/api/auth/login', { method: 'POST', body: { identifier, password: PASSWORD } });
  if (status !== 200) throw new Error(`Login failed for ${identifier} (${status}). Did you set the demo passwords?`);
  return json.token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, tries = 20, delay = 300) {
  for (let i = 0; i < tries; i += 1) { const v = await fn(); if (v) return v; await sleep(delay); }
  return null;
}
const unique = `${Date.now().toString(36)}`;

async function main() {
  console.log(`Smoke test against ${BASE}  (${SERVICE_DOWN ? 'search service expected DOWN' : 'search service expected UP'})\n`);
  const [asha, ben, teacher, unverified, admin] = await Promise.all(
    ['PES1UG24AM001', 'PES1UG24AM002', 'FAC001', 'FAC004', 'ADMIN001'].map(login),
  );

  // ---------------------------------------------------------------- posting
  console.log('Posting a doubt');
  const title = `Why does quokka ${unique} normalization lemma fail for zebra relations?`;
  const created = await api('/api/posts', {
    method: 'POST', token: asha,
    body: { subjectId: 'SUB001', topicName: 'Normalization', title, body: `Explain the quokka ${unique} zebra lemma in normalization.`, tags: ['dbms'] },
  });
  check(SERVICE_DOWN ? 'a student can still post while the search service is down' : 'a student can post a doubt', created.status === 201, `status ${created.status}`);
  const postId = created.json.post?.post_id;

  if (SERVICE_DOWN) {
    console.log('\nSearch service DOWN: everything must degrade gracefully');
    const s = await api(`/api/search?q=${encodeURIComponent('normalization lemma')}`, { token: asha });
    check('search falls back to keyword matching', s.status === 200 && s.json.mode === 'keyword', JSON.stringify(s.json).slice(0, 120));
    check('keyword search finds the new post', (s.json.results || []).some((r) => r.post_id === postId));
    const d = await api('/api/search/duplicates', { method: 'POST', token: asha, body: { title, body: 'x' } });
    check('duplicate check reports "unavailable" instead of failing', d.status === 200 && d.json.available === false && d.json.duplicates.length === 0);
    const dash = await api('/api/moderation/dashboard', { token: admin });
    check('dashboard shows the post as waiting to be indexed', dash.status === 200 && dash.json.postsMissingEmbedding >= 1, `missing ${dash.json.postsMissingEmbedding}`);
    const r = await api('/api/reports', { method: 'POST', token: ben, body: { postId, reason: 'test report while search is down' } });
    check('reporting still works', r.status === 201);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }

  // ------------------------------------------------------ embedding + search
  console.log('\nEmbedding and semantic search');
  const indexed = await waitFor(async () => {
    const s = await api(`/api/search?q=${encodeURIComponent(title)}`, { token: asha });
    return s.json.mode === 'semantic' && s.json.results.some((r) => r.post_id === postId) ? s : null;
  });
  check('the new post is embedded automatically and found by search', Boolean(indexed));
  check('search runs in semantic mode', indexed?.json.mode === 'semantic');
  const top = indexed?.json.results[0];
  check('the new post is the best match for its own title', top?.post_id === postId, top?.title);
  const short = await api('/api/search?q=ab', { token: asha });
  check('a query shorter than 3 characters is rejected', short.status === 400);
  const noise = await api(`/api/search?q=${encodeURIComponent('qqqq wwww eeee rrrr')}`, { token: asha });
  check('unrelated words return no results (minimum similarity cutoff)', noise.status === 200 && noise.json.results.length === 0, `${noise.json.results?.length} results`);

  // ---------------------------------------------------------- duplicate check
  console.log('\nDuplicate check while writing');
  const dup = await api('/api/search/duplicates', { method: 'POST', token: ben, body: { title, body: `Explain the quokka ${unique} zebra lemma in normalization.` } });
  check('a near-identical draft is flagged as a duplicate', dup.status === 200 && dup.json.available && dup.json.duplicates.some((d) => d.post_id === postId), JSON.stringify(dup.json).slice(0, 150));
  const fresh = await api('/api/search/duplicates', { method: 'POST', token: ben, body: { title: 'Completely unrelated gardening topic about tomatoes', body: 'soil compost watering' } });
  check('an unrelated draft is not flagged', fresh.status === 200 && fresh.json.duplicates.length === 0);
  check('only students can use the duplicate check', (await api('/api/search/duplicates', { method: 'POST', token: teacher, body: { title } })).status === 403);
  check('it requires sign-in', (await api('/api/search/duplicates', { method: 'POST', body: { title } })).status === 401);

  // ---------------------------------------------------------------- reporting
  console.log('\nReporting');
  const rep = await api('/api/reports', { method: 'POST', token: ben, body: { postId, reason: 'Looks like spam to me' } });
  check('a student can report a doubt', rep.status === 201, JSON.stringify(rep.json));
  const reportId = rep.json.report?.report_id;
  const again = await api('/api/reports', { method: 'POST', token: ben, body: { postId, reason: 'reporting it again' } });
  check('reporting the same doubt twice is refused (409)', again.status === 409, `status ${again.status}`);
  const own = await api('/api/reports', { method: 'POST', token: asha, body: { postId, reason: 'my own post' } });
  check('reporting your own doubt is refused (400)', own.status === 400, `${own.status} ${own.json.error}`);
  check('reporting needs a target', (await api('/api/reports', { method: 'POST', token: ben, body: { reason: 'nothing' } })).status === 400);
  check('reporting needs a reason', (await api('/api/reports', { method: 'POST', token: ben, body: { postId } })).status === 400);
  check('reporting needs sign-in', (await api('/api/reports', { method: 'POST', body: { postId, reason: 'abc' } })).status === 401);
  check('a made-up id is a clean error, not a crash', [400, 404].includes((await api('/api/reports', { method: 'POST', token: ben, body: { postId: 'not-a-uuid', reason: 'abc' } })).status));

  // --------------------------------------------------------------- moderation
  console.log('\nModeration');
  check('a student cannot open the queue (403)', (await api('/api/moderation/queue', { token: ben })).status === 403);
  check('an UNVERIFIED teacher cannot open the queue (403)', (await api('/api/moderation/queue', { token: unverified })).status === 403);
  const queue = await api('/api/moderation/queue', { token: teacher });
  check('a verified teacher sees the pending report', queue.status === 200 && queue.json.reports.some((r) => r.report_id === reportId));
  check('the queue never exposes who reported', !JSON.stringify(queue.json).includes('PES1UG24'));
  const dash = await api('/api/moderation/dashboard', { token: admin });
  check('the dashboard loads for an admin', dash.status === 200 && Array.isArray(dash.json.mostReported) && Array.isArray(dash.json.trendingTopics));
  check('a student cannot open the dashboard (403)', (await api('/api/moderation/dashboard', { token: ben })).status === 403);

  check('a student cannot review a report (403)', (await api(`/api/moderation/reports/${reportId}/review`, { method: 'POST', token: ben, body: { decision: 'dismissed' } })).status === 403);
  check('an invalid decision is refused (400)', (await api(`/api/moderation/reports/${reportId}/review`, { method: 'POST', token: teacher, body: { decision: 'banana' } })).status === 400);
  const decided = await api(`/api/moderation/reports/${reportId}/review`, { method: 'POST', token: teacher, body: { decision: 'dismissed' } });
  check('a verified teacher can dismiss it', decided.status === 200, JSON.stringify(decided.json));
  check('deciding the same report again is refused (409)', (await api(`/api/moderation/reports/${reportId}/review`, { method: 'POST', token: admin, body: { decision: 'actioned' } })).status === 409);
  check('the dismissed report left the queue', !(await api('/api/moderation/queue', { token: teacher })).json.reports.some((r) => r.report_id === reportId));

  // conflict of interest: FAC001 may not review a report about FAC001's own answer
  const detailSeed = await api('/api/posts/40000000-0000-0000-0000-000000000001', { token: ben });
  const teacherAnswer = detailSeed.json.post.answers.find((a) => a.author_name === 'Dr. Anita Rao');
  const r2 = await api('/api/reports', { method: 'POST', token: ben, body: { answerId: teacherAnswer.answer_id, reason: 'I disagree with this answer' } });
  check('an answer can be reported too', r2.status === 201, JSON.stringify(r2.json));
  const conflict = await api(`/api/moderation/reports/${r2.json.report?.report_id}/review`, { method: 'POST', token: teacher, body: { decision: 'dismissed' } });
  check('a reviewer cannot review a report about their own answer (400)', conflict.status === 400, `${conflict.status} ${conflict.json.error}`);
  check('an admin can review it instead', (await api(`/api/moderation/reports/${r2.json.report?.report_id}/review`, { method: 'POST', token: admin, body: { decision: 'actioned' } })).status === 200);

  // -------------------------------------------------------------------- merge
  console.log('\nMerging duplicates');
  const second = await api('/api/posts', {
    method: 'POST', token: ben,
    body: { subjectId: 'SUB001', topicName: 'Normalization', title: `Quokka ${unique} zebra normalization lemma question`, body: 'Same question again.' },
  });
  const dupId = second.json.post?.post_id;
  const ans = await api(`/api/posts/${dupId}/answers`, { method: 'POST', token: teacher, body: { body: 'The lemma fails because the zebra relation is not in BCNF.' } });
  check('an answer was written on the duplicate', ans.status === 201, JSON.stringify(ans.json));
  const feedBefore = await api('/api/posts');
  check('before merging, the duplicate is in the feed', feedBefore.json.posts.some((p) => p.post_id === dupId));

  check('a student cannot merge (403)', (await api('/api/moderation/merge', { method: 'POST', token: ben, body: { duplicatePostId: dupId, originalPostId: postId } })).status === 403);
  check('an unverified teacher cannot merge (403)', (await api('/api/moderation/merge', { method: 'POST', token: unverified, body: { duplicatePostId: dupId, originalPostId: postId } })).status === 403);
  check('merging a doubt into itself is refused', (await api('/api/moderation/merge', { method: 'POST', token: teacher, body: { duplicatePostId: dupId, originalPostId: dupId } })).status === 409);
  const merged = await api('/api/moderation/merge', { method: 'POST', token: teacher, body: { duplicatePostId: dupId, originalPostId: postId } });
  check('a verified teacher can merge', merged.status === 200, JSON.stringify(merged.json));
  check('merging again is refused (409)', (await api('/api/moderation/merge', { method: 'POST', token: teacher, body: { duplicatePostId: dupId, originalPostId: postId } })).status === 409);

  const feedAfter = await api('/api/posts');
  check('after merging, the duplicate is gone from the feed', !feedAfter.json.posts.some((p) => p.post_id === dupId));
  check('the original is still in the feed', feedAfter.json.posts.some((p) => p.post_id === postId));
  const origDetail = await api(`/api/posts/${postId}`, { token: ben });
  const carried = origDetail.json.post.answers.find((a) => a.from_merged_duplicate);
  check("the original shows the duplicate's answer, marked as merged", Boolean(carried), `answers: ${origDetail.json.post.answers.length}`);
  const dupDetail = await api(`/api/posts/${dupId}`, { token: ben });
  check('the duplicate points to the original (merged_into)', dupDetail.json.post.merged_into === postId);
  const afterSearch = await api(`/api/search?q=${encodeURIComponent(`Quokka ${unique} zebra normalization lemma question`)}`, { token: ben });
  check('search no longer returns the merged duplicate', !afterSearch.json.results.some((r) => r.post_id === dupId));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error('\nTest run aborted:', error.message); process.exit(2); });
