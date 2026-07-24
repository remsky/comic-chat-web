-- carries pre-annotation messages rows into events: mode 6 becomes background, modes 7-10 become announces, chat rows keep poses and read neutral emotion
CREATE TABLE IF NOT EXISTS messages (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	avatar INTEGER NOT NULL,
	name TEXT NOT NULL,
	text TEXT NOT NULL,
	mode INTEGER NOT NULL,
	at INTEGER NOT NULL,
	expr INTEGER,
	gest INTEGER,
	req INTEGER,
	bg TEXT
);
INSERT INTO events (seq, event_type, avatar, name, text, mode,
	face_index, face_emotion_index, face_intensity_tenths,
	torso_index, torso_emotion_index, torso_intensity_tenths,
	requested, talk_tos_json, background_name, at)
SELECT
	seq,
	CASE mode WHEN 6 THEN 'background' WHEN 7 THEN 'nick' WHEN 8 THEN 'avatar'
		WHEN 9 THEN 'depart' WHEN 10 THEN 'arrive' ELSE 'chat' END,
	avatar,
	name,
	CASE WHEN mode = 6 THEN NULL ELSE text END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE mode END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE COALESCE(expr, 0) END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE 9 END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE 0 END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE COALESCE(gest, 0) END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE 0 END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE 0 END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE CASE WHEN req THEN 1 ELSE 0 END END,
	CASE WHEN mode BETWEEN 6 AND 10 THEN NULL ELSE '[]' END,
	CASE WHEN mode = 6 THEN text ELSE NULL END,
	at
FROM messages
ORDER BY seq;
DROP TABLE messages;
