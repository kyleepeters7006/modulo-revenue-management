const https = require('https');
const { Client } = require('pg');

async function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    const encodedAddress = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1`;
    
    https.get(url, {
      headers: { 'User-Agent': 'Modulo-Revenue-Dashboard/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results.length > 0) {
            resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) });
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const { rows } = await client.query(`
    SELECT id, name, address, city, state, zip_code 
    FROM locations 
    WHERE address IS NOT NULL AND (lat IS NULL OR lng IS NULL)
    ORDER BY name
    LIMIT 20
  `);
  
  console.log(`Geocoding ${rows.length} locations...`);
  
  let updated = 0;
  for (const location of rows) {
    const fullAddress = `${location.address}, ${location.city}, ${location.state} ${location.zip_code}`;
    console.log(`\nGeocoding: ${location.name}`);
    console.log(`Address: ${fullAddress}`);
    
    try {
      const coords = await geocodeAddress(fullAddress);
      if (coords) {
        await client.query(
          `UPDATE locations SET lat = $1, lng = $2 WHERE id = $3`,
          [coords.lat, coords.lng, location.id]
        );
        console.log(`✅ Updated: ${coords.lat}, ${coords.lng}`);
        updated++;
      } else {
        console.log(`❌ No coordinates found`);
      }
      
      // Rate limit: 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1100));
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }
  
  await client.end();
  console.log(`\nCompleted: ${updated} / ${rows.length} locations geocoded`);
}

main().catch(console.error);
