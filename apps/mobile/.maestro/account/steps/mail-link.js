// The newest email to ${EMAIL} that carries a ${PAGE} link, from the local stack's Mailpit (its
// API on localhost:8025), as the app's own link: https://wayfare.app/<page>#token=… (K22).
// Locally the emails point at identity's WEB_URL, so the token is lifted and the link rebuilt.
const MAILPIT = 'http://localhost:8025/api/v1';
const search = json(
  http.get(MAILPIT + '/search?limit=20&query=' + encodeURIComponent('to:' + EMAIL)).body,
);
const pattern = new RegExp('/' + PAGE + '#token=([A-Za-z0-9_%.~-]+)');
let link = null;
for (const message of search.messages) {
  const text = json(http.get(MAILPIT + '/message/' + message.ID).body).Text;
  const match = pattern.exec(text);
  if (match !== null) {
    link = 'https://wayfare.app/' + PAGE + '#token=' + match[1];
    break;
  }
}
if (link === null) throw new Error('No ' + PAGE + ' link for ' + EMAIL + ' in Mailpit');
output.link = link;
