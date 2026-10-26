CREATE EXTENSION IF NOT EXISTS vector;


DROP TABLE IF EXISTS report CASCADE;
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS comment CASCADE;
DROP TABLE IF EXISTS answer CASCADE;
DROP TABLE IF EXISTS post_tag CASCADE;
DROP TABLE IF EXISTS tag CASCADE;
DROP TABLE IF EXISTS post_embeddings CASCADE;
DROP TABLE IF EXISTS post CASCADE;
DROP TABLE IF EXISTS teaches CASCADE;
DROP TABLE IF EXISTS topic CASCADE;
DROP TABLE IF EXISTS subject CASCADE;
DROP TABLE IF EXISTS teacher CASCADE;
DROP TABLE IF EXISTS student CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users Table
CREATE TABLE users(
	user_id VARCHAR(20) PRIMARY KEY,
	email VARCHAR(255) NOT NULL UNIQUE,
	password_hash VARCHAR(255) NOT NULL,
	role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
	department VARCHAR(100),
	created_at TIMESTAMP NOT NULL DEFAULT now(),
	UNIQUE (user_id, role)
);

--2. STUDENT Table
CREATE TABLE student(
	user_id VARCHAR(20) PRIMARY KEY,
	anonymous_handle  VARCHAR(70) NOT NULL UNIQUE,
	FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

--3. Teacher Table
CREATE TABLE teacher(
	user_id VARCHAR(20) PRIMARY KEY,
	display_name VARCHAR(70) NOT NULL UNIQUE,
	is_verified BOOLEAN NOT NULL DEFAULT FALSE,
	FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

--4. SUBJECT Table
CREATE TABLE subject (
	subject_id VARCHAR(20) PRIMARY KEY ,
	subject_code VARCHAR(20)  NOT NULL UNIQUE,
	subject_name VARCHAR(150) NOT NULL,
	department VARCHAR(100)
);

-- 5. TOPIC 
CREATE TABLE topic (
    subject_id VARCHAR(20) NOT NULL REFERENCES subject (subject_id) ON DELETE CASCADE,
    topic_name VARCHAR(100) NOT NULL,
    description TEXT,
    PRIMARY KEY (subject_id, topic_name)
);

--6. teaches
CREATE TABLE teaches (
    user_id VARCHAR(20) NOT NULL REFERENCES teacher (user_id) ON DELETE CASCADE,
    subject_id VARCHAR(20) NOT NULL REFERENCES subject (subject_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, subject_id)
);

--7. post
CREATE TABLE post(
	post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id VARCHAR(20) NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
	subject_id VARCHAR(20) NOT NULL REFERENCES subject (subject_id),
	topic_name VARCHAR(100),          
	title VARCHAR(255) NOT NULL,
	body TEXT NOT NULL,
	status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
	created_at TIMESTAMP NOT NULL DEFAULT now(),
	mentioned_teacher_id VARCHAR(20) REFERENCES teacher (user_id) ON DELETE SET NULL,
	FOREIGN KEY (subject_id, topic_name) REFERENCES topic (subject_id, topic_name)

);

--8. Post Embeddings Table
CREATE TABLE post_embeddings(
	post_id UUID NOT NULL REFERENCES post (post_id) ON DELETE CASCADE,
	embedding vector(384),
	embedding_model VARCHAR(100),
	embedding_updated_at TIMESTAMP,
	CHECK ((embedding IS NULL) = (embedding_model IS NULL) AND (embedding IS NULL) = (embedding_updated_at IS NULL))
);

-- 9.TAG 
CREATE TABLE tag(
	tag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	tag_name VARCHAR(50) NOT NULL UNIQUE
);

-- 10. POST_TAG
	CREATE TABLE post_tag (
	post_id UUID NOT NULL REFERENCES post (post_id) ON DELETE CASCADE,
	tag_id UUID NOT NULL REFERENCES tag (tag_id)   ON DELETE CASCADE,
	PRIMARY KEY (post_id, tag_id)
);

-- 11. ANSWER
CREATE TABLE answer (
	answer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	post_id UUID NOT NULL REFERENCES post (post_id) ON DELETE CASCADE,
	user_id VARCHAR(20) NOT NULL REFERENCES users (user_id),
	body TEXT NOT NULL,
	is_accepted BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TIMESTAMP NOT NULL DEFAULT now()
);


--12.Comment Table
CREATE TABLE comment (
	comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	post_id UUID NOT NULL REFERENCES post (post_id) ON DELETE CASCADE,
	answer_id UUID NOT NULL REFERENCES answer (answer_id) ON DELETE CASCADE,
	user_id VARCHAR(20) NOT NULL REFERENCES users (user_id),
	body TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 12. VOTES 
CREATE TABLE votes (
	vote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id VARCHAR(20) NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
	post_id UUID REFERENCES post (post_id) ON DELETE CASCADE,
	answer_id UUID REFERENCES answer (answer_id) ON DELETE CASCADE,
	vote_value SMALLINT NOT NULL CHECK (vote_value IN (-1, 1)),
	created_at TIMESTAMP NOT NULL DEFAULT now(),
	CHECK ((post_id IS NULL) <> (answer_id IS NULL)),
	UNIQUE (user_id, post_id),
	UNIQUE (user_id, answer_id)
);
 
-- 13. REPORT (targets exactly one of post / answer)
CREATE TABLE report (
    report_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id VARCHAR(20) NOT NULL REFERENCES users (user_id),
    reviewer_user_id VARCHAR(20) REFERENCES users (user_id),
    post_id UUID REFERENCES post (post_id) ON DELETE CASCADE,
    answer_id UUID REFERENCES answer (answer_id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CHECK ((post_id IS NULL) <> (answer_id IS NULL))
);

-- Indexes for common queries
CREATE INDEX idx_post_subject_topic ON post (subject_id, topic_name);
CREATE INDEX idx_post_user          ON post (user_id);
CREATE INDEX idx_post_status        ON post (status, created_at DESC);
CREATE INDEX idx_post_tag_tag       ON post_tag (tag_id);
CREATE INDEX idx_answer_post        ON answer (post_id);
CREATE INDEX idx_answer_user        ON answer (user_id);
CREATE INDEX idx_comment_answer     ON comment (answer_id);
CREATE INDEX idx_votes_post         ON votes (post_id);
CREATE INDEX idx_votes_answer       ON votes (answer_id);
CREATE INDEX idx_report_status      ON report (status);
CREATE INDEX idx_teaches_subject    ON teaches (subject_id);
 
-- semantic search over doubts (cosine distance)
CREATE INDEX idx_post_embedding_hnsw ON post_embeddings USING hnsw (embedding vector_cosine_ops);