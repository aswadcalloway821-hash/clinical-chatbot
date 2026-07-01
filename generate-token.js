const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly'
];
const CREDENTIALS_PATH = path.join(__dirname, 'google-creds.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

if (!fs.existsSync(CREDENTIALS_PATH)) {
  console.error(`❌ Error: google-creds.json not found at: ${CREDENTIALS_PATH}`);
  console.error('Please make sure you put the downloaded OAuth 2.0 Client credentials file in this folder and renamed it to: google-creds.json');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const clientSecret = creds.installed || creds.web;
if (!clientSecret) {
  console.error('❌ Error: Invalid google-creds.json format. Make sure it is an OAuth 2.0 Client ID credentials file.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientSecret.client_id,
  clientSecret.client_secret,
  clientSecret.redirect_uris ? clientSecret.redirect_uris[0] : 'http://localhost'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Forces consent screen to get refresh token!
});

console.log('\n🚀 Open this URL in your browser to authorize the application:\n');
console.log(authUrl);
console.log('\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('🔑 Enter the authorization code from the page here: ', (code) => {
  rl.close();
  oauth2Client.getToken(code, (err, token) => {
    if (err) {
      console.error('❌ Error retrieving access token:', err.message);
      return;
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
    console.log(`\n✅ Success! token.json saved to: ${TOKEN_PATH}`);
    console.log('You can now see the server reload and connect live!');
  });
});
