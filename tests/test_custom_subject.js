// tests/test_custom_subject.js: Comprehensive test suite for Custom Subject Feature
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
  console.log(`Running Custom Subject Tests against ${BASE}\n`);

  const studentToken = await login('PES1UG24AM001');
  const unique = Date.now().toString(36);

  // -------------------------------------------------------------------------
  // 1. Display existing subjects
  // -------------------------------------------------------------------------
  console.log('1. Display Existing Subjects:');
  const subjectsRes = await api('/api/subjects');
  check('Can fetch subjects list', subjectsRes.status === 200 && Array.isArray(subjectsRes.json.subjects));
  const hasDbms = subjectsRes.json.subjects.some((s) => s.subject_code === 'CS301');
  check('Subjects list contains existing subjects (e.g. CS301 Database Management Systems)', hasDbms);

  // -------------------------------------------------------------------------
  // 2. Select an existing subject
  // -------------------------------------------------------------------------
  console.log('\n2. User can select an existing subject:');
  const existingSubPost = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB001',
      topicName: 'Indexing',
      title: `Existing subject post ${unique}`,
      body: 'Testing doubt post using an existing subject selection.',
    },
  });
  check(
    'Post created with existing subject is successful (201)',
    existingSubPost.status === 201 && existingSubPost.json.post?.subject_id === 'SUB001'
  );
  check(
    'Existing subject name and code are returned in the response',
    existingSubPost.json.post?.subject_code === 'CS301' && existingSubPost.json.post?.subject_name === 'Database Management Systems'
  );

  // -------------------------------------------------------------------------
  // 3. Reject empty or whitespace-only custom subjects
  // -------------------------------------------------------------------------
  console.log('\n3. Reject empty or whitespace-only custom subject:');
  const emptyCustomSub = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: '__other__',
      customSubject: '',
      topicName: 'General',
      title: `Empty custom subject ${unique}`,
      body: 'Testing doubt post with empty custom subject.',
    },
  });
  check(
    'Submitting with empty customSubject is rejected (400)',
    emptyCustomSub.status === 400 && Boolean(emptyCustomSub.json.error)
  );

  const wsCustomSub = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: '__other__',
      customSubject: '     ',
      topicName: 'General',
      title: `Whitespace custom subject ${unique}`,
      body: 'Testing doubt post with whitespace-only custom subject.',
    },
  });
  check(
    'Submitting with whitespace-only customSubject is rejected (400)',
    wsCustomSub.status === 400 && Boolean(wsCustomSub.json.error)
  );

  // -------------------------------------------------------------------------
  // 4. User can add a subject that is not in the existing list
  // -------------------------------------------------------------------------
  console.log('\n4. User can add a custom subject not in the existing list:');
  const customSubjectName = `Quantum Computing ${unique}`;
  const customSubPost = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: '__other__',
      customSubject: customSubjectName,
      topicName: 'Qubits and Superposition',
      title: `Quantum doubt ${unique}`,
      body: 'Testing doubt post with a brand new custom subject.',
    },
  });
  check(
    'Post created with new custom subject is successful (201)',
    customSubPost.status === 201 && customSubPost.json.post?.subject_name === customSubjectName
  );
  const newSubjectId = customSubPost.json.post?.subject_id;
  check(
    'New subject receives a valid subject_id and subject_code',
    Boolean(newSubjectId) && newSubjectId !== '__other__' && Boolean(customSubPost.json.post?.subject_code)
  );

  // -------------------------------------------------------------------------
  // 5. Saved custom subject is displayed correctly in details and feed
  // -------------------------------------------------------------------------
  console.log('\n5. Custom subject is saved and displayed correctly:');
  const customPostId = customSubPost.json.post?.post_id;
  const detailRes = await api(`/api/posts/${customPostId}`, { token: studentToken });
  check(
    'Post detail returns the custom subject name and code correctly',
    detailRes.status === 200
      && detailRes.json.post?.subject_name === customSubjectName
      && detailRes.json.post?.subject_id === newSubjectId
  );
  check(
    'Custom subject is NOT replaced by "Other"',
    detailRes.json.post?.subject_name !== '__other__' && detailRes.json.post?.subject_name !== 'Other'
  );

  const feedRes = await api('/api/posts', { token: studentToken });
  const feedPost = feedRes.json.posts?.find((p) => p.post_id === customPostId);
  check(
    'Feed list returns the custom subject name and code correctly',
    feedPost?.subject_name === customSubjectName
  );

  // Verify that the new subject appears in /api/subjects
  const updatedSubjects = await api('/api/subjects');
  const foundInList = updatedSubjects.json.subjects?.some((s) => s.subject_name === customSubjectName);
  check('New custom subject is persisted and available in /api/subjects', foundInList);

  // -------------------------------------------------------------------------
  // 6. Existing subjects are not duplicated due to capitalization or spacing
  // -------------------------------------------------------------------------
  console.log('\n6. Prevent duplicate subjects (case & whitespace consistency):');
  // Submitting an existing subject name with different casing and extra spaces
  const dupSubPost = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: '__other__',
      customSubject: '   dAtAbAsE mAnAgEmEnT sYsTeMs   ',
      topicName: 'Transactions',
      title: `Casing test ${unique}`,
      body: 'Testing that casing differences reuse the existing subject.',
    },
  });
  check(
    'Submitting existing subject with different casing/spacing reuses SUB001',
    dupSubPost.status === 201 && dupSubPost.json.post?.subject_id === 'SUB001'
  );
  check(
    'Reused subject retains canonical casing: Database Management Systems',
    dupSubPost.json.post?.subject_name === 'Database Management Systems'
  );

  // Also test case-insensitive duplicate of the newly created custom subject
  const dupCustomSubPost = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: '__other__',
      customSubject: `  ${customSubjectName.toLowerCase()}  `,
      topicName: 'Entanglement',
      title: `Dup custom subject casing ${unique}`,
      body: 'Testing that submitting an existing custom subject reuses it.',
    },
  });
  check(
    'Submitting existing custom subject with lowercase reuses existing subject_id',
    dupCustomSubPost.status === 201 && dupCustomSubPost.json.post?.subject_id === newSubjectId
  );

  // -------------------------------------------------------------------------
  // 7. Dedicated POST /api/subjects endpoint
  // -------------------------------------------------------------------------
  console.log('\n7. Dedicated POST /api/subjects endpoint:');
  const standaloneSubjectName = `Biotechnology ${unique}`;
  const createSubRes = await api('/api/subjects', {
    method: 'POST',
    token: studentToken,
    body: { subjectName: standaloneSubjectName },
  });
  check(
    'POST /api/subjects creates a new subject successfully (201)',
    createSubRes.status === 201 && createSubRes.json.created === true && createSubRes.json.subject?.subject_name === standaloneSubjectName
  );

  const duplicateSubRes = await api('/api/subjects', {
    method: 'POST',
    token: studentToken,
    body: { subjectName: standaloneSubjectName.toLowerCase() },
  });
  check(
    'POST /api/subjects with duplicate name reuses existing subject (200, created=false)',
    duplicateSubRes.status === 200 && duplicateSubRes.json.created === false && duplicateSubRes.json.subject?.subject_name === standaloneSubjectName
  );

  // -------------------------------------------------------------------------
  // 8. Existing functionality remains unaffected
  // -------------------------------------------------------------------------
  console.log('\n8. Existing doubt-posting and teacher mentions remain intact:');
  const postWithTeacher = await api('/api/posts', {
    method: 'POST',
    token: studentToken,
    body: {
      subjectId: 'SUB002',
      topicName: 'Deadlocks',
      title: `Regression check post ${unique}`,
      body: 'Checking teacher mention and standard posting along with subject feature.',
      mentionedTeacherId: 'FAC001',
    },
  });
  check(
    'Posting with existing subject, topic, and teacher mention still succeeds',
    postWithTeacher.status === 201
      && postWithTeacher.json.post?.subject_id === 'SUB002'
      && postWithTeacher.json.post?.mentioned_teacher_id === 'FAC001'
      && postWithTeacher.json.post?.mentioned_teacher_name === 'Dr. Anita Rao'
  );

  console.log(`\n========================================`);
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
