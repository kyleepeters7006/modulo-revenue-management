const fs = require('fs');
const FormData = require('form-data');
const http = require('http');

async function uploadFile() {
  const form = new FormData();
  form.append('file', fs.createReadStream('./attached_assets/Competitive Survey Data Table_1763249402347.xlsx'));
  form.append('surveyMonth', '2025-11');

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/import/competitive-survey',
      method: 'POST',
      headers: form.getHeaders()
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log('Response:', data);
        resolve(data);
      });
    });
    
    req.on('error', reject);
    form.pipe(req);
  });
}

uploadFile().then(() => {
  console.log('\nImport request sent. Check logs for debug output.');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
