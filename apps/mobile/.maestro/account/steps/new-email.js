// A fresh address for this run, so the flows never meet an account from an earlier one.
output.email = 'tourist-' + Date.now() + '@example.com';
// Made for this run (letters, digits and hyphens: a space sends the keyboard astray).
output.password = 'run-' + Date.now() + '-pass';
