import { GoogleGenAI } from '@google/genai';
import { config } from './config';

async function listModels() {
  if (!config.gemini.apiKey) {
    console.error('❌ API Key is missing.');
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    console.log('🔍 Listing available models from Gemini API...');
    const response = await ai.models.list() as any;
    console.log('Raw response type:', typeof response);
    console.log('Keys of response:', Object.keys(response));
    if (typeof response[Symbol.iterator] === 'function' || typeof response[Symbol.asyncIterator] === 'function') {
      console.log('Response is iterable!');
      for await (const m of response) {
        console.log(`- ${m.name} (${m.displayName})`);
      }
    } else {
      console.log('Response string:', response.toString());
    }
  } catch (error: any) {
    console.error('❌ Error listing models:', error.message);
  }
}

listModels();
