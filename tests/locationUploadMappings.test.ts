/**
 * Location upload regression test.
 *
 * Verifies that the Location template's MatrixCare mappings and metadata are
 * persisted, blank optional cells do not clear existing values, and a
 * same-named location in another tenant is not modified.
 *
 * Requires the dev server on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/locationUploadMappings.test.ts
 */
import { pool } from "../server/db";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const CLIENT = "demo";
const SUFFIX = `${Date.now()}-${process.pid}`;
const LOCATION_NAME = `Location Upload Mapping ${SUFFIX}`;
const OTHER_CLIENT = `location-upload-other-${SUFFIX}`;

const LOCATION_HEADERS = [
  "Location Name",
  "Location Code",
  "Region",
  "Division",
  "Location Class",
  "Address",
  "City",
  "State",
  "Zip Code",
  "Total Units",
  "Same Store",
  "MatrixCare Name HC",
  "MatrixCare Name AL",
  "MatrixCare Name IL",
  "Customer Facility ID HC",
  "Customer Facility ID AL",
  "Customer Facility ID IL",
];

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`${PASS} ${description}`);
  } else {
    failed++;
    console.log(`${FAIL} ${description}${detail ? `\n    ${detail}` : ""}`);
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function locationCsv(values: Partial<Record<typeof LOCATION_HEADERS[number], unknown>>) {
  return [
    LOCATION_HEADERS.map(csvCell).join(","),
    LOCATION_HEADERS.map((header) => csvCell(values[header])).join(","),
    "",
  ].join("\n");
}

async function uploadLocation(values: Partial<Record<typeof LOCATION_HEADERS[number], unknown>>) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([locationCsv(values)], { type: "text/csv" }),
    "locations.csv",
  );

  const response = await fetch(`${BASE}/api/upload/locations`, {
    method: "POST",
    body: form,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`location upload failed: ${response.status} ${body}`);
  }
  return JSON.parse(body) as { recordsProcessed: number; created: number; updated: number };
}

async function cleanup() {
  await pool.query(
    `DELETE FROM locations
      WHERE (client_id = $1 AND name = $2)
         OR client_id = $3`,
    [CLIENT, LOCATION_NAME, OTHER_CLIENT],
  );
  await pool.query(`DELETE FROM clients WHERE id = $1`, [OTHER_CLIENT]);
}

async function main() {
  await cleanup();
  try {
    await pool.query(
      `INSERT INTO clients (id, name) VALUES ($1, 'Location Upload Mapping Test')`,
      [OTHER_CLIENT],
    );
    await pool.query(
      `INSERT INTO locations
         (client_id, name, location_code, total_units, same_store,
          matrixcare_name_hc, matrixcare_name_al, matrixcare_name_il,
          customer_facility_id_hc, customer_facility_id_al, customer_facility_id_il)
       VALUES ($1, $2, 'OTHER-CODE', 17, false,
               'Other Tenant HC', 'Other Tenant AL', 'Other Tenant IL',
               'OTHER-HC-ID', 'OTHER-AL-ID', 'OTHER-IL-ID')`,
      [OTHER_CLIENT, LOCATION_NAME],
    );

    const initial = await uploadLocation({
      "Location Name": LOCATION_NAME,
      "Location Code": "0420",
      Region: "Midwest",
      Division: "North",
      "Location Class": "Same Store",
      Address: "1 Test Way",
      City: "Testville",
      State: "OH",
      "Zip Code": "43000",
      "Total Units": 123,
      "Same Store": "Y",
      "MatrixCare Name HC": "Test Campus Health Center",
      "MatrixCare Name AL": "Test Campus Assisted Living",
      "MatrixCare Name IL": "Test Campus Independent Living",
      "Customer Facility ID HC": "HC-0420",
      "Customer Facility ID AL": "AL-0420",
      "Customer Facility ID IL": "IL-0420",
    });
    assert(
      "full location upload creates one location",
      initial.created === 1 && initial.updated === 0 && initial.recordsProcessed === 1,
      JSON.stringify(initial),
    );

    const loaded = await pool.query(
      `SELECT location_code, total_units, same_store,
              matrixcare_name_hc, matrixcare_name_al, matrixcare_name_il,
              customer_facility_id_hc, customer_facility_id_al, customer_facility_id_il
         FROM locations
        WHERE client_id = $1 AND name = $2`,
      [CLIENT, LOCATION_NAME],
    );
    const row = loaded.rows[0];
    assert("uploaded location exists in the current tenant", loaded.rows.length === 1);
    assert(
      "location code, unit count, and same-store flag persist",
      row?.location_code === "0420"
        && row?.total_units === 123
        && row?.same_store === true,
      JSON.stringify(row),
    );
    assert(
      "all six MatrixCare mapping fields persist",
      row?.matrixcare_name_hc === "Test Campus Health Center"
        && row?.matrixcare_name_al === "Test Campus Assisted Living"
        && row?.matrixcare_name_il === "Test Campus Independent Living"
        && row?.customer_facility_id_hc === "HC-0420"
        && row?.customer_facility_id_al === "AL-0420"
        && row?.customer_facility_id_il === "IL-0420",
      JSON.stringify(row),
    );

    const blankFollowUp = await uploadLocation({ "Location Name": LOCATION_NAME });
    assert(
      "blank optional follow-up updates the row without creating another location",
      blankFollowUp.created === 0 && blankFollowUp.updated === 1 && blankFollowUp.recordsProcessed === 1,
      JSON.stringify(blankFollowUp),
    );

    const afterBlank = await pool.query(
      `SELECT location_code, total_units, same_store,
              matrixcare_name_hc, matrixcare_name_al, matrixcare_name_il,
              customer_facility_id_hc, customer_facility_id_al, customer_facility_id_il
         FROM locations
        WHERE client_id = $1 AND name = $2`,
      [CLIENT, LOCATION_NAME],
    );
    assert(
      "blank optional cells preserve existing mappings and metadata",
      JSON.stringify(afterBlank.rows[0]) === JSON.stringify(row),
      `before=${JSON.stringify(row)} after=${JSON.stringify(afterBlank.rows[0])}`,
    );

    const otherTenant = await pool.query(
      `SELECT client_id, location_code, total_units, same_store,
              matrixcare_name_hc, matrixcare_name_al, matrixcare_name_il,
              customer_facility_id_hc, customer_facility_id_al, customer_facility_id_il
         FROM locations
        WHERE client_id = $1 AND name = $2`,
      [OTHER_CLIENT, LOCATION_NAME],
    );
    assert(
      "same-named location in another tenant remains unchanged",
      otherTenant.rows.length === 1
        && otherTenant.rows[0].location_code === "OTHER-CODE"
        && otherTenant.rows[0].total_units === 17
        && otherTenant.rows[0].same_store === false
        && otherTenant.rows[0].matrixcare_name_hc === "Other Tenant HC"
        && otherTenant.rows[0].matrixcare_name_al === "Other Tenant AL"
        && otherTenant.rows[0].matrixcare_name_il === "Other Tenant IL"
        && otherTenant.rows[0].customer_facility_id_hc === "OTHER-HC-ID"
        && otherTenant.rows[0].customer_facility_id_al === "OTHER-AL-ID"
        && otherTenant.rows[0].customer_facility_id_il === "OTHER-IL-ID",
      JSON.stringify(otherTenant.rows[0]),
    );
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});