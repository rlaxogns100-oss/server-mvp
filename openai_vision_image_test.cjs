'use strict';
// TEMP TEST ONLY.
const https = require('https');
require('dotenv').config();

// Read from environment (.env or process env). Prefer OPENAI_api first per user's setup.
const API_KEY = process.env.OPENAI_api || process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
if (!API_KEY) {
  console.error('OPENAI_api / OPENAI_API_KEY / OPENAI_KEY not set. Add it to .env or environment.');
  process.exit(1);
}

const DEFAULT_IMAGE = 'https://cdn.mathpix.com/cropped/2025_10_26_2fe9131f9ec28618aad5g-1.jpg?height=235&width=243&top_left_y=251&top_left_x=1644';
const imageUrl = process.argv[2] || DEFAULT_IMAGE;

const body = JSON.stringify({
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '이 이미지의 수학적 대상/기호를 한국어 한 단어로만 답해.' },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ],
  temperature: 0,
  max_tokens: 50
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
    console.log('HTTP', res.statusCode);
    try {
      const json = JSON.parse(data);
      const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
        ? json.choices[0].message.content
        : '';
      console.log('\n=== Vision 응답 ===');
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

console.log('테스트 이미지 URL:', imageUrl);
req.write(body);
req.end();
