const fetch = require('node-fetch');
const { execSync, spawn } = require('child_process');

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Starting dev server in background...');
  const proc = spawn('npm', ['run', 'dev'], { shell: true, stdio: 'inherit' });

  console.log('Waiting 3s for server to start...');
  await wait(3000);

  try {
    const res = await fetch('http://localhost:3000');
    console.log('GET / ->', res.status);
    if (res.status !== 200) throw new Error('Homepage did not return 200');

    // Test auth endpoints (no token) - should return 200 or null body
    const me = await fetch('http://localhost:3000/api/auth/me');
    console.log('/api/auth/me status', me.status);

    console.log('Smoke tests passed (basic connectivity)');
  } catch (err) {
    console.error('Smoke test failed', err);
    process.exit(1);
  } finally {
    console.log('Killing dev server');
    proc.kill();
  }
}

main();
