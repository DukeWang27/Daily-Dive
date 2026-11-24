# Third-party code

`supabase.js` is the browser build of `@supabase/supabase-js` 2.119.2 (MIT licence, © Supabase), copied unchanged
from the npm package (`dist/umd/supabase.js`). It handles sign-in and talks to the database. The game only loads
it when a database is configured in `game.js`. To update it, replace the file with the same file from a newer
release.
