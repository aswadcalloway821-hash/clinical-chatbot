import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

// Synchronous file logger for Windows block-buffered stdout workaround
const logFile = path.join(process.cwd(), 'server.log');
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const writeToFile = (prefix: string, args: any[]) => {
  try {
    const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ') + '\n';
    fs.appendFileSync(logFile, `[${prefix}] [${new Date().toISOString()}] ${msg}`);
  } catch (err: any) {
    originalError('❌ server.log write error:', err.message);
  }
};

console.log = (...args) => {
  originalLog(...args);
  writeToFile('LOG', args);
};

console.error = (...args) => {
  originalError(...args);
  writeToFile('ERR', args);
};

console.warn = (...args) => {
  originalWarn(...args);
  writeToFile('WRN', args);
};

import { config } from './config';
import webhookRouter from './routes/webhook';
import playgroundRouter from './routes/playground';
import { ReminderJob } from './services/reminder-job';

const app = express();

app.use(cors());
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`🔍 [Request] ${req.method} ${req.path} | Query:`, req.query, `| Body Keys:`, Object.keys(req.body || {}));
  next();
});

// Trigger restart for gemini.service compile check
// Mount the webhook router
app.use('/webhook', webhookRouter);
app.use('/', playgroundRouter);

// Basic health check endpoint
app.get('/health', (req, res) => {
  console.log('--- Health Check Called ---');
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(config.port, () => {
  console.log(`🚀 Server is running on port ${config.port}`);
  
  // Start the background reminder scheduler
  ReminderJob.start();
});
