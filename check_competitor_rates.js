const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Check stored competitor rates for Anderson in 2026-07
  const rr = await pool.query(`
    SELECT 
      location,
      service_line,
      room_type,
      COUNT(*) as unit_count,
      ROUND(AVG(competitor_base_rate)::numeric, 2) as avg_base_rate,
      ROUND(AVG(competitor_care_level2_adjustment)::numeric, 2) as avg_care_adj,
      ROUND(AVG(competitor_med_management_adjustment)::numeric, 2) as avg_med_adj,
      ROUND(AVG(competitor_final_rate)::numeric, 2) as avg_final_rate,
      MAX(competitor_name) as competitor_name
    FROM rent_roll_data
    WHERE upload_month = '2026-07'
      AND LOWER(location) LIKE '%anderson%'
      AND service_line IN ('AL', 'AL/MC')
    GROUP BY location, service_line, room_type, competitor_name
    ORDER BY location, service_line, room_type
  `);
  console.log('=== Stored Competitor Rates (Anderson AL/AL-MC, 2026-07) ===');
  console.log(JSON.stringify(rr.rows, null, 2));

  // 2. Check competitive survey data for Anderson
  const survey = await pool.query(`
    SELECT 
      keystats_location,
      competitor_type,
      competitor_name,
      room_type,
      monthly_rate_avg,
      care_level_2_rate,
      medication_management_fee,
      survey_month,
      client_id
    FROM competitive_survey_data
    WHERE LOWER(keystats_location) LIKE '%anderson%'
      AND competitor_type IN ('AL', 'AL/MC')
    ORDER BY keystats_location, competitor_type, survey_month DESC, competitor_name
    LIMIT 30
  `);
  console.log('\n=== Survey Data (Anderson AL/AL-MC) ===');
  console.log(JSON.stringify(survey.rows, null, 2));

  // 3. Check care_level_rates for Anderson
  const care = await pool.query(`
    SELECT 
      l.name as location_name,
      clr.service_line,
      clr.level2_rate,
      clr.client_id
    FROM care_level_rates clr
    JOIN locations l ON clr.location_id = l.id
    WHERE LOWER(l.name) LIKE '%anderson%'
    ORDER BY l.name, clr.service_line
  `);
  console.log('\n=== Care Level Rates (Anderson) ===');
  console.log(JSON.stringify(care.rows, null, 2));

  // 4. Check what upload months exist for Anderson
  const months = await pool.query(`
    SELECT DISTINCT upload_month, service_line, COUNT(*) as units
    FROM rent_roll_data
    WHERE LOWER(location) LIKE '%anderson%'
    GROUP BY upload_month, service_line
    ORDER BY upload_month DESC, service_line
    LIMIT 20
  `);
  console.log('\n=== Available Upload Months (Anderson) ===');
  console.log(JSON.stringify(months.rows, null, 2));

  // 5. Check recent competitor rate jobs
  const jobs = await pool.query(`
    SELECT id, upload_month, client_id, status, total_units, processed_units, updated_units, skipped_units, error_count, created_at, completed_at
    FROM competitor_rate_jobs
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log('\n=== Recent Competitor Rate Jobs ===');
  console.log(JSON.stringify(jobs.rows, null, 2));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
