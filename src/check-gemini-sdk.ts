import * as genai from '@google/genai';
// Get GenerateContentResponse prototype methods
const proto = (genai as any).GenerateContentResponse ? Object.getOwnPropertyNames((genai as any).GenerateContentResponse.prototype) : [];
console.log('GenerateContentResponse prototype methods:', proto);
