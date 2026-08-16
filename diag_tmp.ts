import crypto from 'crypto';
import pg from 'pg';
const secret = process.env.SESSION_SECRET!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BASE = 'http://127.0.0.1:5000';

(async () => {
  const sid = 'diag-' + crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  await pool.query(
    `INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT (sid) DO UPDATE SET sess=EXCLUDED.sess`,
    [sid, JSON.stringify({ cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' }, clientId: 'trilogy' }),
     new Date(Date.now() + 3600_000)]);
  const cookie = `connect.sid=s%3A${sid}.${encodeURIComponent(sig)}`;
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  // The rule from the user's screenshot: RT occupancy >= 90, +4%, AL/MC + AL
  const cases = [
    { label: 'screenshot rule (RT occ >= 90, +4%)',
      description: 'If Room Type Occupancy (Current Month) is greater than or equal to 90, Increase rate by 4%',
      serviceLines: ['AL/MC', 'AL'] },
    { label: 'studio rule, all SLs',
      description: 'If Service Line Occupancy (Current Month) is greater than or equal to 0 AND Street Rate to Top Comp Var % is less than 60, Increase rate by 4% for Studio',
      serviceLines: null },
  ];

  for (const c of cases) {
    const res = await fetch(`${BASE}/api/adjustment-rules`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ description: c.description, preview: true, locationId: null,
                             serviceLine: null, serviceLines: c.serviceLines }),
    });
    const d: any = await res.json();
    console.log(`\n=== ${c.label} ===`);
    console.log(`units=${d.affectedUnits}  campuses=${d.affectedCampuses}  moveIns/mo=${d.moveInsPerMonth}  monthly=$${d.monthlyImpact}`);
    console.log('service lines impacted:');
    for (const s of d.serviceLineBreakdown ?? []) {
      console.log(`   ${String(s.serviceLine).padEnd(8)} units=${String(s.unitCount).padStart(5)}  moveIns/mo=${String(s.moveInsPerMonth).padStart(6)}  monthly=$${String(s.monthlyImpact).padStart(8)}`);
    }
    const slUnits = (d.serviceLineBreakdown ?? []).reduce((a: number, s: any) => a + s.unitCount, 0);
    const slMonthly = (d.serviceLineBreakdown ?? []).reduce((a: number, s: any) => a + s.monthlyImpact, 0);
    console.log(`   tie-out: units ${slUnits} vs ${d.affectedUnits} ${slUnits === d.affectedUnits ? 'OK' : 'MISMATCH'}` +
                ` | monthly ${slMonthly} vs ${d.monthlyImpact} (${Math.abs(slMonthly - d.monthlyImpact) <= 2 ? 'OK, rounding' : 'MISMATCH'})`);
  }

  await pool.query(`DELETE FROM sessions WHERE sid=$1`, [sid]);
  await pool.end();
})();
