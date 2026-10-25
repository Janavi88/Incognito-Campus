// Talks to the Python search service (search_service.py).
// Nothing in the main app may depend on it being up: callers handle failures.
const BASE = process.env.SEARCH_SERVICE_URL || 'http://localhost:8001';

async function call(path, body, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`search service returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Fire-and-forget. A post is saved even when the search service is down or slow; a post that
// misses its embedding is picked up later by POST /embed-missing on the service (or embed_posts.py).
function embedPost(postId) {
  return call('/embed', { postId }, 30000)
    .then(() => true)
    .catch((error) => {
      console.warn(`Could not embed post ${postId} (it will be picked up on the next retry): ${error.message}`);
      return false;
    });
}

const search = (payload) => call('/search', payload);
const findDuplicates = (payload) => call('/duplicates', payload);

module.exports = { embedPost, search, findDuplicates };
