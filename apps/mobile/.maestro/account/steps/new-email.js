// A fresh address for this run, so the flows never meet an account from an earlier one.
output.email = 'tourist-' + Date.now() + '@example.com';
// The local stack's seed password, passed with -e (never written here).
if (typeof PASSWORD === 'undefined')
  throw new Error('-e PASSWORD=<SEED_ACCOUNT_PASSWORD from services/identity/.env>');
output.password = PASSWORD;
