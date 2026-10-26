// tests/test_teacher_topic.js: Comprehensive test suite for Teacher Mentioning and Mandatory Custom Topic
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(identifier) {
  const { status, json } = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier, password: PASSWORD },
  });
  if (status !== 200) {
    throw new Error(`Login failed for ${identifier} (${status})`);
  }
  return json.token;
}

async function main() {
  console.log(`Running Teacher Mention & Mandatory Topic Tests against ${BASE}\n`);

  const studentToken = await login('PES1UG24AM001');
  const teacherToken = await login('FAC001');
  const unique = Date.now().toString(36);

  // -------------------------------------------------------------------------
  // 1. A doubt with a valid topic and no teacher mention can be posted
  // -------------------------------------------------------------------------
  console.log('Requirement 1: Doubt with valid topic and no teacher mention');
  const postNoTeacher = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: 'Normalization',
      title: `Valid topic no teacher ${unique}`,
      body: 'Testing doubt posting with mandatory topic and no teacher mention.',
      tags: ['dbms'],
    },
  });
  check(
    'A doubt with a valid topic and no teacher mention can be posted',
    postNoTeacher.status === 201
      && postNoTeacher.json.post?.topic_name === 'Normalization'
      && postNoTeacher.json.post?.mentioned_teacher_id === null,
    `Status ${postNoTeacher.status}, ${JSON.stringify(postNoTeacher.json)}`
  );

  // -------------------------------------------------------------------------
  // 2. A doubt with a valid topic and a selected teacher can be posted
  // -------------------------------------------------------------------------
  console.log('\nRequirement 2: Doubt with valid topic and selected teacher');
  const postWithTeacher = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: 'Indexing',
      title: `Valid topic with teacher ${unique}`,
      body: 'Testing doubt posting with a selected teacher mention.',
      mentionedTeacherId: 'FAC001',
      tags: ['indexing'],
    },
  });
  check(
    'A doubt with a valid topic and a selected teacher can be posted',
    postWithTeacher.status === 201
      && postWithTeacher.json.post?.topic_name === 'Indexing'
      && postWithTeacher.json.post?.mentioned_teacher_id === 'FAC001'
      && postWithTeacher.json.post?.mentioned_teacher_name === 'Dr. Anita Rao',
    `Status ${postWithTeacher.status}, ${JSON.stringify(postWithTeacher.json)}`
  );

  // -------------------------------------------------------------------------
  // 3. Students can enter and submit a custom topic
  // -------------------------------------------------------------------------
  console.log('\nRequirement 3: Submit a custom topic');
  const customTopicName = `Distributed Consensus ${unique}`;
  const postCustomTopic = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: customTopicName,
      title: `Custom topic question ${unique}`,
      body: 'Testing doubt submission with a newly defined custom topic name.',
    },
  });
  check(
    'Students can enter and submit a custom topic',
    postCustomTopic.status === 201
      && postCustomTopic.json.post?.topic_name === customTopicName,
    `Status ${postCustomTopic.status}, topic_name: ${postCustomTopic.json.post?.topic_name}`
  );

  // Check custom topic deduplication with whitespace and casing
  const postDupCustomTopic = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: `  ${customTopicName.toLowerCase()}  `,
      title: `Dup custom topic question ${unique}`,
      body: 'Testing custom topic deduplication across whitespace and letter case.',
    },
  });
  check(
    'Custom topic avoids duplicates and reuses existing topic name with consistent casing',
    postDupCustomTopic.status === 201
      && postDupCustomTopic.json.post?.topic_name === customTopicName,
    `topic_name: ${postDupCustomTopic.json.post?.topic_name}`
  );

  // -------------------------------------------------------------------------
  // 4. Submitting without a topic is rejected
  // -------------------------------------------------------------------------
  console.log('\nRequirement 4: Submitting without a topic');
  const postNoTopicField = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      title: `Missing topic ${unique}`,
      body: 'This should fail because topic is omitted.',
    },
  });
  check(
    'Submitting without a topic is rejected (400)',
    postNoTopicField.status === 400 && Boolean(postNoTopicField.json.error),
    `Status: ${postNoTopicField.status}, error: ${postNoTopicField.json.error}`
  );

  const postNullTopic = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: null,
      title: `Null topic ${unique}`,
      body: 'This should fail because topic is null.',
    },
  });
  check(
    'Submitting null topic is rejected (400)',
    postNullTopic.status === 400 && Boolean(postNullTopic.json.error),
    `Status: ${postNullTopic.status}, error: ${postNullTopic.json.error}`
  );

  // -------------------------------------------------------------------------
  // 5. A topic containing only whitespace is rejected
  // -------------------------------------------------------------------------
  console.log('\nRequirement 5: Topic containing only whitespace');
  const postWhitespaceTopic = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: '    ',
      title: `Whitespace topic ${unique}`,
      body: 'This should fail because topic contains only whitespace.',
    },
  });
  check(
    'A topic containing only whitespace is rejected (400)',
    postWhitespaceTopic.status === 400 && Boolean(postWhitespaceTopic.json.error),
    `Status: ${postWhitespaceTopic.status}, error: ${postWhitespaceTopic.json.error}`
  );

  // -------------------------------------------------------------------------
  // 6. Invalid teacher references are rejected
  // -------------------------------------------------------------------------
  console.log('\nRequirement 6: Invalid teacher references');
  const postNonExistentTeacher = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: 'Normalization',
      title: `Invalid teacher ${unique}`,
      body: 'This should fail because teacher does not exist.',
      mentionedTeacherId: 'NON_EXISTENT_ID',
    },
  });
  check(
    'Non-existent teacher reference is rejected (400)',
    postNonExistentTeacher.status === 400 && Boolean(postNonExistentTeacher.json.error),
    `Status: ${postNonExistentTeacher.status}, error: ${postNonExistentTeacher.json.error}`
  );

  const postStudentAsTeacher = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: 'Normalization',
      title: `Student as teacher ${unique}`,
      body: 'This should fail because user is a student, not a teacher.',
      mentionedTeacherId: 'PES1UG24AM002', // student user_id
    },
  });
  check(
    'Referencing a student user_id as teacher is rejected (400)',
    postStudentAsTeacher.status === 400 && Boolean(postStudentAsTeacher.json.error),
    `Status: ${postStudentAsTeacher.status}, error: ${postStudentAsTeacher.json.error}`
  );

  // -------------------------------------------------------------------------
  // 7. Teacher-name search and selection work correctly
  // -------------------------------------------------------------------------
  console.log('\nRequirement 7: Teacher-name search and selection');
  const teacherSearchReq = await api('/api/teachers?q=anita', { token: studentToken });
  check(
    'Teacher search by partial name returns matching teachers',
    teacherSearchReq.status === 200
      && Array.isArray(teacherSearchReq.json.teachers)
      && teacherSearchReq.json.teachers.some((t) => t.display_name.toLowerCase().includes('anita') && t.user_id === 'FAC001'),
    `Results: ${JSON.stringify(teacherSearchReq.json.teachers)}`
  );

  const teacherSearchAll = await api('/api/teachers', { token: studentToken });
  check(
    'Teacher search with empty query returns available teachers list',
    teacherSearchAll.status === 200
      && Array.isArray(teacherSearchAll.json.teachers)
      && teacherSearchAll.json.teachers.length >= 4,
    `Count: ${teacherSearchAll.json.teachers?.length}`
  );

  const teacherSearchUnauth = await api('/api/teachers');
  check(
    'Teacher search requires authentication (401)',
    teacherSearchUnauth.status === 401
  );

  // -------------------------------------------------------------------------
  // 8. The saved topic and teacher mention appear correctly on the doubt post
  // -------------------------------------------------------------------------
  console.log('\nRequirement 8: Saved topic and teacher mention appearance');
  const postId = postWithTeacher.json.post?.post_id;
  const detailRes = await api(`/api/posts/${postId}`, { token: studentToken });
  check(
    'Doubt post detail displays saved topic correctly',
    detailRes.status === 200 && detailRes.json.post?.topic_name === 'Indexing',
    `topic_name: ${detailRes.json.post?.topic_name}`
  );
  check(
    'Doubt post detail displays mentioned teacher reference and name correctly',
    detailRes.status === 200
      && detailRes.json.post?.mentioned_teacher_id === 'FAC001'
      && detailRes.json.post?.mentioned_teacher_name === 'Dr. Anita Rao',
    `teacher: ${detailRes.json.post?.mentioned_teacher_name} (${detailRes.json.post?.mentioned_teacher_id})`
  );

  const feedRes = await api('/api/posts', { token: studentToken });
  const feedPost = feedRes.json.posts?.find((p) => p.post_id === postId);
  check(
    'Feed list returns mentioned teacher name and topic on post cards',
    feedPost?.topic_name === 'Indexing'
      && feedPost?.mentioned_teacher_id === 'FAC001'
      && feedPost?.mentioned_teacher_name === 'Dr. Anita Rao',
    `Feed item: ${JSON.stringify(feedPost)}`
  );

  // -------------------------------------------------------------------------
  // 9. Existing doubt-posting functionality remains intact
  // -------------------------------------------------------------------------
  console.log('\nRequirement 9: Existing doubt-posting functionality remains intact');
  const standardPost = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB002',
      topicName: 'Deadlocks',
      title: `Standard doubt post ${unique}`,
      body: 'Checking that tags, voting, answering, and status all work as before.',
      tags: ['os', 'concurrency'],
    },
  });
  check(
    'Standard doubt posting with tags and existing subject/topic works',
    standardPost.status === 201
      && standardPost.json.post?.tags?.length === 2
      && standardPost.json.post?.status === 'open'
  );

  const standardPostId = standardPost.json.post?.post_id;
  const voteRes = await api(`/api/posts/${standardPostId}/votes`, {
    method: 'POST',
    token: studentToken,
    body: { voteValue: 1 },
  });
  check('Voting on doubt post works as before', voteRes.status === 200 && voteRes.json.voteScore === 1);

  const answerRes = await api(`/api/posts/${standardPostId}/answers`, {
    method: 'POST',
    token: teacherToken,
    body: { body: 'Here is a verified teacher explanation on deadlocks.' },
  });
  check('Answering a doubt post works as before', answerRes.status === 201);

  // -------------------------------------------------------------------------
  // 10. Existing doubt records and related functionality are not broken
  // -------------------------------------------------------------------------
  console.log('\nRequirement 10: Existing doubt records and related functionality');
  // Check that previously created posts (including those without topic or without teacher) can be fetched
  check('Existing posts can be fetched without errors', feedRes.status === 200 && feedRes.json.posts?.length > 0);
  const postsWithNullTeacher = feedRes.json.posts?.filter((p) => p.mentioned_teacher_id === null);
  check(
    'Existing doubt records without mentioned teachers continue to load smoothly',
    postsWithNullTeacher.length > 0
  );

  const postsWithNullTopic = feedRes.json.posts?.filter((p) => p.topic_name === null);
  console.log(`  INFO: ${postsWithNullTopic.length} existing post(s) have null topic; handled safely without error.`);

  console.log(`\n========================================`);
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
