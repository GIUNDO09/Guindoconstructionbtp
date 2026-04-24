(() => {
  const SUPABASE_URL = 'https://aqbtphtqurkunfawnvvg.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_mBWoSWwDqj_lfP6yNAk6VQ_M6ZYGeVI';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  window.gcbtp = { sb };
})();
