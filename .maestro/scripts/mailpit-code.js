// Reads the newest six-digit sign-in code sent to ${EMAIL} out of the local stack's Mailpit
// (every local auth mail lands there — ai/kb/entries/supabase-local-stack.md). Sets output.code.
const search = http.get(
  'http://127.0.0.1:54324/api/v1/search?query=' + encodeURIComponent('to:' + EMAIL)
);
const latest = json(search.body).messages[0];
const message = json(http.get('http://127.0.0.1:54324/api/v1/message/' + latest.ID).body);
output.code = message.Text.match(/\b(\d{6})\b/)[1];
