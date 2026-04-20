require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// GET all proposals
app.get('/api/proposals', async (req, res) => {
  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .order('company')
    .order('time_period');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET summary stats
app.get('/api/summary', async (req, res) => {
  const { data, error } = await supabase.from('proposals').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const parseValue = (v) => {
    if (!v || v === 'TBD') return 0;
    const n = parseFloat(v.replace(/[₹L\s]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const hot = data.filter(p => p.type === 'hot');
  const warm = data.filter(p => p.type === 'warm');
  const won = data.filter(p => p.status === 'won');
  const closingNow = data.filter(p => ['april_wk1', 'april_wk2'].includes(p.time_period));

  res.json({
    hot_count: hot.length,
    hot_value: hot.reduce((s, p) => s + parseValue(p.value), 0),
    warm_count: warm.length,
    warm_value: warm.reduce((s, p) => s + parseValue(p.value), 0),
    closing_now: closingNow.length,
    won_count: won.length,
    won_value: won.reduce((s, p) => s + parseValue(p.value), 0),
    total_value: data.reduce((s, p) => s + parseValue(p.value), 0),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
