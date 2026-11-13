/**
 * The Supabase project behind accounts. Both values are meant to be public: the anon
 * (publishable) key only lets a signed-in person reach their own rows, which the row-level
 * security in `supabase/schema.sql` enforces. Left empty, the app has no accounts at all.
 */
export const SUPABASE_URL = 'https://eygcqgjsfuhawaimjkxg.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_kMtAcHLpre3B_vgC3IVmCg_uaFUPFGg';
