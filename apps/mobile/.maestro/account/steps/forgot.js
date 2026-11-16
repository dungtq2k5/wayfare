// Asks a reset link for EMAIL, as *Forgot password?* would, so a reset link is in Mailpit.
http.post('http://localhost:13000/api/v1/auth/password/forgot', {
  headers: { 'content-type': 'application/json', 'x-wayfare-client': 'mobile' },
  body: JSON.stringify({ email: EMAIL }),
});
