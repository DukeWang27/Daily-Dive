// Who is playing. Sign-in, the player's own profile, and every question the game asks the database.
// The game works without any of this: with no database configured (game.js, BACKEND) everyone is a guest and
// progress stays on the device. Nothing here stores a password or a secret key: sign-in is handled by Supabase
// (vendor/supabase.js), using the project's public key only.
(function () {
  "use strict";
  let sb = null, session = null, profile = null, state = "off", recovery = false, demo = null, starting = null, providers = [], arrived = "", leaving = false, expired = false;
  // Arriving from an email link: Supabase puts what kind of link it was in the address. Read it before the library
  // tidies the address away, so the screen can say "Email confirmed" or ask for a new password.
  try { const hp = new URLSearchParams(location.hash.replace(/^#/, "")); arrived = hp.get("type") || ""; } catch { /* fine */ }
  const listeners = [];
  // state: "off" no database · "out" signed out · "new" signed in, no username yet · "in" a player
  const emit = () => listeners.slice().forEach(f => { try { f(api); } catch (e) { console.error(e); } });
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load")); document.head.append(s); });

  // What the database's refusals mean, in plain words.
  const SAY = {
    username_format: "Usernames are 3 to 20 letters, numbers or underscores, starting with a letter.",
    username_taken: "That username is taken.", username_reserved: "That username is reserved.", username_unsuitable: "That username isn't allowed.",
    username_too_soon: "You changed your username recently. You can change it again in a couple of weeks.",
    already_has_profile: "This account already has a username.", not_signed_in: "Sign in first.", no_profile: "Choose a username first.",
    rate_limited: "That's a lot at once. Give it a minute and try again.", not_found: "No player by that name.", yourself: "That's you.",
    friends_only: "Only friends can see that.", private: "This player keeps their dives private.", locked: "Finish your own dive for that day first.",
    no_dive: "No dive on that day.", no_request: "That request is no longer there.", you_blocked_them: "You've blocked this player. Unblock them first.",
    too_many_requests: "You have a lot of requests waiting. Let some be answered first.", too_many_friends: "Your friends list is full.",
    day_closed: "That day is over, so it can't be handed in any more.", bad_guesses: "That dive couldn't be read.",
    // The race
    race_not_found: "There's no race with that code, or it has finished.", race_started: "That race has already started.", race_full: "That race is full.",
    not_in_race: "You're not in that race any more.", no_guesses_left: "That's all three guesses for this question.", round_closed: "Time's up on that question.",
    friends_only_race: "You can only invite friends.", bad_kind: "That kind of race isn't available.",
    // Signing in. Worded so they never confirm whether someone else's email has an account.
    "Invalid login credentials": "That email and password don't match. Check them, or reset your password.",
    "User already registered": "That email can't be used to create a new account. If it's yours, sign in or reset your password.",
    "Email not confirmed": "Confirm your email first: follow the link we sent you, then sign in.",
    invalid_email: "That doesn't look like an email address.", weak_password: "Passwords need at least 6 characters.",
    session_expired: "You were signed out because your session ran out. Sign in again to carry on.",
    rate_limited_auth: "Too many tries in a short time. Wait a minute, then try again.",
    offline: "Couldn't reach the server. Check your connection and try again.", unavailable: "The game's server isn't answering right now. Try again in a moment.",
  };
  // Every error a player sees goes through here, and comes out as one of the sentences above. Nothing technical
  // (no raw server text, codes, or "null") ever reaches the screen.
  function fail(error) {
    const raw = String((error && (error.message || error.msg || error.error_description)) || (typeof error === "string" ? error : "") || ""), status = error && (error.status || error.code);
    let code = (raw.match(/^[a-z_]+$/) || [raw])[0];
    if (!SAY[code]) {
      if (/password/i.test(raw) && /6|short|weak|characters/i.test(raw)) code = "weak_password";
      else if (/invalid.*email|email.*invalid|unable to validate email/i.test(raw)) code = "invalid_email";
      else if (/jwt.*expired|invalid jwt|refresh token|session.*(missing|expired|not found)/i.test(raw)) code = "session_expired";
      else if (/rate limit|security purposes|too many/i.test(raw) || status === 429) code = "rate_limited_auth";
      else if (/fetch|network|load failed|networkerror|timed? ?out/i.test(raw)) code = "offline";
      else if (status >= 500 || /service unavailable|bad gateway/i.test(raw)) code = "unavailable";
    }
    const e = new Error(SAY[code] || "Something went wrong. Try again."); e.code = code; return e;
  }
  async function rpc(name, args = {}) {
    if (demo) return demo.rpc(name, args);
    if (!sb) throw fail("not_signed_in");
    const { data, error } = await sb.rpc(name, args);
    if (error) throw fail(error);
    return data;
  }
  async function refresh() {
    const before = state + ":" + (profile && profile.username);
    if (demo) { profile = await demo.rpc("me"); state = "in"; }
    else if (!sb) state = "off";
    else if (!session) { profile = null; state = "out"; }
    else { try { profile = await rpc("me"); state = profile ? "in" : "new"; } catch (e) { if (e.code === "not_signed_in") { profile = null; state = "out"; } } }
    emit();
    return before !== state + ":" + (profile && profile.username);
  }
  // Where Supabase sends the player back to after an email link or Google. (The tests keep their settings in the address.)
  const here = () => location.origin + location.pathname + (/[?&]test\b/.test(location.search) ? location.search : "");

  const api = {
    // Call once. Resolves when it is known whether someone is signed in.
    init(cfg) {
      if (starting) return starting;
      starting = (async () => {
        if (cfg && cfg.demo) { demo = cfg.demo; await refresh(); return true; }
        if (!cfg || !cfg.url || !cfg.anonKey) { state = "off"; emit(); return false; }
        providers = Array.isArray(cfg.providers) ? cfg.providers.slice() : [];   // other ways to sign in (none at launch; see BACKEND.md)
        try {
          if (!window.supabase) await loadScript("vendor/supabase.js");
          sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "iceberg:auth" } });
          sb.auth.onAuthStateChange((event, s) => {
            session = s; if (event === "PASSWORD_RECOVERY") recovery = true;
            if (event === "SIGNED_OUT" && !leaving && profile) expired = true;   // signed out without asking: the session ran out
            if (event === "SIGNED_IN") { expired = false; leaving = false; }
            setTimeout(refresh, 0);                     // never call back into the library from inside its own callback
          });
          session = (await sb.auth.getSession()).data.session;
          await refresh();
          return true;
        } catch (e) { sb = null; state = "off"; emit(); return false; }
      })();
      return starting;
    },
    get state() { return state; }, get on() { return state !== "off"; }, get signedIn() { return state === "in"; }, get demo() { return !!demo; },
    get profile() { return profile; }, get email() { return session && session.user ? session.user.email : ""; },
    get recovery() { return recovery; }, get providers() { return providers.slice(); },
    // "signup" when the player has just followed the link in their confirmation email (shown once, then cleared).
    takeArrival() { const a = arrived; arrived = ""; return a; },
    takeExpired() { const e = expired; expired = false; return e; },
    onChange(f) { listeners.push(f); }, refresh, rpc,
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
      if (error) throw fail(error);
      if (data.user && data.user.identities && data.user.identities.length === 0 && !data.session) throw fail("User already registered");
      if (!data.session) return { confirm: true };     // the project asks new players to confirm their email first
      session = data.session; await refresh(); return { confirm: false };
    },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw fail(error); session = data.session; await refresh(); },
    // Ready for a provider such as Google later: only offered when listed in BACKEND.providers.
    async signInWith(provider) { if (!providers.includes(provider)) throw fail("unavailable"); const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: here() } }); if (error) throw fail(error); },
    async resend(email) { const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: here() } }); if (error) throw fail(error); },
    async recover(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() }); if (error) throw fail(error); },
    async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw fail(error); recovery = false; emit(); },
    async signOut() { if (demo) return; leaving = true; await sb.auth.signOut(); session = null; profile = null; state = "out"; emit(); },
    async claim(username, avatar) { profile = await rpc("claim_profile", { p_username: username, p_avatar: avatar || "dumbo" }); state = "in"; emit(); return profile; },
    async remove() { await rpc("delete_account"); leaving = true; if (sb) await sb.auth.signOut().catch(() => {}); session = null; profile = null; state = demo ? "in" : "out"; emit(); },
    // A realtime channel for one race: a "poke" from anyone in it means "something changed, ask again".
    // Only a nudge: the race itself is always read from the database. Off in tests (the stand-in server has no realtime).
    channel(name, onPoke) {
      if (demo || !sb || new URLSearchParams(location.search).has("test")) return null;
      try { const ch = sb.channel(name, { config: { broadcast: { self: false } } }); ch.on("broadcast", { event: "poke" }, onPoke).subscribe(); return ch; } catch { return null; }
    },
    fail,
  };
  window.Account = api;
})();
