(() => {
  const { sb } = window.gcbtp;

  async function requireAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  }

  async function currentProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
    return data;
  }

  window.gcbtp.requireAuth = requireAuth;
  window.gcbtp.logout = logout;
  window.gcbtp.currentProfile = currentProfile;
})();
