// Render cron job: wakes the tracker and asks it to send the Monday digest push notifications.
const url = (process.env.TRACKER_URL || 'https://three60-medical-surgical-case-tracker.onrender.com').replace(/\/$/, '');
(async () => {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url + '/api/cron/digest', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET || '' } });
      const t = await r.text(); console.log(r.status, t);
      if (r.ok) return;
    } catch (e) { console.log('waiting for the service to wake up:', e.message); }
    await new Promise(r => setTimeout(r, 20000));
  }
  process.exit(1);
})();
