import dotenv from 'dotenv';
dotenv.config();
const sheetId = process.env.GOOGLE_SHEET_ID || '1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo';
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
console.log('Testing Google Sheets Fetching...');
console.log('Sheet ID:', sheetId);
console.log('Client ID Present:', !!clientId);
console.log('Client Secret Present:', !!clientSecret);
console.log('Refresh Token Present:', !!refreshToken);
console.log('API Key Present:', !!apiKey);
async function testFetch() {
    let token = null;
    if (clientId && clientSecret && refreshToken) {
        console.log('\n1. Requesting OAuth Access Token...');
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            })
        });
        const tokenData = await tokenRes.json();
        console.log('OAuth Token Status:', tokenRes.status, tokenData.access_token ? 'Access Token Obtained!' : tokenData);
        token = tokenData.access_token;
    }
    const range = 'Clinic_Metadata!A1:Z50';
    let url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
    const headers = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    else if (apiKey) {
        url += `?key=${apiKey}`;
    }
    console.log('\n2. Fetching Range:', range);
    console.log('URL:', url);
    const res = await fetch(url, { headers });
    console.log('Response Status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Response Body:', text.slice(0, 500));
}
testFetch().catch(console.error);
//# sourceMappingURL=test-sheet.js.map