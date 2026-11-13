/**
 * The Supabase project behind accounts. Both values are meant to be public: the anon
 * (publishable) key only lets a signed-in person reach their own rows, which the row-level
 * security in `supabase/schema.sql` enforces. Left empty, the app has no accounts at all.
 */
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
