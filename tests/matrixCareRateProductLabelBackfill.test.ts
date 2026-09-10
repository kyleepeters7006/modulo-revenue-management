import assert from 'node:assert/strict';
import { pool } from '../server/db';
import {
  backfillMatrixCareRateProductLabels,
  parseMatrixCareRateProductLabelRows,
} from '../server/dataImport';

const clientId = 'trilogy';
const uploadMonth = '2099-12';
const location = `label-recovery-test-${Date.now()}`;
let locationId: string;

const csv = [
  'location,Service1,Room_Bed,LevelOfCare1,ActualLevel1,BedSpecialization1',
  `${location},HC,101/A,HC,Level 1,Private`,
  `${location},HC,101/B,HC,Level 2,Semi-Private`,
  `${location},HC,102/A,HC,Level 1,Private`,
  `${location},HC,103/A,HC,Level 1,Private`,
  `${location},HC,104/A,HC,Level 1,Private`,
  `${location},HC,105/A,HC,Level 1,Private`,
  `${location},HC,106/A,HC,Level 1,Private`,
  `${location},VILLA,201/A,AL,Level 1,Private`,
  `${location},MC,202/A,AL/MC,Level 1,Private`,
  `${location},SKILLED NURSING,203/A,HC,Level 1,Private`,
  `${location},"AL, MC",204/A,AL/MC,Level 1,Private`,
  `${location},"HC, MC",205/A,HC/MC,Level 1,Private`,
].join('\n');

async function insertFixture(
  roomNumber: string,
  month = uploadMonth,
  levelOfCare: string | null = null,
  serviceLine = 'HC',
) {
  await pool.query(
    `INSERT INTO rent_roll_data
      (upload_month, date, location, room_number, room_type, service_line,
       occupied_yn, size, street_rate, in_house_rate, client_id, level_of_care)
     VALUES ($1, $2, $3, $4, 'Private', $5, true, 'Private', 100, 100, $6, $7)`,
    [month, `${month}-01`, location, roomNumber, serviceLine, clientId, levelOfCare],
  );
}

async function insertHistoryFixture(roomNumber: string, serviceLine = 'HC') {
  await pool.query(
    `INSERT INTO rent_roll_history
      (upload_month, date, location, location_id, room_number, room_type,
       service_line, occupied_yn, size, street_rate, in_house_rate)
     VALUES ($1, $2, $3, $4, $5, 'Private', $6, true, 'Private', 100, 100)`,
    [uploadMonth, `${uploadMonth}-01`, location, locationId, roomNumber, serviceLine],
  );
}

async function run() {
  try {
    const locationResult = await pool.query(
      'INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id',
      [location, clientId],
    );
    locationId = locationResult.rows[0].id;
    await insertFixture('101');
    await insertFixture('102');
    await insertFixture('103/A', uploadMonth, 'KEEP');
    await insertFixture('104', '2099-11');
    await insertFixture('106/A');
    await insertFixture('201/A', uploadMonth, null, 'VIL');
    await insertFixture('202/A', uploadMonth, null, 'AL/MC');
    await insertFixture('203/A');
    await insertFixture('204/A', uploadMonth, null, 'AL/MC');
    await insertFixture('205/A', uploadMonth, null, 'HC/MC');
    await insertHistoryFixture('105');
    await insertHistoryFixture('106');

    const parsed = parseMatrixCareRateProductLabelRows(Buffer.from(csv), 'fixture.csv');
    assert.equal(parsed[0]?.roomNumber, '101/A');
    assert.equal(parsed.length, 12);
    assert.equal(parsed.find((row) => row.roomNumber === '201/A')?.serviceLine, 'VIL');
    assert.equal(parsed.find((row) => row.roomNumber === '202/A')?.serviceLine, 'AL/MC');
    assert.equal(parsed.find((row) => row.roomNumber === '203/A')?.serviceLine, 'HC');
    assert.equal(parsed.find((row) => row.roomNumber === '204/A')?.serviceLine, 'AL/MC');
    assert.equal(parsed.find((row) => row.roomNumber === '205/A')?.serviceLine, 'HC/MC');

    const dryRun = await backfillMatrixCareRateProductLabels(
      Buffer.from(csv),
      uploadMonth,
      clientId,
      { fileName: 'fixture.csv', dryRun: true },
    );
    assert.equal(dryRun.updatedRows, 10);
    assert.equal(dryRun.updatedFields, 29);
    assert.equal(
      dryRun.unresolved.filter((row) => row.reason === 'conflicting_source_rows_for_legacy_room_identity').length,
      2,
    );
    assert.ok(dryRun.unresolved.some((row) => row.roomNumber === '104/A'));

    const beforeDryRun = await pool.query(
      `SELECT room_number, level_of_care, care_level, other_premium_feature
       FROM rent_roll_data
       WHERE location = $1 AND upload_month = $2
       ORDER BY room_number`,
      [location, uploadMonth],
    );
    assert.equal(beforeDryRun.rows.find((row) => row.room_number === '102')?.level_of_care, null);
    assert.equal(beforeDryRun.rows.find((row) => row.room_number === '103/A')?.level_of_care, 'KEEP');
    const historyBeforeDryRun = await pool.query(
      `SELECT level_of_care, care_level, other_premium_feature
       FROM rent_roll_history
       WHERE location_id = $1 AND upload_month = $2`,
      [locationId, uploadMonth],
    );
    assert.equal(historyBeforeDryRun.rows[0]?.level_of_care, null);

    const applied = await backfillMatrixCareRateProductLabels(
      Buffer.from(csv),
      uploadMonth,
      clientId,
      { fileName: 'fixture.csv', dryRun: false },
    );
    assert.equal(applied.updatedRows, 10);

    const afterApply = await pool.query(
      `SELECT room_number, level_of_care, care_level, other_premium_feature
       FROM rent_roll_data
       WHERE location = $1 AND upload_month = $2
       ORDER BY room_number`,
      [location, uploadMonth],
    );
    const room102 = afterApply.rows.find((row) => row.room_number === '102');
    assert.deepEqual(
      [room102?.level_of_care, room102?.care_level, room102?.other_premium_feature],
      ['HC', 'Level 1', 'Private'],
    );
    const room103 = afterApply.rows.find((row) => row.room_number === '103/A');
    assert.deepEqual(
      [room103?.level_of_care, room103?.care_level, room103?.other_premium_feature],
      ['KEEP', 'Level 1', 'Private'],
    );
    const historyAfterApply = await pool.query(
      `SELECT level_of_care, care_level, other_premium_feature
       FROM rent_roll_history
       WHERE location_id = $1 AND upload_month = $2`,
      [locationId, uploadMonth],
    );
    assert.deepEqual(
      [
        historyAfterApply.rows[0]?.level_of_care,
        historyAfterApply.rows[0]?.care_level,
        historyAfterApply.rows[0]?.other_premium_feature,
      ],
      ['HC', 'Level 1', 'Private'],
    );

    const repeat = await backfillMatrixCareRateProductLabels(
      Buffer.from(csv),
      uploadMonth,
      clientId,
      { fileName: 'fixture.csv', dryRun: true },
    );
    assert.equal(repeat.updatedRows, 0);
    assert.equal(repeat.alreadyCompleteRows, 10);
    console.log('✓ MatrixCare rate-product label backfill matches legacy room identities safely');
  } finally {
    await pool.query('DELETE FROM rent_roll_data WHERE location = $1', [location]);
    await pool.query('DELETE FROM rent_roll_history WHERE location = $1', [location]);
    await pool.query('DELETE FROM locations WHERE id = $1', [locationId]);
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});