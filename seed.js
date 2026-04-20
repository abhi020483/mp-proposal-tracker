require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const proposals = [
  // Hetero
  { company: 'Hetero', deliverable: 'Conferences', value: '₹12 L', type: 'hot', status: 'won', time_period: 'march_wk3' },
  { company: 'Hetero', deliverable: 'ISP', value: '₹3.5 L', type: 'hot', status: null, time_period: 'march_wk3' },
  { company: 'Hetero', deliverable: 'Email platform', value: 'TBD', type: 'hot', status: null, time_period: 'march_wk3' },
  { company: 'Hetero', deliverable: 'Logistics', value: 'TBD', type: 'hot', status: null, time_period: 'march_wk3' },
  { company: 'Hetero', deliverable: 'IHEFCARD/Phil', value: '₹12 L', type: 'hot', status: 'won', time_period: 'march_wk4' },
  { company: 'Hetero', deliverable: 'Case series', value: '₹1.3 L', type: 'hot', status: null, time_period: 'april_wk1' },
  { company: 'Hetero', deliverable: 'Gastro', value: '₹1.2 L', type: 'hot', status: null, time_period: 'april_wk1' },
  { company: 'Hetero', deliverable: 'KCS & Case studies', value: '₹5 L', type: 'warm', status: null, time_period: 'april_wk1' },
  { company: 'Hetero', deliverable: 'EAN', value: '₹30 L', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'CP/GP plan', value: '₹20 L', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'ESC Endorsement', value: '₹20 L', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'Marketing plans', value: '₹15 L', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'ADA Congress', value: '₹1.5 L', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'In Person ISP', value: 'TBD', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'LATAM Meeting', value: 'TBD', type: 'hot', status: 'discussion', time_period: 'april_wk2' },
  { company: 'Hetero', deliverable: 'Reg. meetings', value: 'TBD', type: 'hot', status: null, time_period: 'june_plus', client_contact: 'June Wk-3' },
  { company: 'Hetero', deliverable: 'ISPs', value: '₹9 L', type: 'hot', status: null, time_period: 'june_plus', client_contact: 'August' },

  // Bayer
  { company: 'Bayer', deliverable: 'HEOR', value: '₹50 L', type: 'hot', status: null, time_period: 'april_wk2', client_contact: 'Maheshwar' },
  { company: 'Bayer', deliverable: 'Advisory Board', value: '₹11.5 L', type: 'warm', status: null, time_period: 'june_plus', client_contact: 'Dr Rakesh Pore' },
  { company: 'Bayer', deliverable: 'Virtual meetings', value: '₹30 L', type: 'warm', status: 'won', time_period: 'june_plus' },
  { company: 'Bayer', deliverable: 'Oncology', value: '₹40 L', type: 'hot', status: 'won', time_period: 'june_plus' },

  // Lupin
  { company: 'Lupin', deliverable: 'SM', value: '₹13 L', type: 'hot', status: null, time_period: 'march_wk4', client_contact: 'Disha Rai' },
  { company: 'Lupin', deliverable: 'Digi Connect', value: '₹40 L', type: 'hot', status: null, time_period: 'april_wk2', client_contact: 'Rachana' },
  { company: 'Lupin', deliverable: 'Sema', value: 'TBD', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'Lupin', deliverable: 'PG Student', value: '₹14 L', type: 'warm', status: null, time_period: 'april_wk2' },
  { company: 'Lupin', deliverable: 'Budamet', value: '₹40 L', type: 'hot', status: 'discussion', time_period: 'may' },
  { company: 'Lupin', deliverable: 'Manipal College VR', value: '₹6.5 L', type: 'hot', status: null, time_period: 'may', client_contact: 'Prof. Rekha' },
  { company: 'Lupin', deliverable: 'Platform + Awareness', value: '₹25 L', type: 'hot', status: null, time_period: 'june_plus', client_contact: 'Budget 1L' },

  // Zydus
  { company: 'Zydus', deliverable: 'DSR', value: 'TBD', type: 'hot', status: null, time_period: 'march_wk3', client_contact: 'Dhanshree' },
  { company: 'Zydus', deliverable: 'PG proposal', value: '₹10 L', type: 'hot', status: 'won', time_period: 'april_wk1' },
  { company: 'Zydus', deliverable: 'ERS', value: '₹40 L', type: 'hot', status: 'won', time_period: 'april_wk1' },
  { company: 'Zydus', deliverable: 'Lipagyln', value: '₹20 L', type: 'hot', status: 'discussion', time_period: 'may' },
  { company: 'Zydus', deliverable: 'Neuro-Psy', value: 'TBD', type: 'warm', status: null, time_period: 'june_plus' },
  { company: 'Zydus', deliverable: 'CC', value: 'TBD', type: 'warm', status: null, time_period: 'june_plus' },
  { company: 'Zydus', deliverable: 'Cardio-Hypertension', value: 'TBD', type: 'warm', status: null, time_period: 'june_plus' },

  // Cipla
  { company: 'Cipla', deliverable: 'Farobact', value: 'TBD', type: 'warm', status: null, time_period: 'march_wk3', client_contact: 'Ketan' },
  { company: 'Cipla', deliverable: 'MRA & Hypercalemia', value: '₹36 L', type: 'hot', status: null, time_period: 'april_wk2', client_contact: 'Pallavi Jyoti' },
  { company: 'Cipla', deliverable: 'Vitalis', value: 'TBD', type: 'hot', status: null, time_period: 'april_wk2' },

  // DRL
  { company: 'DRL', deliverable: 'Videos', value: '₹1.9 L', type: 'hot', status: 'won', time_period: 'march_wk4' },
  { company: 'DRL', deliverable: 'Neonatology CME', value: 'TBD', type: 'hot', status: null, time_period: 'april_wk1' },
  { company: 'DRL', deliverable: 'Case studies', value: '₹3.8 L', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'DRL', deliverable: 'World liver day', value: 'TBD', type: 'hot', status: null, time_period: 'april_wk2' },
  { company: 'DRL', deliverable: 'Semaglutide', value: 'TBD', type: 'hot', status: null, time_period: 'april_wk4' },
  { company: 'DRL', deliverable: 'Vaccines', value: '₹5.75 L', type: 'hot', status: 'won', time_period: 'june_plus' },

  // Biological E
  { company: 'Biological E', deliverable: 'ISGPHAN', value: '₹4 L', type: 'hot', status: 'won', time_period: 'march_wk3' },
  { company: 'Biological E', deliverable: 'Hep A campaign', value: 'TBD', type: 'warm', status: null, time_period: 'april_wk3' },
  { company: 'Biological E', deliverable: '300 Blogs', value: '₹13.5 L', type: 'warm', status: null, time_period: 'april_wk3' },

  // Novo Nordisk
  { company: 'Novo Nordisk', deliverable: 'Webinar', value: '₹18 L', type: 'hot', status: 'won', time_period: 'june_plus' },

  // Astra
  { company: 'Astra', deliverable: '—', value: '₹103 L', type: 'hot', status: null, time_period: 'april_wk4', client_contact: 'Arindam' },

  // Mankind
  { company: 'Mankind', deliverable: 'UCLH', value: '₹30 L', type: 'hot', status: null, time_period: 'april_wk1', client_contact: 'Ashish' },

  // GSK
  { company: 'GSK', deliverable: 'RFQ', value: '₹1.5 L', type: 'hot', status: null, time_period: 'march_wk4', client_contact: 'Nida' },

  // KOITA
  { company: 'KOITA', deliverable: 'AI Videos', value: '₹9 L', type: 'hot', status: 'won', time_period: 'june_plus' },

  // Manipal College
  { company: 'Manipal College', deliverable: 'VR', value: '₹6.5 L', type: 'hot', status: null, time_period: 'may', client_contact: 'Prof. Rekha' },

  // Mega JK
  { company: 'Mega JK', deliverable: 'Resbutamol', value: 'TBD', type: 'warm', status: null, time_period: 'april_wk3', client_contact: 'Shailesh/Dr. Maria' },

  // Unscheduled
  { company: 'Amneal', deliverable: 'MedOnco', value: 'TBD', type: 'warm', status: null, time_period: null, client_contact: 'Jinal' },
  { company: 'Credence Genomics', deliverable: '—', value: 'TBD', type: 'warm', status: null, time_period: null, client_contact: 'Chaitra' },
  { company: 'Zeulig', deliverable: '—', value: 'TBD', type: 'warm', status: null, time_period: null, client_contact: 'Rudy' },
];

async function seed() {
  console.log('Seeding proposals to Supabase...');

  // Clear existing data
  const { error: delErr } = await supabase.from('proposals').delete().neq('id', 0);
  if (delErr) { console.error('Delete error:', delErr.message); process.exit(1); }

  const { data, error } = await supabase.from('proposals').insert(proposals).select();
  if (error) { console.error('Insert error:', error.message); process.exit(1); }

  console.log(`Seeded ${data.length} proposals successfully.`);
}

seed();
