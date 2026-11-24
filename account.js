// Who is playing. Sign-in, the player's own profile, and every question the game asks the database.
// The game works without any of this: with no database configured (game.js, BACKEND) everyone is a guest and
// progress stays on the device. Nothing here stores a password or a secret key: sign-in is handled by Supabase
// (vendor/supabase.js), using the project's public key only.
(function () {
  "use strict";
  let sb = null, session = null, profile = null, state = "off", recovery = false, demo = null, starting = null, google = false;
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
    "Invalid login credentials": "That email and password don't match.", "User already registered": "There's already an account with that email. Sign in instead.",
    "Email not confirmed": "Check your email and follow the link to confirm your address, then sign in.",
  };
  function fail(error) {
    const raw = String((error && (error.message || error.msg || error.error_description)) || error || ""), code = (raw.match(/^[a-z_]+$/) || [raw])[0];
    const e = new Error(SAY[code] || (/password/i.test(raw) && /6|short|weak/i.test(raw) ? "Passwords need at least 6 characters." : /fetch|network|load/i.test(raw) ? "Couldn't reach the server. Check your connection and try again." : raw && raw.length < 120 && !/^[a-z_]+$/.test(raw) ? raw : "Something went wrong. Try again."));
    e.code = code; return e;
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
        google = !!cfg.google;
        try {
          if (!window.supabase) await loadScript("vendor/supabase.js");
          sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "iceberg:auth" } });
          sb.auth.onAuthStateChange((event, s) => {
            session = s; if (event === "PASSWORD_RECOVERY") recovery = true;
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
    get recovery() { return recovery; }, get google() { return google; },
    onChange(f) { listeners.push(f); }, refresh, rpc,
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
      if (error) throw fail(error);
      if (data.user && data.user.identities && data.user.identities.length === 0 && !data.session) throw fail("User already registered");
      if (!data.session) return { confirm: true };     // the project asks new players to confirm their email first
      session = data.session; await refresh(); return { confirm: false };
    },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw fail(error); session = data.session; await refresh(); },
    async withGoogle() { const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here() } }); if (error) throw fail(error); },
    async recover(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() }); if (error) throw fail(error); },
    async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw fail(error); recovery = false; emit(); },
    async signOut() { if (demo) return; await sb.auth.signOut(); session = null; profile = null; state = "out"; emit(); },
    async claim(username, avatar) { profile = await rpc("claim_profile", { p_username: username, p_avatar: avatar || "dumbo" }); state = "in"; emit(); return profile; },
    async remove() { await rpc("delete_account"); if (sb) await sb.auth.signOut().catch(() => {}); session = null; profile = null; state = demo ? "in" : "out"; emit(); },
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
