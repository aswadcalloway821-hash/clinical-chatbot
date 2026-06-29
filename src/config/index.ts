import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },
  google: {
    // Can be a path to JSON file or the JSON string itself
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), 'google-creds.json'),
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  },
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    apiToken: process.env.WHATSAPP_API_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  }
};

// Validate that required keys are present (warn if missing)
if (!config.gemini.apiKey) {
  console.warn('⚠️ WARNING: GEMINI_API_KEY is not defined in environment variables.');
}
if (!config.whatsapp.verifyToken) {
  console.warn('⚠️ WARNING: WHATSAPP_VERIFY_TOKEN is not defined in environment variables.');
}
