const fs = require('fs');
const FormData = require('form-data');
const http = require('http');

const form = new FormData();
form.append('file', fs.createReadStream('./attached_assets/Competitive Survey Data Table_1763249402347.xlsx'));
form.append('surveyMonth', '2025-11');

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/import/competitive-survey',
  method: 'POST',
  headers: form.getHeaders()
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response:', data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

form.pipe(req);
