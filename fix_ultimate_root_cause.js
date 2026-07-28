const { supabase } = require('./dist/config/supabase');

(async () => {
  console.log('🧹 Clearing all corrupted chat histories in patient_chat_sessions in Supabase DB...');
  
  const { data, error } = await supabase
    .from('patient_chat_sessions')
    .update({
      active_session: [],
      last_state: 'INIT',
      updated_at: new Date().toISOString()
    })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    console.error('❌ Error resetting patient sessions:', error.message);
  } else {
    console.log('✅ Successfully reset all patient sessions in Supabase PostgreSQL!');
  }
})();
