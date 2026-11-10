/* Configurazione della sincronizzazione (Supabase). Lascia vuoto per usare l'app solo in locale.
   L'indirizzo e la chiave "anon/publishable" sono pensati per essere pubblici: i dati restano protetti
   dalle regole di sicurezza del database (vedi supabase/setup.sql) e dall'accesso con email e password. */
window.GESTIONALE_CONFIG = {
  supabaseUrl: 'https://kdypfxgunwsyzbkmuvqy.supabase.co',
  supabaseKey: 'sb_publishable_R6ERl2aRPIi88ESnALUqtQ_gMxP-6Ro',
  // Schede che NON vengono mai inviate online: restano solo sul dispositivo.
  // Fatture e dati degli studenti (minorenni). Togli 'studenti' e 'valutazioni' da qui solo se vuoi sincronizzarli.
  localOnly: ['fatture', 'studenti', 'valutazioni'],
};
