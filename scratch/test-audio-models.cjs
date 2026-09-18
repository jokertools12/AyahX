require('dotenv').config();
const key = process.env.GEMINI_API_KEY;
console.log('Testing audio transcription models with key ending in...', key ? key.slice(-6) : 'none');

// 1-second 16kHz mono silence WAV base64
const sampleRate = 16000;
const numSamples = sampleRate * 1;
const buffer = Buffer.alloc(44 + numSamples * 2);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + numSamples * 2, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(numSamples * 2, 40);
const base64Wav = buffer.toString('base64');

const models = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-transcribe',
  'gemini-flash-latest'
];

async function run() {
  for (const model of models) {
    const start = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: 'Return JSON: {"lines": [], "text": "ok"}' },
              { inline_data: { mime_type: 'audio/wav', data: base64Wav } }
            ]
          }],
          generationConfig: { response_mime_type: 'application/json' }
        })
      });
      const time = Date.now() - start;
      const text = await res.text();
      console.log(`Model ${model}: status=${res.status} in ${time}ms`, res.ok ? 'SUCCESS: ' + text.trim().slice(0, 80) : 'FAIL: ' + text.slice(0, 150));
    } catch (e) {
      console.log(`Model ${model}: ERROR ${e.message}`);
    }
  }
}
run();
