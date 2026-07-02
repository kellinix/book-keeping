const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const userId = process.env.SEED_USER_ID || require('crypto').randomUUID();
  const businessId = require('crypto').randomUUID();

  try {
    console.log('Inserting profile...');
    await supabase.from('profiles').upsert([{ id: userId, full_name: 'Demo User', email: 'demo@example.com' }]);

    console.log('Inserting business...');
    await supabase.from('businesses').upsert([{ id: businessId, owner_id: userId, name: 'Demo Business', base_currency: 'GBP', corporation_tax_rate: 25 }]);

    console.log('Inserting categories...');
    const categories = ['Revenue','Software','Marketing','Contractor/Freelancer','Office/Admin','Travel','Equipment','Professional Services','Bank Fees','Tax','Other'].map((name) => ({ business_id: businessId, name }));
    await supabase.from('categories').insert(categories);

    console.log('Inserting sample transactions...');
    const now = new Date();
    const txs = [
      { user_id: userId, business_id: businessId, transaction_date: now.toISOString().slice(0,10), description: 'Acme subscription', merchant: 'Acme', amount: 49.99, currency: 'GBP', type: 'expense', category: 'Software', source: 'manual', tax_deductible: true },
      { user_id: userId, business_id: businessId, transaction_date: now.toISOString().slice(0,10), description: 'Website dev', merchant: 'Dev Co', amount: 1200.0, currency: 'GBP', type: 'expense', category: 'Professional Services', source: 'manual', tax_deductible: true },
      { user_id: userId, business_id: businessId, transaction_date: now.toISOString().slice(0,10), description: 'Client payment', merchant: 'Client A', amount: 5000.0, currency: 'GBP', type: 'income', category: 'Revenue', source: 'manual', tax_deductible: false }
    ];
    await supabase.from('transactions').insert(txs);

    console.log('Seed complete.');
    console.log('SEED_USER_ID (optional for login simulation):', userId);
  } catch (err) {
    console.error('Seed error', err);
    process.exit(1);
  }
}

main();
