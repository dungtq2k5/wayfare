// This run's accounts, as system.sh makes them: A and B exist (and mask alike, "a***a@…"); C, B2
// and NOBODY are addresses only.
const API = 'http://localhost:13000/api/v1';
const ts = Date.now();
output.A = 'anna' + ts + 'a@example.com';
output.B = 'alexa' + ts + 'a@example.com';
output.C = 'tourist-' + ts + '@example.com';
output.B2 = 'moved-' + ts + '@example.com';
output.NOBODY = 'nobody-' + ts + '@example.com';
output.PASSWORD = 'lantern-river-82';
output.NEWPASS = 'harbour-lamp-47';
const headers = {
  'content-type': 'application/json',
  'x-wayfare-client': 'mobile',
  'x-wayfare-app-version': '0.1.0',
};
for (const email of [output.A, output.B]) {
  http.post(API + '/auth/register', {
    headers: headers,
    body: JSON.stringify({
      email: email,
      password: output.PASSWORD,
      preferredLocale: 'en',
      termsVersion: '2026-09-01',
    }),
  });
}
