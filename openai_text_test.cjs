// TEMP TEST ONLY.
'use strict';
const https = require('https');
require('dotenv').config();

// Read from environment (.env or process env). Prefer OPENAI_api first per user's setup.
const API_KEY = process.env.OPENAI_api || process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
if (!API_KEY) {
  console.error('OPENAI_api / OPENAI_API_KEY / OPENAI_KEY not set. Add it to .env or environment.');
  process.exit(1);
}

// Minimal text-only request body
const body = JSON.stringify({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'user', content: '1+1= ? 숫자 하나로만 답해.' }
  ],
  temperature: 0,
  max_tokens: 10
});

const options = {
  hostname: 'api.openai.com',
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    try {
      console.log('HTTP', res.statusCode);
      const json = JSON.parse(data);
      const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content ? json.choices[0].message.content : '';
      console.log('\n=== 응답 본문 ===');
      console.log(content || data);
    } catch (e) {
      console.error('파싱 오류:', e.message);
      console.error(data);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('요청 오류:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
