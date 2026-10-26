/**
 * Subject generation and lookup helpers.
 */

function getNextSubjectId(existingIds) {
  let maxNum = 0;
  for (const id of existingIds) {
    const match = String(id).match(/^SUB(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  const candidate = `SUB${String(nextNum).padStart(3, '0')}`;
  if (!existingIds.includes(candidate)) return candidate;
  return `SUB_${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
}

function generateSubjectCode(subjectName, existingCodes) {
  const existingSet = new Set(existingCodes.map((c) => String(c).toUpperCase()));
  const words = subjectName.trim().split(/\s+/).filter(Boolean);
  let base = '';
  if (words.length === 1) {
    base = words[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  } else {
    base = words
      .map((w) => w[0])
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase();
  }
  if (!base || base.length < 2) base = 'SUB';

  if (!existingSet.has(base)) return base.slice(0, 20);

  let counter = 101;
  while (existingSet.has(`${base}${counter}`) && counter < 999) {
    counter += 1;
  }
  return `${base}${counter}`.slice(0, 20);
}

async function findOrCreateSubject(dbClient, subjectName) {
  const cleanName = subjectName.trim();

  // 1. Case-insensitive and whitespace-trimmed lookup to reuse existing subject
  const { rows: existing } = await dbClient.query(
    'SELECT subject_id, subject_code, subject_name FROM subject WHERE LOWER(TRIM(subject_name)) = LOWER($1)',
    [cleanName],
  );

  if (existing.length > 0) {
    return { subject: existing[0], created: false };
  }

  // 2. Fetch existing IDs and codes to generate unique new values
  const { rows: currentSubjects } = await dbClient.query('SELECT subject_id, subject_code FROM subject');
  const existingIds = currentSubjects.map((s) => s.subject_id);
  const existingCodes = currentSubjects.map((s) => s.subject_code);

  const subjectId = getNextSubjectId(existingIds);
  const subjectCode = generateSubjectCode(cleanName, existingCodes);

  const { rows: inserted } = await dbClient.query(
    `INSERT INTO subject (subject_id, subject_code, subject_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (subject_code) DO NOTHING
     RETURNING subject_id, subject_code, subject_name`,
    [subjectId, subjectCode, cleanName],
  );

  if (inserted.length > 0) {
    return { subject: inserted[0], created: true };
  }

  // If a concurrent insert occurred, fetch by name again
  const { rows: refetched } = await dbClient.query(
    'SELECT subject_id, subject_code, subject_name FROM subject WHERE LOWER(TRIM(subject_name)) = LOWER($1)',
    [cleanName],
  );
  if (refetched.length > 0) {
    return { subject: refetched[0], created: false };
  }

  throw new Error('Failed to create or find subject.');
}

module.exports = {
  getNextSubjectId,
  generateSubjectCode,
  findOrCreateSubject,
};
