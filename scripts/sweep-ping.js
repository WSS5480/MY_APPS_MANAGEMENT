// Render cron job (every 10 min): wakes the tracker so visit reminders and missed-visit alerts go out on time.
const url = (process.env.TRACKER_URL || 'https://three60-medical-surgical-case-tracker.onrender.com').replace(/\/$/, '');
(async () => {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url + '/api/cron/sweep', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET || '' } });
      console.log(r.status, await r.text());
      if (r.ok) return;
    } catch (e) { console.log('waiting for the service to wake up:', e.message); }
    await new Promise(r => setTimeout(r, 20000));
  }
  process.exit(1);
})();
