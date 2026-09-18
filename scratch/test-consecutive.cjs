const jwt = require('jsonwebtoken');
require('dotenv').config();
const secret = process.env.JWT_SECRET || 'quran_reels_jwt_secret_key_2026_default';
const token = jwt.sign({ id: 'test-user-id', email: 'test@example.com' }, secret, { expiresIn: '1h' });

async function testMultiple() {
  console.log('Sending 5 consecutive transcription requests to verify rate limits...');
  for (let i = 1; i <= 5; i++) {
    const res = await fetch('http://localhost:8080/api/services/transcribe-audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        chunkOffset: i * 30
      })
    });
    console.log(`Request ${i}: status=${res.status}, limit-rem=${res.headers.get('x-ratelimit-remaining')}`);
  }
}
testMultiple();
