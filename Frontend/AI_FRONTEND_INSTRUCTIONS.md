# AI Developer Instructions: Frontend Integration Guide

**ATTENTION AI AGENT:** If you are reading this file, you have been tasked with building the frontend for the Career-Edge-AI application. The backend has already been completely built, tested, and deployed. Your job is to strictly adhere to the following UI requirements and connect them to the provided REST and WebSocket APIs.

---

## 1. Drills Module (12 Mini-Games)
The backend routes are located at `/drills`. The flow is always:
1. `POST /drills/start`: Send `{"drill_level": "easy", "drill_type": "jam"}` to get `session_id`.
2. Connect to the specific `/drills/generate/...` endpoint (detailed below).
3. `POST /drills/{session_id}/complete`: Send the final score/grading using `{"evaluation_data": {...}}`.

### 🟢 Easy Drills
- **Just a Minute (JAM)**:
  - **API:** `GET /drills/generate/jam` (Returns `topic`)
  - **Frontend:** Show topic. Big "Start" button. 60-second countdown timer. Use phone microphone. The user must talk continuously without fillers.
- **Fast Word Association**:
  - **API:** `GET /drills/generate/fast-word` (Returns `word`)
  - **Frontend:** Lightning-fast 5-second timer. Textbox for user to type one related word. Submit button.
- **Emotion Roulette**:
  - **API:** `GET /drills/generate/emotion` (Returns `sentence` and `emotion`)
  - **Frontend:** Read sentence out loud using that exact emotion. "Next" button generates new sentence. Use microphone.
- **Synonym Rush**:
  - **API:** `GET /drills/generate/synonym` (Returns `word`)
  - **Frontend:** 30-second timer. User speaks as many synonyms as possible. App must use speech-to-text to count correct words.
- **Fake Profile Intro**:
  - **API:** `GET /drills/generate/fake-profile` (Returns `name`, `age`, `job`, `hobby`)
  - **Frontend:** Render a fake identity card. 45-second timer. User introduces themselves as that person via microphone.
- **3-Emoji Story**:
  - **API:** `GET /drills/generate/emojis` (Returns array of 3 emojis)
  - **Frontend:** 60-second timer. User tells a story connecting all 3 emojis via microphone.

### 🟡 Medium Drills
- **Taboo Words**:
  - **API:** `GET /drills/generate/taboo` (Returns `topic` and `banned_words` array)
  - **Frontend:** Show topic and banned words. 60-second timer. User speaks. App uses speech-to-text to ensure no banned words are spoken.
- **30-Second Elevator Pitch**:
  - **API:** `GET /drills/generate/elevator-pitch` (Returns `scenario`)
  - **Frontend:** 30-second strict timer. Force microphone stop exactly at 30 seconds.
- **Rephrase This!**:
  - **API:** `GET /drills/generate/rephrase` (Returns complex `text`)
  - **Frontend:** 45-second silent reading timer (display text). Then hide text. 20-second speaking timer (microphone activates).
- **The Positive Framing Challenge**:
  - **API:** `GET /drills/generate/positive-framing` (Returns `complaint`)
  - **Frontend:** Show negative complaint. User must speak a positive reply.

### 🔴 Hard Drills
- **Crisis Press Conference**:
  - **API:** `GET /drills/generate/hard/crisis` (Returns emergency `scenario` and array of `questions`)
  - **Frontend:** Start recording user. Every 15 seconds, randomly interrupt the user by flashing an angry text question from the `questions` array.
- **AI / System Negotiation Bot**:
  - **API:** `POST /drills/hard/negotiation/turn` (Send `user_message`, `turn_number`, `current_offer`)
  - **Frontend:** Voice-based interface. Convert speech to text, send to API. AI replies with pushback or compromise. Strict limit of 5 turns.

---

## 2. Pre-Test and Post-Test Interviews
Both the `pre-test-active-listening` and `post-test-interview` modules utilize interactive AI WebSockets.

1. **Start:** `POST /{module_prefix}/start`
2. **WebSocket Connect:** `ws://{domain}/{module_prefix}/{session_id}/chat?token={jwt}`
3. **Communication Protocol:**
   - Frontend sends JSON: `{"text": "User's spoken response"}`
   - Backend streams JSON: `{"text": "partial ai sentence"}`
   - Backend signals turn end: `{"type": "turn_complete"}`
4. **Complete:** `POST /{module_prefix}/{session_id}/complete` sending `{ "score_vocabulary": 4, "score_clarity": 5, ... }`

---

## 3. Custom Skills AI Session
This is a personalized practice session.
- **Start:** `POST /custom-skills/start`. The backend automatically calculates the user's weaknesses.
- **WebSocket:** `ws://{domain}/custom-skills/{session_id}/chat?token={jwt}`. Connect exactly the same way as the Post-Test. The backend handles the customized prompt generation automatically.
- **Complete:** `POST /custom-skills/{session_id}/complete`

---

### General Frontend Requirements
- **Authentication:** All requests require a Bearer token in the `Authorization` header. WebSockets require the token passed via query parameter `?token=...`.
- **Speech-to-Text:** The frontend is entirely responsible for invoking the mobile/browser Speech-to-Text API to convert microphone input into text before sending it over the WebSockets or grading it locally.
- **UI Design:** The application design must be premium, highly interactive, and utilize modern micro-animations, especially for timers, microphone recording states, and real-time AI typing effects.
