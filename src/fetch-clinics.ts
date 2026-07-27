import { supabase } from './config/supabase';

async function fetchRealData() {
  console.log('🔍 Fetching existing Clinics and Offerings from Supabase...\n');

  const { data: clinics, error: clinicErr } = await supabase.from('clinics').select('id, name');
  if (clinicErr) {
    console.error('Clinics error:', clinicErr.message);
  } else {
    console.log('🏥 Existing Clinics:', clinics);
  }

  const { data: offerings, error: offeringErr } = await supabase.from('clinic_offerings').select('id, service_id, doctor_id, clinic_id');
  if (offeringErr) {
    console.error('Offerings error:', offeringErr.message);
  } else {
    console.log('🩺 Existing Clinic Offerings:', offerings);
  }
}

fetchRealData();
