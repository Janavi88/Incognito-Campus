# Incognito-Campus

## Login API (Node.js + PostgreSQL)

This application slice implements login, the current user's profile, role checks, doubt creation, answer creation, and a small browser UI. It uses the existing database schema.

### Run locally

1. Install Node.js and PostgreSQL. Create a database named `incognito_campus`.
2. In the project folder, install dependencies with `npm install`.
3. Copy `.env.example` to `.env`, then set `DATABASE_URL` and a long random `JWT_SECRET`.
4. In `psql`, load `schema.sql`, then `seed.sql`, then the migration files in numeric order if your project database needs them.
5. Replace the sample `password_hash` values in `users` with real bcrypt hashes. The values in `seed.sql` are placeholders and cannot be used to log in. Generate a hash with:

   ```sh
   node -e "require('bcryptjs').hash('your-demo-password', 12).then(console.log)"
   ```

6. Start the app with `npm run dev`, then open `http://localhost:3000` in a browser.

### Routes in this step

- `POST /api/auth/login` accepts `{ "identifier": "email or user ID", "password": "..." }` and returns a short-lived JWT plus the signed-in user's role-specific profile.
- `GET /api/subjects` lists subjects and topics for the doubt form.
- `GET /api/posts` lists recent doubts; `GET /api/posts/:postId` opens a doubt with its answers and comments.
- `POST /api/posts` creates a doubt for a signed-in student. It accepts `{ "subjectId": "SUB001", "topicName": "Normalization", "title": "...", "body": "...", "tags": ["dbms"] }`. `topicName` and `tags` are optional.
- `POST /api/posts/:postId/answers` adds an answer to a doubt. Students and verified teachers can answer; closed doubts reject new answers.
- `POST /api/posts/:postId/answers/:answerId/accept` accepts an answer for the student who asked the doubt or a verified teacher. The answer update and post resolution happen in one transaction.
- `POST /api/posts/:postId/answers/:answerId/unaccept` reverses that choice in a transaction. The doubt reopens only if it has no other accepted answers.
- `POST /api/posts/:postId/answers/:answerId/comments` adds a comment under an answer.
- `POST /api/posts/:postId/votes` and `POST /api/posts/:postId/answers/:answerId/votes` accept `{ "voteValue": 1 }` for an upvote or `{ "voteValue": -1 }` for a downvote. A user's vote is updated if they vote again.
- `GET /api/me` returns the profile for the bearer token's account.
- `GET /api/teacher-area` demonstrates a verified-teacher-only check.
- `GET /api/admin-area` demonstrates an admin-only check.
- `GET /api/health` checks the PostgreSQL connection.

Send the token on protected routes using `Authorization: Bearer <token>`. Student public identity is returned as the anonymous handle; the student login ID and email are available only in that student's own authenticated profile.

### Browser walkthrough

1. Log in as `PES1UG24AM001` using the demo password set in step 5 above.
2. Confirm the top bar shows the student's anonymous handle.
3. Select **Ask a doubt**, choose a subject and optional topic, enter a title and description, add comma-separated tags, and publish.
4. Open the new doubt from the feed and post an answer. It should appear under the student's anonymous handle.
5. Sign out, then log in as verified teacher `FAC001`. Open that doubt and post an answer; it should show the teacher's display name.
6. Sign in as a teacher and try the student-only **Ask a doubt** action through the API if you want to confirm role rejection. The frontend hides that control for teachers.
7. As a signed-in user, upvote or downvote a post or answer, then add a comment under an answer. The score and comment should appear in the question detail.
8. As the student who asked the doubt or a verified teacher, click **Accept answer**. The answer should get an accepted badge and the doubt status should become resolved.

Run `psql -d incognito_campus -v ON_ERROR_STOP=1 -f queries.sql` to view the example joins, aggregations, integrity checks, and index plans.
