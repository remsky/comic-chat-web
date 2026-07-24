CREATE TABLE IF NOT EXISTS events (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	event_type TEXT NOT NULL,
	avatar INTEGER,
	name TEXT NOT NULL,
	text TEXT,
	mode INTEGER,
	face_index INTEGER,
	face_emotion_index INTEGER,
	face_intensity_tenths INTEGER,
	torso_index INTEGER,
	torso_emotion_index INTEGER,
	torso_intensity_tenths INTEGER,
	requested INTEGER,
	talk_tos_json TEXT,
	background_name TEXT,
	at INTEGER NOT NULL
);
