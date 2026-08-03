// src/app.ts
import express from "express";
import cors from "cors";
import dotenv3 from "dotenv";

// src/routes/whatsapp.ts
import { Router } from "express";

// src/services/gemini.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();
var apiKey = process.env.GEMINI_API_KEY || "";
var genAI = new GoogleGenerativeAI(apiKey);
var GeminiService = class {
  /**
   * Helper to clean any accidental markdown from text
   */
  static cleanMarkdown(text) {
    return text.replace(/\*/g, "").replace(/#/g, "").replace(/`/g, "").replace(/_/g, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  /**
   * Build Dynamic System Instruction for Gemini based strictly on current Google Sheets Tenant Config
   */
  static getSystemInstruction(tenant) {
    const branchNames = tenant.branches.map((b) => b.name).join(" \u060C ");
    const doctorNames = tenant.doctors.map((d) => d.name).join(" \u060C ");
    const deptNames = tenant.departments ? tenant.departments.join(" \u060C ") : "";
    return `
\u0623\u0646\u062A\u0650 "\u0633\u0627\u0631\u0629 \u0627\u0644\u0631\u0642\u0645\u064A\u0629"\u060C \u0645\u0648\u0638\u0641\u0629 \u0627\u0633\u062A\u0642\u0628\u0627\u0644 \u0628\u0634\u0631\u064A\u0629 \u0641\u064A "${tenant.clinicName}".

\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0639\u0645\u0644 \u0648\u0627\u0644\u062A\u062C\u0627\u0648\u0628 \u0627\u0644\u0645\u0628\u0627\u0634\u0631:
1. \u0627\u0633\u0645 \u0627\u0644\u0639\u064A\u0627\u062F\u0629 \u0648\u0627\u0644\u0645\u0631\u0643\u0632 \u0647\u0648 \u062D\u0635\u0631\u0627\u064B "${tenant.clinicName}".
2. \u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0647\u064A \u062D\u0635\u0631\u0627\u064B: ${branchNames}.
3. \u0627\u0644\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0647\u064A: ${deptNames}.
4. \u0627\u0644\u0623\u0637\u0628\u0627\u0621 \u0627\u0644\u0645\u062A\u0627\u062D\u0648\u0646 \u0647\u0645 \u062D\u0635\u0631\u0627\u064B: ${doctorNames}.
5. \u0627\u0644\u062A\u062D\u062F\u062B \u0628\u0644\u063A\u0629 \u0639\u0631\u0627\u0642\u064A\u0629 \u0639\u0641\u0648\u064A\u0629 \u0648\u0645\u0628\u0627\u0634\u0631\u0629 \u0628\u062F\u0648\u0646 \u0631\u0645\u0648\u0632 \u0623\u0648 \u0646\u062C\u0648\u0645 \u0623\u0648 \u062A\u0646\u0633\u064A\u0642\u0627\u062A Markdown (*, **, #).
6. \u0639\u062F\u0645 \u0625\u0636\u0627\u0641\u0629 \u0623\u064A \u0639\u0628\u0627\u0631\u0629 \u062A\u0631\u062D\u064A\u0628 \u062E\u062A\u0627\u0645\u064A\u0629 \u0645\u0643\u0631\u0631\u0629 \u0641\u064A \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0631\u062F \u0625\u0637\u0644\u0627\u0642\u0627\u064B.
`;
  }
  /**
   * Parse user intent and extract entities structured via JSON
   */
  static async parseNluIntent(userMessage, currentState, tenant) {
    const prompt = `
\u0623\u0646\u062A \u0646\u0638\u0627\u0645 \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0627\u0644\u0646\u0648\u0627\u064A\u0627 \u0648\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0644\u062F\u0639\u0645 \u0646\u0638\u0627\u0645 \u062D\u062C\u0632 \u0637\u0628\u064A \u0644\u0640 "${tenant.clinicName}".
\u062A\u062D\u0644\u064A\u0644 \u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u064A\u0636 \u0627\u0644\u062A\u0627\u0644\u064A\u0629 \u0648\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0627\u0644\u0646\u064A\u0629 (intent) \u0648\u0627\u0644\u0643\u064A\u0627\u0646\u0627\u062A (entities).

\u062D\u0627\u0644\u0629 \u0627\u0644\u062D\u0648\u0627\u0631 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: ${currentState}

\u0627\u0644\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0629: ${JSON.stringify(tenant.departments || [])}
\u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u062A\u0627\u062D\u0629: ${JSON.stringify(tenant.branches.map((b) => b.name))}
\u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0629: ${JSON.stringify(tenant.services.map((s) => s.name))}
\u0627\u0644\u0623\u0637\u0628\u0627\u0621 \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0648\u0646: ${JSON.stringify(tenant.doctors.map((d) => d.name))}

\u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u064A\u0636: "${userMessage}"

\u0642\u0648\u0627\u0639\u062F \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0646\u064A\u0629 (intent):
- \u0625\u0630\u0627 \u0627\u062E\u062A\u0627\u0631 \u0642\u0633\u0645\u0627\u064B \u0637\u0644\u064A\u0627\u064B -> intent: "SELECT_DEPARTMENT" \u0648\u0627\u0644\u0643\u064A\u0627\u0646 departmentName
- \u0625\u0630\u0627 \u0637\u0644\u0628 \u0645\u0648\u0638\u0641 \u0628\u0634\u0631\u064A \u0623\u0648 \u0634\u0643\u0648\u0649 \u0623\u0648 \u062A\u0639\u0628\u064A\u0631 \u0639\u0646 \u0627\u0644\u063A\u0636\u0628 \u0634\u062F\u064A\u062F -> intent: "REQUEST_HUMAN" \u0623\u0648 "ANGRY_EXPRESSION"
- \u0625\u0630\u0627 \u064A\u0633\u0623\u0644 \u0639\u0646 \u0633\u0639\u0631 \u0623\u0648 \u0645\u0648\u0642\u0639 \u0623\u0648 \u0645\u0639\u0644\u0648\u0645\u0629 -> intent: "ASK_FAQ"
- \u0625\u0630\u0627 \u0627\u062E\u062A\u0627\u0631 \u0641\u0631\u0639\u0627\u064B \u0623\u0648 \u0637\u0628\u064A\u0628\u0627\u064B \u0623\u0648 \u062E\u062F\u0645\u0629 -> \u0627\u062E\u062A\u0631 \u0627\u0644\u0646\u064A\u0629 \u0648\u0627\u0644\u0643\u064A\u0627\u0646 \u0627\u0644\u0645\u0646\u0627\u0633\u0628.
- \u0625\u0630\u0627 \u0623\u0639\u0637\u0649 \u0627\u0633\u0645\u0647 \u062B\u0644\u0627\u062B\u064A\u0627\u064B -> intent: "PROVIDE_NAME" \u0648\u0627\u0644\u0643\u064A\u0627\u0646 patientName
- \u0625\u0630\u0627 \u0648\u0627\u0641\u0642 \u0623\u0648 \u0623\u0643\u062F (\u0646\u0639\u0645\u060C \u0627\u0648\u0643\u064A\u060C \u062A\u0645\u060C \u0627\u0643\u064A\u062F\u060C \u062A\u0623\u0643\u064A\u062F) -> intent: "CONFIRM"
- \u0625\u0630\u0627 \u0631\u0641\u0636 \u0623\u0648 \u0627\u0644\u063A\u0649 (\u0644\u0627\u060C \u0627\u0644\u063A\u0627\u0621\u060C \u062A\u0631\u0627\u062C\u0639) -> intent: "CANCEL"

\u0623\u0631\u062C\u0639 \u0646\u062A\u064A\u062C\u0629 JSON \u0641\u0642\u0637 \u0628\u0627\u0644\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u062A\u0627\u0644\u064A \u0628\u062F\u0648\u0646 \u0623\u064A \u0646\u0635 \u0625\u0636\u0627\u0641\u064A:
{
  "intent": "GREETING | SELECT_DEPARTMENT | SELECT_BRANCH | SELECT_SERVICE | SELECT_DOCTOR | SELECT_SLOT | PROVIDE_NAME | CONFIRM | CANCEL | ASK_FAQ | REQUEST_HUMAN | ANGRY_EXPRESSION | UNKNOWN",
  "entities": {
    "departmentName": "\u0627\u0633\u0645 \u0627\u0644\u0642\u0633\u0645 \u0623\u0648 undefined",
    "branchName": "\u0627\u0633\u0645 \u0627\u0644\u0641\u0631\u0639 \u0623\u0648 undefined",
    "serviceName": "\u0627\u0633\u0645 \u0627\u0644\u062E\u062F\u0645\u0629 \u0623\u0648 undefined",
    "doctorName": "\u0627\u0633\u0645 \u0627\u0644\u0637\u0628\u064A\u0628 \u0623\u0648 undefined",
    "slotId": "\u0645\u0639\u0631\u0641 \u0627\u0644\u0645\u0648\u0639\u062F \u0623\u0648 undefined",
    "patientName": "\u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064A\u0636 \u0623\u0648 undefined",
    "faqQuestion": "\u0633\u0624\u0627\u0644 \u0627\u0644\u0645\u0631\u064A\u0636 \u0623\u0648 undefined"
  },
  "confidence": 0.95
}
`;
    const modelsToTry = [
      process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0],
      ...this.MODEL_FALLBACKS.filter((m) => m !== (process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0]))
    ];
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: this.getSystemInstruction(tenant),
          generationConfig: { responseMimeType: "application/json" }
        });
        const response = await this.retryWithBackoff(() => model.generateContent(prompt));
        const text = response.response.text()?.trim() || "{}";
        const parsed = JSON.parse(text);
        return {
          intent: parsed.intent || "UNKNOWN",
          entities: parsed.entities || {},
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8
        };
      } catch (error) {
        console.error(`[Gemini NLU] Model ${modelName} failed:`, error);
        continue;
      }
    }
    return { intent: "UNKNOWN", entities: {}, confidence: 0 };
  }
  /**
   * Helper to get Current Baghdad Date String
   */
  static getBaghdadDateString() {
    return (/* @__PURE__ */ new Date()).toLocaleDateString("ar-IQ", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Baghdad"
    });
  }
  /**
   * Analyze and extract booking slots in one shot via Gemini NLU
   */
  static async analyzeAndExtractSlots(userMessage, currentSlots, tenant) {
    const prompt = `
\u0623\u0646\u062A\u0650 \u0646\u0638\u0627\u0645 \u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0646\u0648\u0627\u064A\u0627 \u0648\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u062E\u0627\u0646\u0627\u062A \u0627\u0644\u062D\u062C\u0632 \u0627\u0644\u0637\u0628\u064A \u0644\u0640 "${tenant.clinicName}".
\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u064A\u0648\u0645 \u0628\u062A\u0648\u0642\u064A\u062A \u0628\u063A\u062F\u0627\u062F: ${this.getBaghdadDateString()}

\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u064A\u0627\u062F\u0629 \u0627\u0644\u0645\u062A\u0627\u062D\u0629:
- \u0627\u0644\u0641\u0631\u0648\u0639: ${JSON.stringify(tenant.branches.map((b) => ({ id: b.id, name: b.name })))}
- \u0627\u0644\u0623\u0642\u0633\u0627\u0645: ${JSON.stringify(tenant.departments || [])}
- \u0627\u0644\u062E\u062F\u0645\u0627\u062A: ${JSON.stringify(tenant.services.map((s) => ({ id: s.id, name: s.name, department: s.department })))}
- \u0627\u0644\u0623\u0637\u0628\u0627\u0621: ${JSON.stringify(tenant.doctors.map((d) => ({ id: d.id, name: d.name, branch: d.branchName, specialty: d.specialty })))}

\u0627\u0644\u062E\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0633\u062C\u0644\u0629 \u062D\u0627\u0644\u064A\u0627\u064B: ${JSON.stringify(currentSlots || {})}
\u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u064A\u0636 \u0627\u0644\u0623\u062E\u064A\u0631\u0629: "${userMessage}"

\u0627\u0644\u0645\u0637\u0644\u0648\u0628: \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0623\u064A \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u062D\u062C\u0632 \u0645\u062A\u0648\u0641\u0631\u0629 \u0641\u064A \u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u064A\u0636 (\u0641\u0631\u0639\u060C \u0642\u0633\u0645\u060C \u062E\u062F\u0645\u0629\u060C \u0637\u0628\u064A\u0628\u060C \u062A\u0627\u0631\u064A\u062E\u060C \u0648\u0642\u062A\u060C \u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064A\u0636) \u0648\u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0646\u064A\u0629.
\u0625\u0630\u0627 \u0643\u0627\u0646 \u0627\u0644\u0633\u0624\u0627\u0644 \u0627\u0633\u062A\u0641\u0633\u0627\u0631\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0639\u0646 \u0633\u0639\u0631 \u0623\u0648 \u0645\u0648\u0642\u0639 -> intent: "ASK_FAQ".
\u0625\u0630\u0627 \u0643\u0627\u0646 \u0637\u0644\u0628 \u062A\u062D\u0648\u064A\u0644 \u0644\u0644\u0633\u0643\u0631\u062A\u064A\u0631 -> intent: "REQUEST_HUMAN".

\u0623\u0631\u062C\u0639\u064A \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0628\u0635\u064A\u063A\u0629 JSON \u0641\u0642\u0637:
{
  "intent": "BOOKING_FLOW | ASK_FAQ | REQUEST_HUMAN | CANCEL_BOOKING | MODIFY_BOOKING",
  "extractedSlots": {
    "branchName": "\u0627\u0633\u0645 \u0627\u0644\u0641\u0631\u0639 \u0623\u0648 undefined",
    "branchId": "\u0645\u0639\u0631\u0641 \u0627\u0644\u0641\u0631\u0639 \u0623\u0648 undefined",
    "department": "\u0627\u0633\u0645 \u0627\u0644\u0642\u0633\u0645 \u0623\u0648 undefined",
    "serviceName": "\u0627\u0633\u0645 \u0627\u0644\u062E\u062F\u0645\u0629 \u0623\u0648 undefined",
    "serviceId": "\u0645\u0639\u0631\u0641 \u0627\u0644\u062E\u062F\u0645\u0629 \u0623\u0648 undefined",
    "doctorName": "\u0627\u0633\u0645 \u0627\u0644\u0637\u0628\u064A\u0628 \u0623\u0648 undefined",
    "doctorId": "\u0645\u0639\u0631\u0641 \u0627\u0644\u0637\u0628\u064A\u0628 \u0623\u0648 undefined",
    "date": "\u0627\u0644\u062A\u0627\u0631\u064A\u062E \u0628\u0635\u064A\u063A\u0629 YYYY-MM-DD \u0623\u0648 undefined",
    "startTime": "\u0627\u0644\u0648\u0642\u062A \u0628\u0635\u064A\u063A\u0629 HH:mm \u0623\u0648 undefined",
    "patientName": "\u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064A\u0636 \u0627\u0644\u0635\u0631\u064A\u062D \u0627\u0644\u062B\u0644\u0627\u062B\u064A \u0623\u0648 \u0627\u0644\u062B\u0646\u0627\u0626\u064A \u0623\u0648 undefined"
  },
  "confidence": 0.95
}
`;
    try {
      const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant),
        generationConfig: { responseMimeType: "application/json" }
      });
      const response = await model.generateContent(prompt);
      const parsed = JSON.parse(response.response.text()?.trim() || "{}");
      return {
        intent: parsed.intent || "BOOKING_FLOW",
        extractedSlots: parsed.extractedSlots || {},
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9
      };
    } catch (err) {
      console.error("Gemini Slot Extraction Error:", err);
      return { intent: "BOOKING_FLOW", extractedSlots: {}, confidence: 0.5 };
    }
  }
  /**
   * Generate polite closing response for locked sessions (COMPLETED_LOCKED)
   */
  static async generatePoliteClosingResponse(userMessage, tenant) {
    return `\u0623\u0647\u0644\u0627\u064B \u0648\u0633\u0647\u0644\u0627\u064B \u0628\u064A\u0643 \u0639\u064A\u0646\u064A! \u062D\u062C\u0632\u0643 \u0627\u0644\u0633\u0627\u0628\u0642 \u0645\u0633\u062C\u0644 \u0648\u0645\u0624\u0643\u062F \u0639\u0646\u062F\u0646\u0627 \u0628\u0640 ${tenant.clinicName}. \u0625\u0630\u0627 \u062D\u0628\u064A\u062A \u062A\u0633\u0648\u064A \u062D\u062C\u0632 \u062C\u062F\u064A\u062F \u0623\u0648 \u0646\u0639\u062F\u0644 \u0627\u0644\u0645\u0648\u0639\u062F \u0643\u0644\u064A\u0644\u064A "\u062D\u062C\u0632 \u062C\u062F\u064A\u062F" \u0648\u062A\u062F\u0644\u0644! \u{1F338}`;
  }
  /**
   * Transcribe Audio Note (Voice Message) via Gemini Audio API
   */
  static async transcribeAudioNote(audioBase64, mimeType = "audio/ogg") {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: audioBase64
          }
        },
        { text: "\u0627\u0644\u0645\u0637\u0644\u0648\u0628: \u062A\u062D\u0648\u064A\u0644 \u0647\u0630\u0647 \u0627\u0644\u0628\u0635\u0645\u0629 \u0627\u0644\u0635\u0648\u062A\u064A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0639\u0631\u0627\u0642\u064A\u0629 \u0625\u0644\u0649 \u0646\u0635 \u0645\u0643\u062A\u0648\u0628 \u0628\u062F\u0642\u0629\u060C \u0628\u062F\u0648\u0646 \u0623\u064A \u0625\u0636\u0627\u0641\u0627\u062A." }
      ]);
      return result.response.text()?.trim() || "";
    } catch (err) {
      console.error("Audio Transcription Error:", err);
      return "";
    }
  }
  /**
   * Answer FAQ dynamically based on Google Sheets TenantConfig
   */
  static async answerFaq(userMessage, tenant) {
    const prompt = `
\u0633\u0623\u0644 \u0627\u0644\u0645\u0631\u064A\u0636 \u0627\u0644\u0633\u0624\u0627\u0644 \u0627\u0644\u062A\u0627\u0644\u064A: "${userMessage}"

\u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0644\u0640 "${tenant.clinicName}":
\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0634\u0627\u0626\u0639\u0629: ${JSON.stringify(tenant.faqs)}
\u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0648\u0627\u0644\u0623\u0633\u0639\u0627\u0631: ${JSON.stringify(tenant.services)}
\u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u062A\u0627\u062D\u0629: ${JSON.stringify(tenant.branches)}

\u0623\u062C\u064A\u0628\u064A \u0639\u0646 \u0633\u0624\u0627\u0644 \u0627\u0644\u0645\u0631\u064A\u0636 \u0628\u0644\u0647\u062C\u0629 \u0639\u0631\u0627\u0642\u064A\u0629 \u0639\u0641\u0648\u064A\u0629 \u062C\u062F\u0627\u064B \u0648\u0628\u062F\u0648\u0646 \u0623\u064A \u062A\u0646\u0645\u064A\u0642 \u0623\u0648 \u062A\u0646\u0633\u064A\u0642 Markdown\u060C \u0648\u0628\u062F\u0648\u0646 \u0625\u0636\u0627\u0641\u0629 \u0623\u064A \u062C\u0645\u0644\u0629 \u062A\u0631\u062D\u064A\u0628 \u062E\u062A\u0627\u0645\u064A\u0629 \u0645\u0643\u0631\u0631\u0629!
`;
    try {
      const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant)
      });
      const response = await model.generateContent(prompt);
      const reply = response.response.text() || "";
      return this.cleanMarkdown(reply);
    } catch (error) {
      return `\u062A\u0641\u0636\u0644 \u0639\u064A\u0646\u064A\u060C \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0644\u0645\u0639\u0631\u0641\u0629 \u0643\u0627\u0641\u0629 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644: ${tenant.secretaryPhone}.`;
    }
  }
  // ------------------------------------------------------------------
  // Conversation Conductor: Gemini controls the dialogue via prompt.
  // No fixed ladder, no hardcoded entity names — everything is injected
  // dynamically from the tenant data every turn.
  // ------------------------------------------------------------------
  static INTENTS = ["answer", "side_question", "confirm_slot", "decline_slot", "confirm_booking", "decline_booking", "cancel", "modify", "human", "greeting", "other"];
  static ACTIONS = ["NONE", "GET_SLOTS", "LIST_SERVICES", "COMMIT_BOOKING", "RESET"];
  /** Model fallback list: try primary, then fallbacks if overloaded (503) */
  static MODEL_FALLBACKS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
  ];
  /** Retry with exponential backoff for transient errors (503, 429, 500) */
  static async retryWithBackoff(fn, maxRetries = 2, baseDelayMs = 1e3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isTransient = err?.status === 503 || err?.status === 429 || err?.status === 500;
        if (!isTransient || attempt === maxRetries) throw err;
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[Gemini Retry] Attempt ${attempt + 1} failed (${err?.status}), retrying in ${Math.round(delay)}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("Unreachable");
  }
  /** Validate reply is not garbled — must contain real Arabic words, not random numbers */
  static isValidReply(reply) {
    if (!reply || reply.length < 5) return false;
    if (/^\d{10,}/.test(reply)) return false;
    if (/^[0-9\s:،,.-]+$/.test(reply)) return false;
    const arabicChars = (reply.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicChars < 3) return false;
    return true;
  }
  static async conductTurn(ctx) {
    const prompt = this.buildConductorPrompt(ctx);
    const fallback = {
      reply: "\u0639\u064A\u0646\u064A \u0639\u0630\u0631\u0627\u064B\u060C \u0635\u0627\u0631 \u0627\u0646\u0642\u0637\u0627\u0639 \u0644\u062D\u0638\u064A \u0628\u0627\u0644\u0627\u062A\u0635\u0627\u0644. \u062A\u0641\u0636\u0644 \u0623\u0639\u064A\u062F \u0643\u0644\u0627\u0645\u0643 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629 \u0648\u062A\u062F\u0644\u0644 \u{1F338}",
      intent: "other",
      action: "NONE",
      proposed: {}
    };
    const modelsToTry = [
      process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0],
      ...this.MODEL_FALLBACKS.filter((m) => m !== (process.env.GEMINI_MODEL || this.MODEL_FALLBACKS[0]))
    ];
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: this.getSystemInstruction(ctx.tenant),
          generationConfig: { responseMimeType: "application/json" }
        });
        const response = await this.retryWithBackoff(() => model.generateContent(prompt));
        const text = response.response.text()?.trim() || "";
        const parsed = this.extractJson(text);
        if (!parsed) {
          console.warn(`[Gemini] Empty/invalid JSON from ${modelName}, trying next...`);
          continue;
        }
        const intent = this.INTENTS.includes(parsed.intent) ? parsed.intent : "other";
        const action = this.ACTIONS.includes(parsed.action) ? parsed.action : "NONE";
        const reply = this.cleanMarkdown(String(parsed.reply || ""));
        if (!this.isValidReply(reply)) {
          console.warn(`[Gemini] Garbled reply from ${modelName}: "${reply.substring(0, 50)}...", trying next...`);
          continue;
        }
        return {
          reply: reply || fallback.reply,
          intent,
          action,
          proposed: parsed.proposed && typeof parsed.proposed === "object" ? parsed.proposed : {}
        };
      } catch (err) {
        console.error(`[Gemini] Model ${modelName} failed:`, err?.status || err?.message || err);
        continue;
      }
    }
    console.error("[Gemini] All models exhausted, returning fallback");
    return fallback;
  }
  /** Robust JSON extraction: strips fences and grabs the outermost {...} */
  static extractJson(text) {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  /**
   * Build the conductor prompt dynamically from the CURRENT tenant data.
   * Contains ZERO hardcoded clinic entity names — every name, price, hour
   * comes from the live Google Sheets data at call time.
   */
  static buildConductorPrompt(ctx) {
    const t = ctx.tenant;
    const branchList = t.branches.map((b) => `- ${b.name}${b.address ? " (" + b.address + ")" : ""}`).join("\n");
    const servicesList = t.services.map((s2) => `- ${s2.name} | ${s2.price > 0 ? s2.price + " \u062F\u064A\u0646\u0627\u0631" : "\u062D\u0633\u0628 \u0627\u0644\u0641\u062D\u0635"} | ${s2.durationMinutes || 30} \u062F\u0642\u064A\u0642\u0629 | ${s2.department || "\u0639\u0627\u0645"}`).join("\n");
    const doctorsList = t.doctors.map((d) => `- ${d.name} | ${d.branchName || d.branchId} | ${d.specialty || "\u0639\u0627\u0645"}`).join("\n");
    const faqsText = (t.faqs || []).slice(0, 8).map((f) => `\u0633: ${f.question} | \u062C: ${f.answer}`).join("\n");
    const s = ctx.slots || {};
    const filled = [];
    if (s.branchName) filled.push(`\u0627\u0644\u0641\u0631\u0639: ${s.branchName}`);
    if (s.department) filled.push(`\u0627\u0644\u0642\u0633\u0645: ${s.department}`);
    if (s.serviceName) filled.push(`\u0627\u0644\u062E\u062F\u0645\u0629: ${s.serviceName}`);
    if (s.doctorName) filled.push(`\u0627\u0644\u0637\u0628\u064A\u0628: ${s.doctorName}`);
    if (s.date) filled.push(`\u0627\u0644\u062A\u0627\u0631\u064A\u062E: ${s.date}`);
    if (s.startTime) filled.push(`\u0627\u0644\u0648\u0642\u062A: ${s.startTime}`);
    const stateLine = filled.length ? filled.join(" | ") : "\u0644\u0645 \u064A\u064F\u062D\u062F\u062F \u0634\u064A\u0621 \u0628\u0639\u062F";
    let proposalLine = "";
    if (ctx.pendingProposal && ctx.proposedSlot) {
      proposalLine = `\u0627\u0642\u062A\u0631\u0627\u062D \u0645\u0648\u0639\u062F: ${ctx.proposedSlot.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${ctx.proposedSlot.startTime} \u0645\u0639 ${ctx.proposedSlot.doctorName || s.doctorName || ""}`;
    }
    const recentTurns = (ctx.recentMessages || []).slice(-4).map((turn) => `${turn.role === "user" ? "\u0627\u0644\u0645\u0631\u064A\u0636" : "\u0633\u0627\u0631\u0629"}: ${turn.text}`).join("\n");
    const toolNote = ctx.toolResult ? `
\u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0646\u0638\u0627\u0645: ${ctx.toolResult}` : "";
    const optionsNote = ctx.optionsOffered?.length ? `
\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A: ${ctx.optionsOffered.map((o, i) => `${i + 1}. ${o}`).join(" | ")}` : "";
    const committedNote = ctx.bookingCommitted ? "\n\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062D\u062C\u0632 \u2014 \u0627\u0643\u062A\u0641\u064A \u0631\u0633\u0627\u0644\u0629 \u062A\u0623\u0643\u064A\u062F \u0646\u0647\u0627\u0626\u064A\u0629 \u0628\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644." : "";
    return `
\u0623\u0646\u062A\u0650 "\u0633\u0627\u0631\u0629"\u060C \u0645\u0648\u0638\u0641\u0629 \u0627\u0633\u062A\u0642\u0628\u0627\u0644 \u0641\u064A "${t.clinicName}". \u0627\u0644\u0648\u0642\u062A: ${this.getBaghdadDateString()} \u0628\u062A\u0648\u0642\u064A\u062A \u0628\u063A\u062F\u0627\u062F.

=== \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u064A\u0627\u062F\u0629 ===
\u0627\u0644\u0641\u0631\u0631\u0648\u0639:
${branchList}

\u0627\u0644\u062E\u062F\u0645\u0627\u062A:
${servicesList}

\u0627\u0644\u0623\u0637\u0628\u0627\u0621:
${doctorsList}

${faqsText ? `\u0623\u0633\u0626\u0644\u0629 \u0634\u0627\u0626\u0639\u0629:
${faqsText}` : ""}

=== \u062D\u0627\u0644\u0629 \u0627\u0644\u062D\u062C\u0632 ===
${stateLine}
${proposalLine}
\u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064A\u0636: ${ctx.patientName || "\u0644\u0645 \u064A\u064F\u0633\u062C\u0644 \u0628\u0639\u062F"}
${optionsNote}
${toolNote}
${committedNote}

=== \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 ===
${recentTurns || "\u0628\u062F\u0627\u064A\u0629 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"}
\u0627\u0644\u0645\u0631\u064A\u0636: "${ctx.userMessage}"

=== \u0627\u0644\u0642\u0648\u0627\u0639\u062F ===
- \u062A\u062D\u062F\u062B\u064A \u0628\u0627\u0644\u0639\u0631\u0627\u0642\u064A \u0627\u0644\u0639\u0641\u0648\u064A\u060C \u0628\u062F\u0648\u0646 Markdown \u0623\u0648 \u0646\u062C\u0648\u0645 \u0623\u0648 \u0631\u0645\u0648\u0632.
- \u0644\u0627 \u062A\u062E\u062A\u0644\u0642\u064A \u0641\u0631\u0639 \u0623\u0648 \u062E\u062F\u0645\u0629 \u0623\u0648 \u0637\u0628\u064A\u0628\u0627\u064B \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0623\u0639\u0644\u0627\u0647.
- \u0623\u064A \u0633\u0624\u0627\u0644 \u062C\u0627\u0646\u0628\u064A (\u0633\u0639\u0631\u060C \u0645\u0648\u0642\u0639\u060C \u062F\u0648\u0627\u0645): \u0623\u062C\u064A\u0628\u064A \u0628\u0627\u062E\u062A\u0635\u0627\u0631 \u062B\u0645 \u0627\u0631\u062C\u0639\u064A \u0644\u0644\u062D\u062C\u0632.
- \u0639\u0646\u062F \u0627\u0644\u063A\u0636\u0628: \u0627\u0639\u062A\u0630\u0627\u0631 \u0642\u0635\u064A\u0631 \u062B\u0645 \u0623\u0639\u064A\u062F\u064A \u0627\u0644\u0633\u0624\u0627\u0644 \u0628\u0647\u062F\u0648\u0621.
- \u0644\u0627 \u062A\u0643\u0631\u0631\u064A \u0646\u0641\u0633 \u0627\u0644\u0635\u064A\u063A\u0629 \u0641\u064A \u0643\u0644 \u0631\u062F.

=== \u0627\u0644\u0631\u0648\u062A\u064A\u0646 ===
1. \u0627\u0644\u0641\u0631\u0639 \u2192 \u0627\u0644\u0642\u0633\u0645 \u2192 \u0627\u0644\u062E\u062F\u0645\u0629 \u2192 \u0627\u0644\u0645\u0648\u0627\u0639\u064A\u062F \u2192 \u0627\u0644\u0627\u0633\u0645 \u2192 \u0645\u0644\u062E\u0635 \u2192 \u062A\u0623\u0643\u064A\u062F \u2192 \u062A\u062B\u0628\u064A\u062A

=== \u0627\u0644\u0631\u062F JSON \u0641\u0642\u0637 ===
{
  "reply": "\u0631\u062F\u0643 \u0628\u0627\u0644\u0639\u0631\u0627\u0642\u064A",
  "intent": "answer | side_question | confirm_slot | decline_slot | confirm_booking | decline_booking | cancel | modify | human | greeting | other",
  "action": "NONE | GET_SLOTS | LIST_SERVICES | COMMIT_BOOKING | RESET",
  "proposed": {
    "branchName": null,
    "department": null,
    "serviceName": null,
    "doctorName": null,
    "date": null,
    "time": null,
    "patientName": null
  }
}

\u26A0\uFE0F COMMIT_BOOKING \u0641\u0642\u0637 \u0628\u0639\u062F: \u0627\u0644\u062E\u062F\u0645\u0629 + \u0627\u0644\u0637\u0628\u064A\u0628 + \u0627\u0644\u0648\u0642\u062A + \u0627\u0644\u0627\u0633\u0645 + \u0645\u0644\u062E\u0635 + \u062A\u0623\u0643\u064A\u062F \u0635\u0631\u064A\u062D \u0645\u0646 \u0627\u0644\u0645\u0631\u064A\u0636.
`;
  }
};

// src/services/handoff-manager.ts
var HandoffManager = class {
  /**
   * Check if session should trigger Human Handoff
   */
  static shouldTriggerHandoff(session, intent, confidence) {
    if (intent === "REQUEST_HUMAN" || intent === "ANGRY_EXPRESSION") {
      return true;
    }
    if (session.failedNluAttempts >= 3 || confidence < 0.3) {
      return true;
    }
    return false;
  }
  /**
   * Execute Handoff Protocol
   */
  static executeHandoff(session, tenant) {
    session.currentState = "HUMAN_HANDOFF";
    return `\u062A\u0645\u0627\u0645 \u0639\u064A\u0646\u064A\u060C \u0631\u0627\u062D \u0623\u062D\u0648\u0644 \u0645\u062D\u0627\u062F\u062B\u062A\u0643 \u0641\u0648\u0631\u0627\u064B \u0644\u0644\u0633\u0643\u0631\u062A\u064A\u0631 \u0644\u0645\u0633\u0627\u0639\u062F\u062A\u0643 \u0628\u0627\u0644\u0634\u0643\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628.
\u062A\u0641\u0636\u0644 \u0631\u0642\u0645 \u0627\u0644\u062A\u0648\u0627\u0635\u0644 \u0627\u0644\u0645\u0628\u0627\u0634\u0631: ${tenant.secretaryPhone}`;
  }
};

// src/services/atomic-lock.ts
var AtomicLockManager = class {
  static locks = /* @__PURE__ */ new Map();
  /**
   * Attempt to acquire an atomic lock for a resource (e.g., doctorId + slotDate + slotTime)
   * @param resourceKey Unique string representing the slot
   * @param ttlMs Time-to-live for the lock in milliseconds (default 10 minutes)
   * @param owner Session/patient identifier that requested the lock
   */
  static acquireLock(resourceKey, ttlMs = 6e5, owner) {
    const now = Date.now();
    const existingLock = this.locks.get(resourceKey);
    if (existingLock && existingLock.expiresAt > now) {
      if (owner && existingLock.owner === owner) {
        existingLock.expiresAt = now + ttlMs;
        return true;
      }
      return false;
    }
    this.locks.set(resourceKey, { expiresAt: now + ttlMs, owner });
    return true;
  }
  /**
   * Release an acquired atomic lock
   */
  static releaseLock(resourceKey) {
    this.locks.delete(resourceKey);
  }
  /**
   * Renew/extend the TTL of an existing lock (used by the session that originally proposed the slot
   * right before the final booking write to keep the reservation fresh).
   * Never steals a lock held by a different owner.
   */
  static renewLock(resourceKey, ttlMs = 6e5, owner) {
    const now = Date.now();
    const existingLock = this.locks.get(resourceKey);
    if (existingLock && existingLock.expiresAt > now && owner && existingLock.owner && existingLock.owner !== owner) {
      return false;
    }
    this.locks.set(resourceKey, { expiresAt: now + ttlMs, owner: owner || existingLock?.owner });
    return true;
  }
  /**
   * Check if resource is currently locked
   */
  static isLocked(resourceKey) {
    const lock = this.locks.get(resourceKey);
    if (!lock) return false;
    if (lock.expiresAt <= Date.now()) {
      this.locks.delete(resourceKey);
      return false;
    }
    return true;
  }
  /**
   * Clean expired locks periodically
   */
  static cleanExpiredLocks() {
    const now = Date.now();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
};

// src/utils/baghdad-time.ts
function getBaghdadNow() {
  return new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: "Asia/Baghdad" }));
}
function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function getBaghdadToday() {
  return formatDate(getBaghdadNow());
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function getBaghdadTomorrow() {
  return formatDate(addDays(getBaghdadNow(), 1));
}

// src/services/slot-generator.ts
var SlotGenerator = class {
  /**
   * Helper to get Tomorrow's Date (YYYY-MM-DD) for Tomorrow-First slot generation
   */
  static getTomorrowDate() {
    return formatDate(addDays(getBaghdadNow(), 1));
  }
  /**
   * Parse break times text (e.g. "13:00-14:00" or "13:00 - 14:00, 17:00 - 18:00")
   */
  static parseBreakTimes(breakTimesStr) {
    if (!breakTimesStr || !breakTimesStr.trim()) return [];
    const intervals = [];
    const parts = breakTimesStr.split(/[,،;]/);
    for (const part of parts) {
      const m = part.match(/(\d{1,2}):?(\d{2})?\s*[-–—]\s*(\d{1,2}):?(\d{2})?/);
      if (m) {
        const startMinute = parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0);
        const endMinute = parseInt(m[3]) * 60 + (m[4] ? parseInt(m[4]) : 0);
        if (endMinute > startMinute) intervals.push({ startMinute, endMinute });
      }
    }
    return intervals;
  }
  /**
   * OffDays entries may be specific dates ("2026-08-15") or Arabic weekday names ("الجمعة").
   * Returns true if the given date/weekday is off.
   */
  static isOffDay(doctor, date, dayOfWeek) {
    if (!doctor.offDays || doctor.offDays.length === 0) return false;
    const dayMap = {
      "\u0623\u062D\u062F": 0,
      "\u0627\u0644\u0627\u062D\u062F": 0,
      "\u0627\u0644\u0623\u062D\u062F": 0,
      "sun": 0,
      "\u0625\u062B\u0646\u064A\u0646": 1,
      "\u0627\u062B\u0646\u064A\u0646": 1,
      "\u0627\u0644\u0625\u062B\u0646\u064A\u0646": 1,
      "mon": 1,
      "\u062B\u0644\u0627\u062B\u0627\u0621": 2,
      "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621": 2,
      "tue": 2,
      "\u0623\u0631\u0628\u0639\u0627\u0621": 3,
      "\u0627\u0631\u0628\u0639\u0627\u0621": 3,
      "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621": 3,
      "wed": 3,
      "\u062E\u0645\u064A\u0633": 4,
      "\u0627\u0644\u062E\u0645\u064A\u0633": 4,
      "thu": 4,
      "\u062C\u0645\u0639\u0629": 5,
      "\u0627\u0644\u062C\u0645\u0639\u0629": 5,
      "fri": 5,
      "\u0633\u0628\u062A": 6,
      "\u0627\u0644\u0633\u0628\u062A": 6,
      "sat": 6
    };
    return doctor.offDays.some((entry) => {
      const e = entry.trim().toLowerCase();
      if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return e === date;
      for (const [key, num] of Object.entries(dayMap)) {
        if (e === key.toLowerCase() && num === dayOfWeek) return true;
      }
      return false;
    });
  }
  /**
   * Check if an interval [slotStart, slotEnd) intersects a break interval
   */
  static intersectsBreak(slotStart, slotEnd, breaks) {
    return breaks.some((b) => slotStart < b.endMinute && slotEnd > b.startMinute);
  }
  /**
   * Check if an interval [slotStart, slotEnd) overlaps any existing booking interval
   */
  static overlapsBooking(slotStart, slotEnd, doctor, date, bookings) {
    const toMin = (t) => {
      const [h, m] = t.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    return bookings.some((b) => {
      if (b.date !== date) return false;
      const sameDoctor = b.doctorId && b.doctorId === doctor.id || b.doctorName && (b.doctorName === doctor.name || doctor.name.includes(b.doctorName) || b.doctorName.includes(doctor.name));
      if (!sameDoctor) return false;
      const bStart = toMin(b.startTime);
      const bEnd = b.endTime ? toMin(b.endTime) : bStart + 30;
      return slotStart < bEnd && slotEnd > bStart;
    });
  }
  /**
   * Generate available time slots for a doctor starting from tomorrow or specific date (YYYY-MM-DD).
   * Applies 1.2x Human Buffer Multiplier, excludes BreakTimes / OffDays / existing bookings / locked slots,
   * and enforces DailyPatientCapacity.
   */
  static generateAvailableSlots(doctor, date, existingBookings = [], serviceDurationMinutes = 30, ignoreLockedSlotId) {
    const slots = [];
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();
    if (!doctor.workingHours.days.includes(dayOfWeek)) {
      return slots;
    }
    if (this.isOffDay(doctor, date, dayOfWeek)) {
      return slots;
    }
    const { startHour, endHour, slotDurationMinutes } = doctor.workingHours;
    const effectiveDuration = Math.ceil((serviceDurationMinutes || slotDurationMinutes) * 1.2);
    const breaks = this.parseBreakTimes(doctor.breakTimes);
    const capacity = doctor.dailyPatientCapacity || 20;
    const bookedCount = existingBookings.filter(
      (b) => b.date === date && (b.doctorId && b.doctorId === doctor.id || b.doctorName && (b.doctorName === doctor.name || doctor.name.includes(b.doctorName) || b.doctorName.includes(doctor.name)))
    ).length;
    const remainingCapacity = Math.max(0, capacity - bookedCount);
    let currentMinute = startHour * 60;
    const endMinute = endHour * 60;
    while (currentMinute + effectiveDuration <= endMinute && slots.length < remainingCapacity) {
      const startH = Math.floor(currentMinute / 60).toString().padStart(2, "0");
      const startM = (currentMinute % 60).toString().padStart(2, "0");
      const endSlotMinute = currentMinute + effectiveDuration;
      const endH = Math.floor(endSlotMinute / 60).toString().padStart(2, "0");
      const endM = (endSlotMinute % 60).toString().padStart(2, "0");
      const startTime = `${startH}:${startM}`;
      const endTime = `${endH}:${endM}`;
      const slotKey = `${doctor.id}_${date}_${startTime}`;
      const inBreak = this.intersectsBreak(currentMinute, endSlotMinute, breaks);
      const isAlreadyBooked = this.overlapsBooking(currentMinute, endSlotMinute, doctor, date, existingBookings);
      const isLocked = ignoreLockedSlotId === slotKey ? false : AtomicLockManager.isLocked(slotKey);
      if (!inBreak && !isAlreadyBooked && !isLocked) {
        slots.push({
          slotId: slotKey,
          doctorId: doctor.id,
          doctorName: doctor.name,
          date,
          startTime,
          endTime,
          isLocked: false
        });
      }
      currentMinute += effectiveDuration;
    }
    return slots;
  }
  /**
   * Check if a [startMinute, endMinute) interval falls inside the doctor's break times
   */
  static isTimeInBreak(doctor, startMinute, endMinute) {
    return this.intersectsBreak(startMinute, endMinute, this.parseBreakTimes(doctor.breakTimes));
  }
  /**
   * Lock a temporary slot for 10 minutes during patient confirmation
   */
  static lockSlotTemporarily(slot, ttlMs = 6e5, owner) {
    return AtomicLockManager.acquireLock(slot.slotId, ttlMs, owner);
  }
  /**
   * Renew the lock for a slot already held by the same session (used right before final booking write)
   */
  static renewSlotLock(slot, ttlMs = 6e5, owner) {
    return AtomicLockManager.renewLock(slot.slotId, ttlMs, owner);
  }
  /**
   * Release temporary slot lock if patient cancels or changes mind
   */
  static unlockSlot(slot) {
    AtomicLockManager.releaseLock(slot.slotId);
  }
};

// src/services/google-sheets.ts
import dotenv2 from "dotenv";
import fs from "fs";
import { google } from "googleapis";
dotenv2.config();
var sheetId = "1bBQWg3iZkVF4meUr0sT6-z-wW2JSrqL1HQSOlpyJCMo";
var GoogleSheetsService = class {
  static cachedTenantConfig = null;
  static cacheTimestamp = 0;
  static CACHE_TTL_MS = 5 * 60 * 1e3;
  // 5 minutes
  /**
   * Clear in-memory cache manually on reset or deployment
   */
  static clearCache() {
    this.cachedTenantConfig = null;
    this.cacheTimestamp = 0;
  }
  /**
   * Helper to parse CSV properly taking care of quotes and commas
   */
  static parseCsv(csvText) {
    const lines = [];
    let row = [];
    let curr = "";
    let insideQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];
      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          curr += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        row.push(curr.trim());
        curr = "";
      } else if ((char === "\r" || char === "\n") && !insideQuotes) {
        if (char === "\r" && nextChar === "\n") i++;
        row.push(curr.trim());
        if (row.some((cell) => cell.length > 0)) {
          lines.push(row);
        }
        row = [];
        curr = "";
      } else {
        curr += char;
      }
    }
    if (curr.length > 0 || row.length > 0) {
      row.push(curr.trim());
      if (row.some((cell) => cell.length > 0)) {
        lines.push(row);
      }
    }
    return lines;
  }
  /**
   * Fetch Access Token dynamically from Service Account (Env Var / google-creds.json) or OAuth2 Refresh Token
   */
  static async getAccessToken() {
    try {
      const saJsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      if (saJsonEnv) {
        const credentials = JSON.parse(saJsonEnv);
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar"
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (envErr) {
      console.warn("[Env Service Account Auth Warning]:", envErr);
    }
    try {
      const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "google-creds.json";
      if (fs.existsSync(credsPath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: credsPath,
          scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar"
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (saErr) {
      console.warn("[File Service Account Auth Warning]:", saErr);
    }
    try {
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN) {
        const oauth2 = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
        const tokenResponse = await oauth2.getAccessToken();
        if (tokenResponse.token) {
          console.log("[OAuth2] Successfully obtained access token");
          return tokenResponse.token;
        }
      }
    } catch (oauthErr) {
      console.warn("[OAuth2 Auth Warning]:", oauthErr);
    }
    return null;
  }
  /**
   * Helper to fetch values from Google Sheets.
   * Strategy 1: Google Sheets API v4 with Service Account Access Token.
   * Strategy 2 (Bulletproof Fallback): GViz CSV Export endpoint (Zero Token Expiration!).
   */
  static async fetchSheetValues(rangeOrSheetName) {
    const tabName = rangeOrSheetName.split("!")[0];
    try {
      const token = await this.getAccessToken();
      if (token) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(rangeOrSheetName)}`;
        const res = await fetch(url, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.values && data.values.length > 0) {
            console.log(`[Google Sheets API v4] Successfully fetched '${tabName}' (${data.values.length} rows)`);
            return data.values;
          }
        }
      }
    } catch (err) {
      console.warn(`[Google Sheets API v4 Warning] OAuth fetch failed for '${tabName}', trying GViz CSV...`);
    }
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
      const res = await fetch(gvizUrl);
      if (res.ok) {
        const csvText = await res.text();
        const rows = this.parseCsv(csvText);
        console.log(`[Google Sheets GViz CSV] Successfully fetched '${tabName}' (${rows.length} rows)`);
        return rows;
      } else {
        const errBody = await res.text();
        throw new Error(`GViz HTTP ${res.status}: ${errBody}`);
      }
    } catch (gvizErr) {
      throw new Error(`Google Sheets Fetch Failed for tab '${tabName}': ${gvizErr.message || gvizErr}`);
    }
  }
  /**
   * Fetch Tenant Configuration with 5-minute In-Memory TTL Cache for ultra-fast responses (0.001s).
   * STRICT ZERO FALLBACK DATA: Throws explicit error if sheet or headers are missing.
   */
  static async getTenantConfig(tenantId = "live_sheet") {
    const now = Date.now();
    if (this.cachedTenantConfig && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
      console.log(`[Google Sheets Cache Hit] Returning cached TenantConfig (${Math.round((this.CACHE_TTL_MS - (now - this.cacheTimestamp)) / 1e3)}s TTL remaining)`);
      return this.cachedTenantConfig;
    }
    console.log(`[Google Sheets Cache Miss] Fetching fresh TenantConfig from Google Sheets...`);
    const metaRows = await this.fetchSheetValues("Clinic_Metadata!A1:Z50");
    const docRows = await this.fetchSheetValues("Doctors_Config!A1:Z50");
    const servRows = await this.fetchSheetValues("Services_Config!A1:Z50");
    if (!metaRows || metaRows.length < 2) {
      throw new Error(`[Google Sheets Error] Tab 'Clinic_Metadata' in sheet '${sheetId}' is empty or missing data rows.`);
    }
    const metaHeaders = (metaRows[0] || []).map((h) => String(h).trim().toLowerCase());
    const clinicNameIdx = metaHeaders.indexOf("clinicname");
    const branchIdx = metaHeaders.indexOf("branch");
    const addressIdx = metaHeaders.indexOf("address");
    const phoneIdx = metaHeaders.indexOf("phone");
    const workingHoursIdx = metaHeaders.indexOf("workinghours");
    const locationLinkIdx = metaHeaders.indexOf("locationlink");
    const allDeptIdx = metaHeaders.findIndex((h) => h.includes("alldepartm") || h.includes("alldepartment"));
    const dataRows = metaRows.slice(1);
    if (clinicNameIdx === -1 || !dataRows[0]?.[clinicNameIdx]?.trim()) {
      throw new Error(`[Google Sheets Error] Column 'ClinicName' is missing or empty in 'Clinic_Metadata'.`);
    }
    const clinicName = dataRows[0][clinicNameIdx].trim();
    const normalizeArabicText2 = (text) => {
      if (!text) return "";
      return text.replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "\u0627").replace(/ة/g, "\u0647").replace(/ى/g, "\u064A").replace(/\s+/g, " ").trim();
    };
    let metaDepartments = [];
    if (allDeptIdx !== -1) {
      dataRows.forEach((r) => {
        const val = r[allDeptIdx];
        if (val) {
          val.split(/[,،]/).forEach((d) => {
            const trimmed = d.trim();
            if (trimmed) {
              const norm = normalizeArabicText2(trimmed);
              if (!metaDepartments.some((existing) => normalizeArabicText2(existing) === norm)) {
                metaDepartments.push(trimmed);
              }
            }
          });
        }
      });
    }
    const parseWorkingHoursRange = (hoursStr) => {
      if (!hoursStr) return { startHour: 9, endHour: 20 };
      const matches = hoursStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
      if (matches) {
        let start = parseInt(matches[1]);
        const startAmPm = matches[3]?.toUpperCase();
        if (startAmPm === "PM" && start < 12) start += 12;
        if (startAmPm === "AM" && start === 12) start = 0;
        let end = parseInt(matches[4]);
        const endAmPm = matches[6]?.toUpperCase();
        if (endAmPm === "PM" && end < 12) end += 12;
        if (endAmPm === "AM" && end === 12) end = 0;
        return { startHour: start, endHour: end };
      }
      return { startHour: 9, endHour: 20 };
    };
    const branches = dataRows.map((r, idx) => {
      const bName = branchIdx !== -1 && r[branchIdx] ? r[branchIdx].trim() : "";
      if (!bName) throw new Error(`[Google Sheets Error] Missing branch name at row ${idx + 2} in 'Clinic_Metadata'.`);
      return {
        id: `b_${idx + 1}`,
        name: bName,
        address: addressIdx !== -1 && r[addressIdx] ? r[addressIdx].trim() : "",
        phone: phoneIdx !== -1 && r[phoneIdx] ? r[phoneIdx].trim() : "",
        workingHours: workingHoursIdx !== -1 && r[workingHoursIdx] ? r[workingHoursIdx].trim() : "",
        locationLink: locationLinkIdx !== -1 && r[locationLinkIdx] ? r[locationLinkIdx].trim() : ""
      };
    });
    const parseWorkingDays = (daysStr) => {
      if (!daysStr) return [0, 1, 2, 3, 4, 6];
      const text = daysStr.trim().toLowerCase();
      if (text.includes("\u0643\u0644 \u0627\u0644\u0623\u064A\u0627\u0645") || text.includes("\u064A\u0648\u0645\u064A\u0627")) return [0, 1, 2, 3, 4, 5, 6];
      const dayMap = {
        "\u0623\u062D\u062F": 0,
        "\u0627\u0644\u0627\u062D\u062F": 0,
        "\u0627\u0644\u0623\u062D\u062F": 0,
        "sun": 0,
        "\u0625\u062B\u0646\u064A\u0646": 1,
        "\u0627\u062B\u0646\u064A\u0646": 1,
        "\u0627\u0644\u0625\u062B\u0646\u064A\u0646": 1,
        "mon": 1,
        "\u062B\u0644\u0627\u062B\u0627\u0621": 2,
        "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621": 2,
        "tue": 2,
        "\u0623\u0631\u0628\u0639\u0627\u0621": 3,
        "\u0627\u0631\u0628\u0639\u0627\u0621": 3,
        "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621": 3,
        "wed": 3,
        "\u062E\u0645\u064A\u0633": 4,
        "\u0627\u0644\u062E\u0645\u064A\u0633": 4,
        "thu": 4,
        "\u062C\u0645\u0639\u0629": 5,
        "\u0627\u0644\u062C\u0645\u0639\u0629": 5,
        "fri": 5,
        "\u0633\u0628\u062A": 6,
        "\u0627\u0644\u0633\u0628\u062A": 6,
        "sat": 6
      };
      if (text.includes("-") || text.includes("\u0625\u0644\u0649") || text.includes("\u0644\u0640")) {
        const parts = text.split(/\s*(?:-|–|—|إلى|لـ)\s*/).map((p) => p.trim());
        let startDay = -1;
        let endDay = -1;
        for (const [key, num] of Object.entries(dayMap)) {
          if (parts[0]?.includes(key)) startDay = num;
          if (parts[1]?.includes(key)) endDay = num;
        }
        if (startDay !== -1 && endDay !== -1) {
          const days2 = [];
          let curr = startDay;
          while (true) {
            days2.push(curr);
            if (curr === endDay) break;
            curr = (curr + 1) % 7;
          }
          return days2;
        }
      }
      const days = [];
      for (const [key, num] of Object.entries(dayMap)) {
        if (text.includes(key) && !days.includes(num)) {
          days.push(num);
        }
      }
      return days.length > 0 ? days : [0, 1, 2, 3, 4, 6];
    };
    const docHeaders = (docRows[0] || []).map((h) => String(h).trim().toLowerCase());
    const docNameIdx = docHeaders.indexOf("doctorname");
    const docBranchIdx = docHeaders.indexOf("branch");
    const docPhoneIdx = docHeaders.indexOf("secretariatphone");
    const docSpecIdx = docHeaders.indexOf("specialization");
    const docCalIdx = docHeaders.indexOf("calendarid");
    const docTitleIdx = docHeaders.indexOf("doctortitleexperience");
    const docCapacityIdx = docHeaders.indexOf("dailypatientcapacity");
    const docDaysIdx = docHeaders.findIndex((h) => h.includes("workingday") || h.includes("days"));
    const docHoursIdx = docHeaders.findIndex((h) => h.includes("workinghours") || h.includes("workinghour"));
    const docBreakIdx = docHeaders.findIndex((h) => h.includes("breaktime") || h.includes("break"));
    const docOffIdx = docHeaders.findIndex((h) => h.includes("offday") || h.includes("offday") || h.includes("holiday"));
    const secretaryPhone = docPhoneIdx !== -1 && docRows[1]?.[docPhoneIdx]?.trim() ? docRows[1][docPhoneIdx].trim() : "07881015584";
    const docDataRows = docRows.slice(1);
    const doctors = docDataRows.map((d, idx) => {
      const docName = docNameIdx !== -1 && d[docNameIdx] ? d[docNameIdx].trim() : "";
      if (!docName) throw new Error(`[Google Sheets Error] Missing doctor name at row ${idx + 2} in 'Doctors_Config'.`);
      const docBranchName = docBranchIdx !== -1 && d[docBranchIdx] ? d[docBranchIdx].trim() : "";
      const docSpec = docSpecIdx !== -1 && d[docSpecIdx] ? d[docSpecIdx].trim() : "\u0637\u0628 \u0623\u0633\u0646\u0627\u0646 \u0639\u0627\u0645";
      const calId = docCalIdx !== -1 && d[docCalIdx] ? d[docCalIdx].trim() : "primary";
      const matchingBranch = branches.find((b) => b.name.trim() === docBranchName) || branches[0];
      const rawDoctorHours = docHoursIdx !== -1 && d[docHoursIdx] ? d[docHoursIdx].trim() : "";
      const parsedHours = rawDoctorHours ? parseWorkingHoursRange(rawDoctorHours) : parseWorkingHoursRange(matchingBranch.workingHours);
      const rawDaysStr = docDaysIdx !== -1 && d[docDaysIdx] ? d[docDaysIdx].trim() : "";
      const parsedDays = parseWorkingDays(rawDaysStr);
      const rawBreaks = docBreakIdx !== -1 && d[docBreakIdx] ? d[docBreakIdx].trim() : "";
      const rawOffDays = docOffIdx !== -1 && d[docOffIdx] ? d[docOffIdx].trim() : "";
      const offDays = rawOffDays ? rawOffDays.split(/[,،;]/).map((x) => x.trim()).filter(Boolean) : [];
      return {
        id: `d_${idx + 1}`,
        branchId: matchingBranch.id,
        branchName: matchingBranch.name,
        name: docName,
        specialty: docSpec,
        secretariatPhone: docPhoneIdx !== -1 && d[docPhoneIdx] ? d[docPhoneIdx].trim() : secretaryPhone,
        services: [],
        calendarId: calId,
        doctorTitleExperience: docTitleIdx !== -1 && d[docTitleIdx] ? d[docTitleIdx].trim() : "",
        dailyPatientCapacity: docCapacityIdx !== -1 && d[docCapacityIdx] ? parseInt(String(d[docCapacityIdx]).replace(/[^0-9]/g, "")) || 20 : 20,
        breakTimes: rawBreaks || void 0,
        offDays,
        workingDays: parsedDays,
        workingHours: {
          days: parsedDays,
          startHour: parsedHours.startHour,
          endHour: parsedHours.endHour,
          slotDurationMinutes: 30
        }
      };
    });
    const servHeaders = (servRows[0] || []).map((h) => String(h).trim().toLowerCase());
    const servNameIdx = servHeaders.indexOf("name");
    const servDeptIdx = servHeaders.indexOf("department");
    const servPriceIdx = servHeaders.findIndex((h) => h === "price" || h === "price_min" || h === "pricemin");
    const servPriceMinIdx = servHeaders.findIndex((h) => h === "price_min" || h === "pricemin");
    const servPriceMaxIdx = servHeaders.findIndex((h) => h === "price_max" || h === "pricemax");
    const servDoctorIdx = servHeaders.indexOf("doctor");
    const servDurationIdx = servHeaders.findIndex((h) => h === "duration" || h === "durationminutes");
    const servOfferIdx = servHeaders.indexOf("offer");
    const servPreIdx = servHeaders.indexOf("preappointmentinstructions");
    const servPostIdx = servHeaders.indexOf("postcareadvice");
    const servDataRows = servRows.slice(1);
    const services = servDataRows.map((s, idx) => {
      const sName = servNameIdx !== -1 && s[servNameIdx] ? s[servNameIdx].trim() : "";
      if (!sName) throw new Error(`[Google Sheets Error] Missing service name at row ${idx + 2} in 'Services_Config'.`);
      const sDept = servDeptIdx !== -1 && s[servDeptIdx] ? s[servDeptIdx].trim() : "";
      const toNumber = (v) => parseInt(String(v || "").replace(/[^0-9]/g, "")) || 0;
      const sPriceMin = servPriceMinIdx !== -1 ? toNumber(s[servPriceMinIdx]) : 0;
      const sPriceMax = servPriceMaxIdx !== -1 ? toNumber(s[servPriceMaxIdx]) : 0;
      const sPrice = servPriceIdx !== -1 ? toNumber(s[servPriceIdx]) : sPriceMax || sPriceMin;
      const sDuration = servDurationIdx !== -1 && s[servDurationIdx] ? toNumber(s[servDurationIdx]) || 30 : 30;
      return {
        id: `s_${idx + 1}`,
        name: sName,
        department: sDept,
        price: sPrice,
        priceMin: sPriceMin,
        priceMax: sPriceMax,
        durationMinutes: sDuration,
        doctorName: servDoctorIdx !== -1 && s[servDoctorIdx] ? s[servDoctorIdx].trim() : "",
        offer: servOfferIdx !== -1 && s[servOfferIdx] ? s[servOfferIdx].trim() : "",
        preAppointmentInstructions: servPreIdx !== -1 && s[servPreIdx] ? s[servPreIdx].trim() : "",
        postCareAdvice: servPostIdx !== -1 && s[servPostIdx] ? s[servPostIdx].trim() : ""
      };
    });
    let departments = [];
    if (metaDepartments.length > 0) {
      departments = metaDepartments;
    } else {
      const rawDepts = services.map((s) => s.department).filter(Boolean);
      departments = Array.from(new Set(rawDepts)).filter((d) => d !== "\u0639\u0627\u0645");
    }
    const tenantConfig = {
      tenantId,
      clinicName,
      secretaryPhone,
      branches,
      doctors,
      services,
      departments,
      faqs: [
        { question: "\u0627\u0644\u0645\u0648\u0642\u0639 \u0648\u0627\u0644\u0639\u0646\u0627\u0648\u064A\u0646", answer: branches.map((b) => `${b.name}: ${b.address}`).join(" | ") },
        { question: "\u0623\u0648\u0642\u0627\u062A \u0627\u0644\u062F\u0648\u0627\u0645", answer: branches.map((b) => `${b.name}: ${b.workingHours || "\u0645\u0646 9 \u0635\u0628\u0627\u062D\u0627\u064B \u0644\u0640 8 \u0645\u0633\u0627\u0621\u064B"}`).join(" | ") }
      ]
    };
    this.cachedTenantConfig = tenantConfig;
    this.cacheTimestamp = Date.now();
    return tenantConfig;
  }
  /**
   * Fetch ALL active (non-cancelled) bookings from the live Bookings tab.
   * Column map: A=code B=name C=phone D=branch E=service F=dateTime G=duration H=status
   *             I=notes J=doctorName K=reminderStatus L=platform M=department N=calendarEventId O=calendarId
   * Used by the slot engine to guarantee zero double-booking against the live sheet.
   */
  static async fetchActiveBookings(fromDate = "2000-01-01") {
    try {
      const rows = await this.fetchSheetValues("Bookings!A1:O2000");
      if (!rows || rows.length < 2) return [];
      const booked = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const status = String(r[7] || "").toUpperCase();
        if (status === "CANCELLED" || status === "") continue;
        const dateTimeStr = String(r[5] || "");
        const date = dateTimeStr.split(" ")[0] || "";
        const startTime = dateTimeStr.split(" ")[1] || "";
        if (!date || !startTime || date < fromDate) continue;
        const duration = parseInt(String(r[6])) || 30;
        const [sh, sm] = startTime.split(":").map(Number);
        const totalEnd = (sh || 0) * 60 + (sm || 0) + duration;
        const endH = Math.floor(totalEnd / 60).toString().padStart(2, "0");
        const endM = (totalEnd % 60).toString().padStart(2, "0");
        booked.push({
          bookingCode: String(r[0] || ""),
          doctorName: String(r[9] || "").trim() || void 0,
          date,
          startTime,
          endTime: `${endH}:${endM}`,
          status,
          patientPhone: String(r[2] || ""),
          calendarEventId: r[13] ? String(r[13]).trim() : void 0,
          calendarId: r[14] ? String(r[14]).trim() : void 0
        });
      }
      return booked;
    } catch (err) {
      console.warn("[Google Sheets fetchActiveBookings Warning]:", err);
      return [];
    }
  }
  /**
   * Lookup patient CRM for Returning Patient Zero-Reask Protocol
   */
  static async lookupPatientCRM(phoneNumber) {
    try {
      const rows = await this.fetchSheetValues("Patients_CRM!A1:Z500");
      if (!rows || rows.length < 2) return null;
      const headers = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
      const phoneIdx = headers.indexOf("phonenumber");
      const nameIdx = headers.indexOf("patientname");
      const platformIdx = headers.indexOf("platform");
      const bookingsIdx = headers.indexOf("totalbookings");
      const lastVisitIdx = headers.indexOf("lastvisitdate");
      const noShowIdx = headers.indexOf("noshowcount");
      if (phoneIdx === -1 || nameIdx === -1) return null;
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rPhone = (r[phoneIdx] || "").replace(/[^0-9]/g, "");
        if (rPhone && rPhone === cleanPhone && r[nameIdx]?.trim()) {
          return {
            phoneNumber: rPhone,
            patientName: r[nameIdx].trim(),
            platform: platformIdx !== -1 ? r[platformIdx] : "WhatsApp",
            totalBookings: bookingsIdx !== -1 ? parseInt(r[bookingsIdx]) || 1 : 1,
            lastVisitDate: lastVisitIdx !== -1 ? r[lastVisitIdx] : "",
            noShowCount: noShowIdx !== -1 ? parseInt(r[noShowIdx]) || 0 : 0
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Save or UPDATE the patient in Patients_CRM tab.
   * If the patient already exists (matched by normalized phone), the existing row is updated:
   * TotalBookings is incremented, LastVisitDate refreshed, NoShowCount preserved.
   * Otherwise a new row is appended.
   * Column map: A=phone B=patientName C=platform D=totalBookings E=lastVisitDate F=noShowCount G=notes
   */
  static async savePatientCRM(patient) {
    const token = await this.getAccessToken();
    if (!token) return false;
    const cleanName = patient.patientName.replace(/^=/, "'=");
    const cleanPhone = String(patient.phoneNumber || "").replace(/[^0-9]/g, "");
    const visitDate = patient.lastVisitDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const newTotalBookings = patient.totalBookings || 1;
    try {
      const rows = await this.fetchSheetValues("Patients_CRM!A1:G1000");
      if (rows && rows.length >= 2) {
        const headers = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
        const phoneIdx = headers.indexOf("phonenumber");
        const bookingsIdx = headers.indexOf("totalbookings");
        const lastVisitIdx = headers.indexOf("lastvisitdate");
        const noShowIdx = headers.indexOf("noshowcount");
        const nameIdx = headers.indexOf("patientname");
        const platformIdx = headers.indexOf("platform");
        const notesIdx = headers.indexOf("notes");
        for (let i = 1; i < rows.length; i++) {
          const rPhone = String(rows[i][phoneIdx] || "").replace(/[^0-9]/g, "");
          if (rPhone && rPhone === cleanPhone) {
            const rowIndex = i + 1;
            const existingBookings = bookingsIdx !== -1 && rows[i][bookingsIdx] ? parseInt(String(rows[i][bookingsIdx])) || 0 : 0;
            const noShow = noShowIdx !== -1 && rows[i][noShowIdx] ? parseInt(String(rows[i][noShowIdx])) || 0 : 0;
            const updates = [];
            if (bookingsIdx !== -1) updates.push([`Patients_CRM!D${rowIndex}`, [[existingBookings + newTotalBookings]]]);
            if (lastVisitIdx !== -1) updates.push([`Patients_CRM!E${rowIndex}`, [[visitDate]]]);
            if (nameIdx !== -1 && rows[i][nameIdx] !== patient.patientName) updates.push([`Patients_CRM!B${rowIndex}`, [[cleanName]]]);
            if (platformIdx !== -1 && !rows[i][platformIdx]) updates.push([`Patients_CRM!C${rowIndex}`, [[patient.platform || "WhatsApp"]]]);
            if (notesIdx !== -1 && patient.notes) updates.push([`Patients_CRM!G${rowIndex}`, [[patient.notes]]]);
            if (updates.length > 0) {
              const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate?valueInputOption=USER_ENTERED`;
              const res = await fetch(url, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  valueInputOption: "USER_ENTERED",
                  data: updates.map(([range, values]) => ({ range, values }))
                })
              });
              if (res.ok) {
                console.log(`[Google Sheets CRM Update] Updated existing patient ${cleanPhone} (total bookings now ${existingBookings + newTotalBookings})`);
                return true;
              }
            }
            return true;
          }
        }
      }
    } catch (err) {
      console.warn("[Google Sheets CRM Update Warning]:", err);
    }
    try {
      const values = [[
        patient.phoneNumber,
        cleanName,
        patient.platform || "WhatsApp",
        newTotalBookings,
        visitDate,
        patient.noShowCount || 0,
        patient.notes || ""
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Patients_CRM!A:G:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      if (res.ok) {
        console.log(`[Google Sheets CRM] Appended new patient ${cleanPhone}`);
        return true;
      }
    } catch (err) {
      console.warn("[Google Sheets CRM Save Warning]:", err);
    }
    return false;
  }
  /**
   * Log human handoff or complaint into Complaints tab
   */
  static async logComplaint(complaint) {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const cleanName = complaint.patientName.replace(/^=/, "'=");
      const cleanContent = complaint.complaintContent.replace(/^=/, "'=");
      const values = [[
        (/* @__PURE__ */ new Date()).toISOString(),
        cleanName,
        complaint.phoneNumber,
        cleanContent,
        complaint.status || "PENDING"
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Complaints!A:E:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      if (res.ok) {
        console.log(`[Google Sheets API] Saved complaint/handoff for ${complaint.phoneNumber}`);
      } else {
        console.error(`[Google Sheets API Error] Save complaint failed with status ${res.status}`);
      }
      return res.ok;
    } catch (err) {
      console.error("[Google Sheets Complaint Error]:", err);
      return false;
    }
  }
  /**
   * Log technical system errors / stack traces into Analytics_Logs tab (separating tech errors from patient complaints)
   */
  static async logSystemError(errorMsg, phone = "", patientName = "") {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const values = [[
        (/* @__PURE__ */ new Date()).toISOString(),
        phone || "N/A",
        patientName || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645",
        errorMsg.replace(/^=/, "'="),
        "SYSTEM_ERROR"
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Analytics_Logs!A:E:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      return res.ok;
    } catch (err) {
      console.error("[Google Sheets System Error Log Failed]:", err);
      return false;
    }
  }
  /**
   * Append a new booking to Google Sheets 'Bookings' tab (15 columns A:O).
   * Returns true only when Google Sheets confirmed the write (used for calendar rollback).
   */
  static async saveBooking(booking) {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const cleanName = booking.patientName.replace(/^=/, "'=");
      const values = [[
        booking.bookingCode,
        cleanName,
        booking.patientPhone,
        booking.branchName,
        booking.serviceName,
        `${booking.date} ${booking.startTime}`,
        booking.durationMinutes,
        booking.status,
        booking.notes || "",
        booking.doctorName,
        booking.reminderStatus || "PENDING",
        booking.platform || "WhatsApp",
        booking.department || "\u0639\u0627\u0645",
        booking.calendarEventId || "",
        booking.calendarId || ""
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!A:O:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      if (res.ok) {
        console.log(`[Google Sheets API] Saved booking '${booking.bookingCode}' for ${booking.patientName}`);
        return true;
      } else {
        console.error(`[Google Sheets Save Booking Error] HTTP ${res.status}:`, await res.text());
        return false;
      }
    } catch (err) {
      console.error("[Google Sheets Save Booking Error]:", err);
      return false;
    }
  }
  /**
   * Find Active Booking by Patient Phone Number or Booking Code
   */
  static async findActiveBookingByPhone(phoneNumber) {
    try {
      const rows = await this.fetchSheetValues("Bookings!A1:Z500");
      if (!rows || rows.length < 2) return null;
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
      for (let i = rows.length - 1; i >= 1; i--) {
        const r = rows[i];
        const code = r[0] || "";
        const phone = (r[2] || "").replace(/[^0-9]/g, "");
        const status = (r[7] || "").toUpperCase();
        if ((phone === cleanPhone || code.includes(phoneNumber)) && status !== "CANCELLED") {
          const dateTimeStr = r[5] || "";
          return {
            bookingCode: code,
            patientName: r[1] || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645",
            patientPhone: r[2] || phoneNumber,
            branchName: r[3] || "",
            serviceName: r[4] || "",
            date: dateTimeStr.split(" ")[0] || "",
            startTime: dateTimeStr.split(" ")[1] || "",
            endTime: "",
            durationMinutes: parseInt(r[6]) || 30,
            patientTag: "RETURNING",
            status,
            notes: r[8] || "",
            doctorName: r[9] || "",
            tenantId: "live_sheet",
            branchId: "",
            doctorId: "",
            serviceId: "",
            createdAt: "",
            calendarEventId: r[13] ? String(r[13]).trim() : void 0,
            calendarId: r[14] ? String(r[14]).trim() : void 0
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Cancel Active Booking in Google Sheets Bookings tab (Column H = CANCELLED).
   * Returns the booking's calendar event info so the caller can also delete the Google Calendar event.
   */
  static async cancelBookingInSheet(bookingCode) {
    try {
      const token = await this.getAccessToken();
      if (!token) return null;
      const rows = await this.fetchSheetValues("Bookings!A1:O1000");
      if (!rows || rows.length < 2) return null;
      for (let i = 1; i < rows.length; i++) {
        const code = rows[i][0] || "";
        if (code === bookingCode) {
          const rowIndex = i + 1;
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!H${rowIndex}?valueInputOption=USER_ENTERED`;
          const res = await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [["CANCELLED"]] })
          });
          if (res.ok) {
            return {
              bookingCode,
              calendarEventId: rows[i][13] ? String(rows[i][13]).trim() : void 0,
              calendarId: rows[i][14] ? String(rows[i][14]).trim() : void 0
            };
          }
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Update Reminder Status in Google Sheets Bookings tab (Column K)
   */
  static async updateReminderStatus(bookingCode, status = "SENT") {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const rows = await this.fetchSheetValues("Bookings!A1:Z500");
      if (!rows || rows.length < 2) return false;
      for (let i = 1; i < rows.length; i++) {
        const code = rows[i][0] || "";
        if (code === bookingCode) {
          const rowIndex = i + 1;
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!K${rowIndex}?valueInputOption=USER_ENTERED`;
          const res = await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [[status]] })
          });
          return res.ok;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * Log Analytics row in Google Sheets Analytics tab.
   * Analytics columns: A=Date B=TotalMessages C=TotalBookings D=CancelledBookings E=NoShows F=RecoveredRevenue
   * Event details are mirrored to Analytics_Logs for auditability.
   */
  static async logAnalytics(event, details) {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const todayStr = getBaghdadToday();
      const totalBookings = event === "BOOKING_CONFIRMED" ? 1 : 0;
      const cancelledBookings = event === "BOOKING_CANCELLED" ? 1 : 0;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Analytics!A1:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          values: [[todayStr, 1, totalBookings, cancelledBookings, 0, 0]]
        })
      });
      await this.logSystemError(`[${event}] ${details}`, "", "");
      return res.ok;
    } catch {
      return false;
    }
  }
};

// src/services/google-calendar.ts
import { google as google2 } from "googleapis";
import fs2 from "fs";
var GoogleCalendarService = class {
  /**
   * Fetch Access Token dynamically from Service Account (Env Var GOOGLE_SERVICE_ACCOUNT_JSON / google-creds.json)
   * OAuth2 refresh tokens are completely eliminated for strict enterprise security.
   */
  static async getAccessToken() {
    try {
      const saJsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      if (saJsonEnv) {
        const credentials = JSON.parse(saJsonEnv);
        const auth = new google2.auth.GoogleAuth({
          credentials,
          scopes: [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/spreadsheets"
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (envErr) {
      console.warn("[Calendar Env Service Account Auth Warning]:", envErr);
    }
    try {
      const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "google-creds.json";
      if (fs2.existsSync(credsPath)) {
        const auth = new google2.auth.GoogleAuth({
          keyFile: credsPath,
          scopes: [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/spreadsheets"
          ]
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        if (tokenResponse.token) return tokenResponse.token;
      }
    } catch (saErr) {
      console.warn("[Calendar File Service Account Auth Warning]:", saErr);
    }
    return null;
  }
  /**
   * Sync confirmed booking directly into doctor's Google Calendar via Google Calendar REST API v3
   */
  static async syncAppointment(booking, doctor) {
    try {
      const token = await this.getAccessToken();
      if (!token) return null;
      const calendarId = doctor.calendarId || "primary";
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
      const startDateTime = `${booking.date}T${booking.startTime}:00`;
      const endDateTime = `${booking.date}T${booking.endTime}:00`;
      const event = {
        summary: `\u062D\u062C\u0632 \u0637\u0628\u064A: ${booking.patientName} (${booking.bookingCode})`,
        description: `\u062E\u062F\u0645\u0629: ${booking.serviceName}
\u0645\u0631\u064A\u0636: ${booking.patientName}
\u0647\u0627\u062A\u0641: ${booking.patientPhone}
\u0641\u0631\u0639: ${booking.branchName}
\u0643\u0648\u062F \u0627\u0644\u062D\u062C\u0632: ${booking.bookingCode}`,
        start: { dateTime: startDateTime, timeZone: "Asia/Baghdad" },
        end: { dateTime: endDateTime, timeZone: "Asia/Baghdad" }
      };
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(event)
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[Google Calendar API] Synced appointment for ${booking.patientName} -> Event ID: ${data.id}`);
        return data.id || null;
      } else {
        console.warn(`[Google Calendar API Warning]: HTTP ${res.status}`);
        return null;
      }
    } catch (err) {
      console.warn("[Google Calendar API Exception]:", err);
      return null;
    }
  }
  /**
   * Cancel event in Google Calendar
   */
  static async cancelAppointment(calendarId, eventId) {
    try {
      const token = await this.getAccessToken();
      if (!token || !eventId) return false;
      const calId = calendarId || "primary";
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }
};

// src/core/interpretation.ts
function normalizeArabicText(text) {
  if (!text) return "";
  return text.replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "\u0627").replace(/ة/g, "\u0647").replace(/ى/g, "\u064A").replace(/(.)\1+/g, "$1").replace(/\s+/g, " ").trim();
}
var ARABIC_DIGITS = {
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9"
};
var PERSIAN_DIGITS = {
  "\u06F0": "0",
  "\u06F1": "1",
  "\u06F2": "2",
  "\u06F3": "3",
  "\u06F4": "4",
  "\u06F5": "5",
  "\u06F6": "6",
  "\u06F7": "7",
  "\u06F8": "8",
  "\u06F9": "9"
};
function toAsciiDigits(input) {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_DIGITS[ch] ?? PERSIAN_DIGITS[ch] ?? ch);
}
var NUMBER_WORDS = {
  "\u0635\u0641\u0631": 0,
  "\u0648\u0627\u062D\u062F": 1,
  "\u0648\u062D\u062F\u0647": 1,
  "\u0627\u062B\u0646\u0627\u0646": 2,
  "\u0627\u062B\u0646\u064A\u0646": 2,
  "\u0627\u062B\u0646": 2,
  "\u062B\u0646\u064A\u0646": 2,
  "\u062B\u0644\u0627\u062B\u0647": 3,
  "\u062B\u0644\u0627\u062B\u0629": 3,
  "\u062B\u0644\u0627\u062B": 3,
  "\u0627\u0631\u0628\u0639\u0647": 4,
  "\u0627\u0631\u0628\u0639\u0629": 4,
  "\u0627\u0631\u0628\u0639": 4,
  "\u062E\u0645\u0633\u0647": 5,
  "\u062E\u0645\u0633\u0629": 5,
  "\u062E\u0645\u0633": 5,
  "\u0633\u062A\u0647": 6,
  "\u0633\u062A\u0629": 6,
  "\u0633\u062A": 6,
  "\u0633\u0628\u0639\u0647": 7,
  "\u0633\u0628\u0639\u0629": 7,
  "\u0633\u0628\u0639": 7,
  "\u062B\u0645\u0627\u0646\u064A\u0647": 8,
  "\u062B\u0645\u0627\u0646\u064A\u0629": 8,
  "\u062B\u0645\u0627\u0646": 8,
  "\u062A\u0633\u0639\u0647": 9,
  "\u062A\u0633\u0639\u0629": 9,
  "\u062A\u0633\u0639": 9,
  "\u0639\u0634\u0631\u0647": 10,
  "\u0639\u0634\u0631\u0629": 10,
  "\u0639\u0634\u0631": 10,
  "\u0646\u0635": 30,
  "\u0646\u0635\u0641": 30,
  "\u0631\u0628\u0639": 15,
  "\u0639\u0634\u0631\u064A\u0646": 20,
  "\u062E\u0645\u0633\u064A\u0646": 50
};
var WEEKDAYS = {
  "\u0627\u062D\u062F": 0,
  "\u0627\u0644\u0627\u062D\u062F": 0,
  "\u0627\u0644\u0623\u062D\u062F": 0,
  "\u0627\u062B\u0646\u064A\u0646": 1,
  "\u0627\u062B\u0646": 1,
  "\u0627\u0644\u0627\u062B\u0646\u064A\u0646": 1,
  "\u0627\u0644\u0625\u062B\u0646\u064A\u0646": 1,
  "\u062B\u0644\u0627\u062B\u0627\u0621": 2,
  "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621": 2,
  "\u0627\u0631\u0628\u0639\u0627\u0621": 3,
  "\u0623\u0631\u0628\u0639\u0627\u0621": 3,
  "\u0627\u0644\u0627\u0631\u0628\u0639\u0627\u0621": 3,
  "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621": 3,
  "\u062E\u0645\u064A\u0633": 4,
  "\u0627\u0644\u062E\u0645\u064A\u0633": 4,
  "\u062C\u0645\u0639\u0647": 5,
  "\u062C\u0645\u0639\u0629": 5,
  "\u0627\u0644\u062C\u0645\u0639\u0647": 5,
  "\u0627\u0644\u062C\u0645\u0639\u0629": 5,
  "\u0633\u0628\u062A": 6,
  "\u0627\u0644\u0633\u0628\u062A": 6
};
var DAY_NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).filter((k) => !["\u0646\u0635", "\u0646\u0635\u0641", "\u0631\u0628\u0639", "\u0639\u0634\u0631\u064A\u0646", "\u062E\u0645\u0633\u064A\u0646"].includes(k)).sort((a, b) => b.length - a.length).join("|");
var DAY_TERMS = [
  // Specific "the day after tomorrow" phrases first (before plain "باجر")
  { regex: /(?:عكب|عقبا|بعد)\s*(باجر|بكره|بكرا|غدا|غداً)(?=\s|$)/, offset: 2, term: "\u0639\u0643\u0628 \u0628\u0627\u062C\u0631" },
  { regex: /بعد\s*غد(?=\s|$)/, offset: 2, term: "\u0628\u0639\u062F \u063A\u062F" },
  { regex: /(?:باجر|بكره|بكرا|غدا|غداً)(?=\s|$)/, offset: 1, term: "\u0628\u0627\u062C\u0631" },
  { regex: /(اليوم|هذا اليوم)(?=\s|$)/, offset: 0, term: "\u0627\u0644\u064A\u0648\u0645" },
  { regex: new RegExp(`(\u0628\u0639\u062F|\u0639\u0644\u0649|\u0639\u0644\u0627|\u0639\u0644\u064A)\\s*(?:)([\u0660-\u0669\u06F0-\u06F90-9]|${DAY_NUMBER_WORD_PATTERN})\\s*(\u0627\u064A\u0627\u0645|\u0623\u064A\u0627\u0645|\u064A\u0648\u0645|\u064A\u0645)?(?=\\s|$)`), offset: -1, term: "\u0639\u062F\u062F \u0623\u064A\u0627\u0645" },
  { regex: /(بعد|على|علا|علي)\s*(اسبوع|أسبوع)(?=\s|$)/, offset: 7, term: "\u0628\u0639\u062F \u0623\u0633\u0628\u0648\u0639" }
];
function interpretDayTerm(text) {
  if (!text) return null;
  const norm = normalizeArabicText(toAsciiDigits(text));
  for (const { regex, offset, term } of DAY_TERMS) {
    const m = norm.match(regex);
    if (!m) continue;
    if (offset === -1) {
      const numTok = m[2];
      const n = /^\d+$/.test(numTok) ? parseInt(numTok, 10) : NUMBER_WORDS[numTok] ?? 0;
      if (n >= 1 && n <= 30) return { term: `\u0628\u0639\u062F ${n} \u0623\u064A\u0627\u0645`, offset: n };
      continue;
    }
    return { term, offset };
  }
  for (const [key, dayNum] of Object.entries(WEEKDAYS)) {
    const regex = new RegExp(`(^|\\s|\u064A\u0648\u0645|\u0628\u0648\u0645)${key}($|\\s)`);
    if (regex.test(norm)) {
      const today = new Date(getBaghdadToday()).getDay();
      let offset = (dayNum - today + 7) % 7;
      if (offset === 0) offset = 7;
      return { term: key, offset };
    }
  }
  return null;
}
var TIME_OF_DAY = [
  { regex: /(الصبح|الصبحية|الصباح|بكرا الصبح)(?=\s|$)/, range: { startMinute: 8 * 60, endMinute: 11 * 60 }, term: "\u0627\u0644\u0635\u0628\u062D" },
  { regex: /(الضحى|الضحة)(?=\s|$)/, range: { startMinute: 9 * 60, endMinute: 12 * 60 }, term: "\u0627\u0644\u0636\u062D\u0649" },
  { regex: /(الظهر|نص النهار|ظهيرة)(?=\s|$)/, range: { startMinute: 12 * 60, endMinute: 15 * 60 }, term: "\u0627\u0644\u0638\u0647\u0631" },
  { regex: /(العصر|بعد الظهر)(?=\s|$)/, range: { startMinute: 15 * 60, endMinute: 18 * 60 }, term: "\u0627\u0644\u0639\u0635\u0631" },
  { regex: /(المغرب|بعد العصر)(?=\s|$)/, range: { startMinute: 18 * 60, endMinute: 20 * 60 }, term: "\u0627\u0644\u0645\u063A\u0631\u0628" },
  { regex: /(الليل|ليلا|بليل)(?=\s|$)/, range: { startMinute: 19 * 60, endMinute: 23 * 60 }, term: "\u0627\u0644\u0644\u064A\u0644" }
];
function interpretTimeTerm(text) {
  if (!text) return null;
  const norm = normalizeArabicText(toAsciiDigits(text));
  const hhmm = norm.match(/(?:الساعه|ساعه|ب\s*)?(\d{1,2})\s*[:.،]\s*(\d{2})\b/);
  if (hhmm) {
    const hh = parseInt(hhmm[1], 10);
    const mm = parseInt(hhmm[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return { kind: "exact", value: { hh, mm } };
  }
  const numberHour = norm.match(/الساعه\s+(\S+)/);
  if (numberHour) {
    const word = numberHour[1].replace(/[،.]+$/, "");
    if (NUMBER_WORDS[word] !== void 0) {
      const mmMatch = norm.match(/(ونص|ونصف|نص|نصف|وربع)/);
      const mm = mmMatch ? mmMatch[1].includes("\u0631\u0628\u0639") ? 15 : 30 : 0;
      return { kind: "exact", value: { hh: NUMBER_WORDS[word], mm } };
    }
  }
  const plainHour = norm.match(/^(\d{1,2})\s*(ونص|ونصف|نص|نصف)?$/);
  if (plainHour) {
    const hh = parseInt(plainHour[1], 10);
    if (hh >= 0 && hh <= 23) {
      const mm = plainHour[2] ? 30 : 0;
      return { kind: "exact", value: { hh, mm } };
    }
  }
  for (const { regex, range, term } of TIME_OF_DAY) {
    if (regex.test(norm)) return { kind: "range", value: { ...range, term } };
  }
  return null;
}
function bagSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const count = (s) => {
    const map = /* @__PURE__ */ new Map();
    for (const ch of s) map.set(ch, (map.get(ch) || 0) + 1);
    return map;
  };
  const ma = count(a);
  const mb = count(b);
  let common = 0;
  for (const [ch, n] of ma) common += Math.min(n, mb.get(ch) || 0);
  return common / Math.max(a.length, b.length);
}
function digramOverlap(a, b) {
  if (a.length < 3 || b.length < 3) return 1;
  const digrams = (s) => {
    const set = /* @__PURE__ */ new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const sa = digrams(a);
  const sb = digrams(b);
  const smaller = sa.size <= sb.size ? sa : sb;
  const larger = sa.size <= sb.size ? sb : sa;
  let common = 0;
  for (const d of smaller) if (larger.has(d)) common++;
  return common / smaller.size;
}
function wordFuzzyScore(userWord, candWord) {
  if (!userWord || !candWord) return 0;
  if (userWord === candWord) return 1;
  const stripArticle = (s) => s.replace(/^(?:وال|ال)/, "");
  const [u, c] = [stripArticle(userWord), stripArticle(candWord)];
  if (u === c) return 1;
  if (u.length >= 3 && c.startsWith(u)) return 0.95;
  if (c.length >= 3 && u.startsWith(c)) return 0.85;
  const bag = bagSimilarity(u || userWord, c || candWord);
  const dig = digramOverlap(u || userWord, c || candWord);
  if (bag >= 0.6 && dig >= 0.3) return bag;
  if (bag >= 0.55 && Math.max(u.length, c.length) >= 4 && dig >= 0.3) return bag;
  return 0;
}
function entityMentionScore(name, text) {
  const candWords = normalizeArabicText(name).split(/\s+/).filter((w) => w.length >= 2);
  if (candWords.length === 0) return 0;
  const textWords = normalizeArabicText(text).split(/\s+/).filter((w) => w.length >= 1);
  if (textWords.length === 0) return 0;
  let matchedWords = 0;
  const used = /* @__PURE__ */ new Set();
  for (const cw of candWords) {
    let best = 0;
    let bestIdx = -1;
    for (let i = 0; i < textWords.length; i++) {
      if (used.has(i)) continue;
      const score = wordFuzzyScore(cw, textWords[i]);
      if (score > best) {
        best = score;
        bestIdx = i;
      }
    }
    if (best >= 0.55 && bestIdx >= 0) {
      matchedWords++;
      used.add(bestIdx);
    }
  }
  const ratio = matchedWords / candWords.length;
  if (candWords.length >= 3) return ratio >= 2 / 3 ? ratio : 0;
  return ratio >= 1 ? 1 : 0;
}
function dateFromOffset(offset) {
  return formatDate(addDays(new Date(getBaghdadToday()), offset));
}

// src/core/dynamic-slot-engine.ts
var CANCEL_REGEX = /إلغاء الحجز|الغاء الحجز|الغي الحجز|أريد ألغي|إلغاء موعدي|الغاء موعدي|نلغي الحجز|إلغاء حجز|الغاء حجز/i;
var MODIFY_REGEX = /تعديل الحجز|أغير الموعد|تغيير الموعد|عدل الموعد|تعديل موعدي|أغير وقت|تغيير وقت|أغير التاريخ/i;
var JUNK_NAME_RE = /^(undefined|null|none|لا يوجد|بدون|n\/a)$/i;
var CONFLICT_RE = /انحجز|امتلأت|قبل شوي|قبل قليل/i;
var MAX_CONDUCTOR_DEPTH = 4;
var DynamicSlotEngine = class {
  static sessions = /* @__PURE__ */ new Map();
  static getSessionsStore() {
    return this.sessions;
  }
  /**
   * Helper to get Baghdad Today Date String (YYYY-MM-DD)
   */
  static getBaghdadTodayDate() {
    return getBaghdadToday();
  }
  /**
   * Format operational working hours cleanly (12-hour format e.g., 9 صباحاً لـ 4 عصراً)
   */
  static formatWorkingHours(startHour, endHour) {
    const formatH = (h) => {
      const displayH = h % 12 || 12;
      const period = h >= 12 ? h >= 17 ? "\u0645\u0633\u0627\u0621\u064B" : "\u0639\u0635\u0631\u0627\u064B" : "\u0635\u0628\u0627\u062D\u0627\u064B";
      return `${displayH} ${period}`;
    };
    return `${formatH(startHour)} \u0644\u063A\u0627\u064A\u0629 ${formatH(endHour)}`;
  }
  /**
   * Process incoming WhatsApp user message through the Gemini-driven conversation conductor.
   */
  static async processMessage(phone, messageText, tenant) {
    const reply = await this._processMessage(phone, messageText, tenant);
    const session = this.sessions.get(phone);
    if (session) {
      if (!session.recentMessages) session.recentMessages = [];
      session.recentMessages.push({ role: "bot", text: reply });
      if (session.recentMessages.length > 6) session.recentMessages = session.recentMessages.slice(-6);
    }
    return reply;
  }
  static async _processMessage(phone, messageText, tenant) {
    const todayStr = getBaghdadToday();
    const dailyLimit = parseInt(process.env.DAILY_MESSAGE_LIMIT || "1000", 10);
    const trimmedMsg = messageText.trim();
    const isExplicitReset = /^(تصفير|ريست|reset|إعادة ضبط)$/i.test(trimmedMsg);
    if (isExplicitReset) {
      this.sessions.delete(phone);
      GoogleSheetsService.clearCache();
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      const newSession = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: "GREETING",
        status: "IN_PROGRESS",
        slots: { patientName: crmPatient?.patientName },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? "RETURNING" : "NEW",
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr,
        hasWelcomed: true,
        recentMessages: [{ role: "user", text: trimmedMsg }]
      };
      this.sessions.set(phone, newSession);
      const activeBookings = await GoogleSheetsService.fetchActiveBookings(todayStr);
      return this.runConductor(newSession, trimmedMsg, tenant, activeBookings, "\u062A\u0645 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0648\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0636\u0628\u0637 \u2014 \u0631\u062D\u0628\u064A \u0628\u0627\u0644\u0632\u0628\u0648\u0646 \u0648\u0627\u0628\u062F\u0626\u064A \u0631\u0648\u062A\u064A\u0646 \u0627\u0644\u062D\u062C\u0632 \u0645\u0646 \u0623\u0648\u0644 \u0633\u0624\u0627\u0644 (\u0627\u0644\u0641\u0631\u0639).", 0);
    }
    let session = this.sessions.get(phone);
    if (!session) {
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      session = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: "GREETING",
        status: "IN_PROGRESS",
        slots: { patientName: crmPatient?.patientName },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? "RETURNING" : "NEW",
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr,
        hasWelcomed: false,
        recentMessages: []
      };
      this.sessions.set(phone, session);
    } else {
      if (session.lastMessageDate !== todayStr) {
        session.dailyMessageCount = 1;
        session.lastMessageDate = todayStr;
      } else {
        session.dailyMessageCount = (session.dailyMessageCount || 0) + 1;
      }
      if (!session.patientName || !session.slots?.patientName) {
        const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
        if (crmPatient?.patientName) {
          session.patientName = crmPatient.patientName;
          session.isReturningPatient = true;
          session.patientTag = "RETURNING";
          if (!session.slots) session.slots = {};
          session.slots.patientName = crmPatient.patientName;
        }
      }
    }
    if (!session.recentMessages) session.recentMessages = [];
    session.recentMessages.push({ role: "user", text: trimmedMsg });
    if (session.recentMessages.length > 6) session.recentMessages = session.recentMessages.slice(-6);
    session.lastInteractionTime = Date.now();
    if ((session.dailyMessageCount || 0) > dailyLimit) {
      return `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0648\u0635\u0644\u0646\u0627 \u0644\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0627\u0644\u0645\u0633\u0645\u0648\u062D \u0644\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u064A\u0648\u0645\u064A\u0629. \u062A\u0642\u062F\u0631 \u062A\u062A\u0648\u0627\u0635\u0644 \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u064A\u0629 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645: ${tenant.secretaryPhone} \u062E\u0644\u0627\u0644 \u0633\u0627\u0639\u0627\u062A \u0627\u0644\u062F\u0648\u0627\u0645 \u0627\u0644\u0631\u0633\u0645\u064A\u0629.`;
    }
    if (!session.slots) {
      session.slots = { patientName: session.patientName };
    }
    try {
      let processedText = messageText;
      if (messageText.startsWith("AUDIO_BASE64:")) {
        const audioBase64 = messageText.replace("AUDIO_BASE64:", "");
        processedText = await GeminiService.transcribeAudioNote(audioBase64);
        if (!processedText) {
          return `\u0639\u0641\u0648\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0645\u0627 \u0642\u062F\u0631\u0646\u0627 \u0646\u0633\u0645\u0639 \u0627\u0644\u0628\u0635\u0645\u0629 \u0627\u0644\u0635\u0648\u062A\u064A\u0629 \u0628\u0648\u0636\u0648\u062D. \u064A\u0631\u062C\u0649 \u0643\u062A\u0627\u0628\u0629 \u0637\u0644\u0628\u0643 \u0623\u0648 \u0625\u0639\u0627\u062F\u0629 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0635\u0645\u0629 \u0648\u062A\u062F\u0644\u0644!`;
        }
      }
      const isCancelReq = CANCEL_REGEX.test(processedText);
      const isModifyReq = MODIFY_REGEX.test(processedText);
      if (isCancelReq || isModifyReq) {
        const handled = await this.handleCancelModify(session, phone, tenant, processedText, isCancelReq, isModifyReq);
        if (handled) return handled;
      }
      const activeBookings = await GoogleSheetsService.fetchActiveBookings(todayStr);
      return await this.runConductor(session, processedText, tenant, activeBookings, null, 0);
    } catch (error) {
      console.error("[DynamicSlotEngine Error]:", error);
      await GoogleSheetsService.logSystemError(`[DynamicEngine Error]: ${error.message || String(error)}`, phone, session?.patientName);
      return `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u062D\u0635\u0644 \u0627\u0646\u0642\u0637\u0627\u0639 \u0645\u0624\u0642\u062A \u0628\u0627\u0644\u062E\u062F\u0645\u0629. \u062A\u0642\u062F\u0631 \u062A\u062A\u0648\u0627\u0635\u0644 \u0648\u062A\u0643\u0645\u0644 \u062D\u062C\u0632\u0643 \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u064A\u0629 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0645\u0628\u0627\u0634\u0631: ${tenant.secretaryPhone || "07881015584"} \u062E\u0644\u0627\u0644 \u0633\u0627\u0639\u0627\u062A \u0627\u0644\u062F\u0648\u0627\u0645 \u0627\u0644\u0631\u0633\u0645\u064A\u0629.`;
    }
  }
  // ------------------------------------------------------------------
  // Gemini conversation conductor loop
  // ------------------------------------------------------------------
  static async runConductor(session, userMessage, tenant, activeBookings, toolResult, depth) {
    if (depth > MAX_CONDUCTOR_DEPTH) {
      return `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u062D\u0635\u0644 \u0627\u0646\u0642\u0637\u0627\u0639 \u0645\u0624\u0642\u062A \u0628\u0627\u0644\u062E\u062F\u0645\u0629. \u062A\u0642\u062F\u0631 \u062A\u062A\u0648\u0627\u0635\u0644 \u0648\u062A\u0643\u0645\u0644 \u062D\u062C\u0632\u0643 \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u064A\u0629 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0645\u0628\u0627\u0634\u0631: ${tenant.secretaryPhone || "07881015584"}`;
    }
    const s = session.slots || {};
    session.slots = s;
    const ctx = {
      userMessage,
      tenant,
      slots: s,
      patientName: session.patientName || s.patientName,
      isReturning: !!session.isReturningPatient,
      recentMessages: session.recentMessages || [],
      pendingProposal: !!session.pendingProposal,
      proposedSlot: session.proposedSlot,
      awaitingFinalConfirm: !!session.awaitingFinalConfirm,
      optionsOffered: session.lastPrompt?.options,
      recommendedService: this.recommendedService(tenant, s),
      toolResult,
      lockedSession: session.status === "COMPLETED_LOCKED"
    };
    const cr = await GeminiService.conductTurn(ctx);
    if (cr.intent === "cancel" || cr.intent === "modify") {
      const handled = await this.handleCancelModify(session, session.phoneNumber, tenant, userMessage, cr.intent === "cancel", cr.intent === "modify");
      if (handled) return handled;
    }
    if (cr.intent === "human") {
      await GoogleSheetsService.logComplaint({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        patientName: session.patientName || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645",
        phoneNumber: session.phoneNumber,
        complaintContent: userMessage,
        status: "PENDING"
      });
      return HandoffManager.executeHandoff(session, tenant);
    }
    if (session.status === "COMPLETED_LOCKED") {
      if (cr.action === "RESET") {
        session.status = "IN_PROGRESS";
        session.pendingProposal = false;
        session.proposedSlot = void 0;
        session.awaitingFinalConfirm = false;
        session.lastPrompt = void 0;
        session.slots = { patientName: session.patientName };
        return this.runConductor(session, userMessage, tenant, activeBookings, "\u0627\u0644\u0632\u0628\u0648\u0646 \u064A\u0631\u064A\u062F \u062D\u062C\u0632\u0627\u064B \u062C\u062F\u064A\u062F\u0627\u064B \u2014 \u0631\u062D\u0628\u064A \u0628\u0647 \u0648\u0627\u0628\u062F\u0626\u064A \u0631\u0648\u062A\u064A\u0646 \u0627\u0644\u062D\u062C\u0632 \u0645\u0646 \u0623\u0648\u0644 \u0633\u0624\u0627\u0644 (\u0627\u0644\u0641\u0631\u0639).", depth + 1);
      }
      return cr.reply;
    }
    this.applyProposed(session, cr.proposed, tenant);
    if (cr.action === "LIST_SERVICES") {
      const list = this.buildServiceList(session, tenant);
      if (list.names.length > 0) {
        session.lastPrompt = { slotType: "service", options: list.names, question: "\u0627\u062E\u062A\u0631 \u0627\u0644\u062E\u062F\u0645\u0629" };
      }
      return this.runConductor(session, userMessage, tenant, activeBookings, list.text, depth + 1);
    }
    if (cr.action === "GET_SLOTS") {
      const res = this.resolveSlotsForProposal(session, tenant, activeBookings);
      if (res.ok) {
        session.lastPrompt = { slotType: "time", options: [], question: "\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0648\u0642\u062A" };
        session.proposedSlot = res.slot;
        session.pendingProposal = true;
        session.awaitingFinalConfirm = false;
        s.doctorId = res.slot.doctorId;
        s.doctorName = res.slot.doctorName || s.doctorName;
        s.date = res.slot.date;
        s.startTime = res.slot.startTime;
      }
      return this.runConductor(session, userMessage, tenant, activeBookings, res.text, depth + 1);
    }
    if (cr.action === "RESET" || cr.action === "COMMIT_BOOKING" || cr.intent === "confirm_booking") {
      if (cr.action === "RESET") {
        session.slots = { patientName: session.patientName };
        session.pendingProposal = false;
        session.proposedSlot = void 0;
        session.awaitingFinalConfirm = false;
        session.lastPrompt = void 0;
        return this.runConductor(session, userMessage, tenant, activeBookings, "\u062A\u0645 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u2014 \u0627\u0628\u062F\u0626\u064A \u0631\u0648\u062A\u064A\u0646 \u0627\u0644\u062D\u062C\u0632 \u0645\u0646 \u0623\u0648\u0644 \u0633\u0624\u0627\u0644 (\u0627\u0644\u0641\u0631\u0639).", depth + 1);
      }
      if (!session.awaitingFinalConfirm && !session.pendingProposal) {
        return this.runConductor(
          session,
          userMessage,
          tenant,
          activeBookings,
          '\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u062B\u0628\u064A\u062A \u0628\u0639\u062F \u2014 \u064A\u062C\u0628 \u0639\u0631\u0636 \u0627\u0644\u0645\u0644\u062E\u0635 \u0627\u0644\u0646\u0647\u0627\u0626\u064A \u0648\u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631 \u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0632\u0628\u0648\u0646 ("\u0646\u0639\u0645 \u062B\u0628\u062A") \u0623\u0648\u0644\u0627\u064B. \u0623\u0639\u064A\u062F\u064A \u0633\u0624\u0627\u0644 \u0627\u0644\u0645\u0644\u062E\u0635.',
          depth + 1
        );
      }
      return await this.commitBooking(session, session.phoneNumber, tenant, activeBookings, depth);
    }
    if (cr.intent === "confirm_slot") {
      if (!s.patientName) {
        return cr.reply;
      }
      session.awaitingFinalConfirm = true;
      const summary = this.buildBookingSummary(session, tenant);
      return this.runConductor(session, userMessage, tenant, activeBookings, summary, depth + 1);
    }
    if (cr.intent === "decline_slot" || cr.intent === "decline_booking") {
      session.awaitingFinalConfirm = false;
      session.pendingProposal = false;
      session.proposedSlot = void 0;
      return cr.reply;
    }
    return cr.reply;
  }
  // ------------------------------------------------------------------
  // Validation guard: resolve Gemini's proposed values to REAL clinic entities
  // ------------------------------------------------------------------
  static applyProposed(session, proposed, tenant) {
    const s = session.slots || {};
    session.slots = s;
    if (!proposed || typeof proposed !== "object") return;
    if (proposed.branchName) {
      const b = this.matchBranch(String(proposed.branchName), tenant);
      if (b) {
        const changed = s.branchName !== b.name;
        s.branchName = b.name;
        s.branchId = b.id;
        if (changed) {
          session.pendingProposal = false;
          session.proposedSlot = void 0;
          session.awaitingFinalConfirm = false;
        }
      }
    }
    if (proposed.department) {
      const d = this.matchDepartment(String(proposed.department), tenant, s);
      if (d) s.department = d;
    }
    if (proposed.serviceName) {
      const srv = this.matchService(String(proposed.serviceName), tenant, s);
      if (srv) {
        const changed = s.serviceName !== srv.name;
        s.serviceName = srv.name;
        s.serviceId = srv.id;
        if (srv.department) s.department = srv.department;
        if (changed) {
          s.doctorId = void 0;
          s.doctorName = void 0;
          session.pendingProposal = false;
          session.proposedSlot = void 0;
          session.awaitingFinalConfirm = false;
        }
      }
    }
    if (proposed.doctorName && !s.doctorName) {
      const doc = this.matchDoctor(String(proposed.doctorName), tenant, s);
      if (doc) {
        s.doctorId = doc.id;
        s.doctorName = doc.name;
      }
    }
    if (proposed.date && !s.date) {
      const day = interpretDayTerm(String(proposed.date));
      if (day && day.offset >= 1 && day.offset <= 30) {
        s.date = dateFromOffset(day.offset);
        session.pendingProposal = false;
        session.proposedSlot = void 0;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(proposed.date))) {
        s.date = String(proposed.date);
        session.pendingProposal = false;
        session.proposedSlot = void 0;
      }
    }
    if (proposed.time) {
      const tm = interpretTimeTerm(String(proposed.time));
      if (tm?.kind === "exact") {
        s.startTime = `${String(tm.value.hh).padStart(2, "0")}:${String(tm.value.mm).padStart(2, "0")}`;
        session.preferredTimeRange = void 0;
        session.pendingProposal = false;
        session.proposedSlot = void 0;
      } else if (tm?.kind === "range") {
        session.preferredTimeRange = tm.value;
        s.startTime = void 0;
        session.pendingProposal = false;
        session.proposedSlot = void 0;
      }
    }
    if (proposed.patientName && !s.patientName) {
      this.applyPatientName(session, String(proposed.patientName), tenant);
    }
  }
  static matchBranch(raw, tenant) {
    const norm = normalizeArabicText(raw);
    let best = null;
    for (const b of tenant.branches) {
      const score = Math.max(
        entityMentionScore(b.name, norm),
        entityMentionScore(b.name.replace(/^فرع\s*/, ""), norm)
      );
      if (score > 0 && (!best || score > best.score)) best = { b, score };
    }
    return best && best.score >= 0.55 ? best.b : null;
  }
  static matchDepartment(raw, tenant, s) {
    const norm = normalizeArabicText(raw);
    const candidates = Array.from(/* @__PURE__ */ new Set([
      ...tenant.departments || [],
      ...this.branchDepartments(tenant, s.branchName, s.branchId)
    ])).filter((d) => normalizeArabicText(d).length >= 2);
    let best = null;
    for (const d of candidates) {
      const score = entityMentionScore(d, norm);
      if (score > 0 && (!best || score > best.score)) best = { name: d, score };
    }
    return best && best.score >= 0.55 ? best.name : null;
  }
  static matchService(raw, tenant, s) {
    const norm = normalizeArabicText(raw);
    let candidates = tenant.services;
    if (s.branchName) {
      const branchServices = tenant.services.filter((srv) => {
        const doc = tenant.doctors.find((d) => d.name === srv.doctorName || srv.doctorName && (srv.doctorName.includes(d.name) || d.name.includes(srv.doctorName)));
        return doc ? doc.branchName === s.branchName || doc.branchId === s.branchId : true;
      });
      if (branchServices.length > 0) candidates = branchServices;
    }
    if (s.department) {
      const nd = normalizeArabicText(s.department);
      const deptServices = candidates.filter((srv) => normalizeArabicText(srv.department || "") === nd);
      if (deptServices.length > 0) candidates = deptServices;
    }
    let best = null;
    for (const srv of candidates) {
      const score = entityMentionScore(srv.name, norm);
      if (score > 0 && (!best || score > best.score)) best = { srv, score };
    }
    return best && best.score >= 0.6 ? best.srv : null;
  }
  static matchDoctor(raw, tenant, s) {
    const norm = normalizeArabicText(raw);
    let best = null;
    for (const d of tenant.doctors) {
      const score = Math.max(
        entityMentionScore(d.name, norm),
        entityMentionScore(d.name.replace(/^(د\.?|دكتور|دكتورة)\s*/, ""), norm)
      );
      if (score > 0 && (!best || score > best.score)) best = { d, score };
    }
    if (!best || best.score < 0.55) return null;
    if (s.branchName) {
      const inBranch = best.d.branchName === s.branchName || best.d.branchId === s.branchId;
      if (!inBranch) return null;
    }
    return best.d;
  }
  /** Patient name — corroborated ONLY: every word evidenced in the user's text, never entity-like */
  static applyPatientName(session, candidateRaw, tenant) {
    const s = session.slots || {};
    session.slots = s;
    if (s.patientName) return;
    const candidate = candidateRaw.trim();
    if (JUNK_NAME_RE.test(candidate)) return;
    const cNorm = normalizeArabicText(toAsciiDigits(candidate));
    const words = cNorm.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length === 0 || words.length > 4) return;
    const allEntityNames = [
      ...tenant.branches.map((b) => b.name),
      ...tenant.services.map((sv) => sv.name),
      ...tenant.doctors.map((d) => d.name),
      ...tenant.departments || []
    ];
    const entityLike = allEntityNames.some((n) => {
      const nn = normalizeArabicText(toAsciiDigits(n));
      return nn.length >= 3 && entityMentionScore(n, cNorm) >= 0.55;
    });
    if (entityLike) return;
    const evWords = this.userEvidenceText(session, "").split(/\s+/).filter((w) => w.length >= 2);
    const allPresent = words.every((w) => evWords.some((ew) => wordFuzzyScore(w, ew) >= 0.85));
    if (!allPresent) return;
    s.patientName = candidate;
    session.patientName = candidate;
  }
  /** All user texts in the rolling memory (last ~3 user messages) + optional current text */
  static userEvidenceText(session, currentText) {
    const users = (session.recentMessages || []).filter((t) => t.role === "user").map((t) => t.text);
    return [...users, currentText].join(" ");
  }
  // ------------------------------------------------------------------
  // Dynamic helpers fed to Gemini (data only, no conversation control)
  // ------------------------------------------------------------------
  /** Dynamically pick a consultation-type service (generic concept keywords only) or the cheapest */
  static recommendedService(tenant, s) {
    const candidates = this.availableServicesFor(tenant, s);
    if (candidates.length === 0) return null;
    const concept = candidates.find((sv) => /^(كشف|فحص|استشار|تشخيص|عرض)/.test(normalizeArabicText(sv.name)));
    if (concept) return concept.name;
    return [...candidates].sort((a, b) => a.price - b.price)[0].name;
  }
  static buildServiceList(session, tenant) {
    const services = this.availableServicesFor(tenant, session.slots || {});
    const names = services.map((sv) => sv.name);
    const lines = services.map((sv, i) => {
      const doc = tenant.doctors.find((d) => d.name === sv.doctorName);
      return `${i + 1}. ${sv.name} - ${sv.price > 0 ? sv.price + " \u062F\u064A\u0646\u0627\u0631" : "\u062D\u0633\u0628 \u0627\u0644\u0641\u062D\u0635"} (\u062F. ${sv.doctorName || "\u0627\u0644\u0639\u064A\u0627\u062F\u0629"}${doc ? " - " + doc.branchName : ""})`;
    });
    return { text: `\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u062D\u0627\u0644\u064A\u0627\u064B (\u0627\u0639\u0631\u0636\u064A\u0647\u0627 \u0648\u0627\u0637\u0644\u0628\u064A \u0645\u0646 \u0627\u0644\u0632\u0628\u0648\u0646 \u0627\u062E\u062A\u064A\u0627\u0631 \u0631\u0642\u0645 \u0623\u0648 \u0627\u0633\u0645):
${lines.join("\n")}`, names };
  }
  static buildBookingSummary(session, tenant) {
    const s = session.slots || {};
    const branch = tenant.branches.find((b) => b.id === s.branchId || b.name === s.branchName);
    const doctor = tenant.doctors.find((d) => d.id === s.doctorId || d.name === s.doctorName);
    const service = tenant.services.find((sv) => sv.id === s.serviceId || sv.name === s.serviceName);
    const dateLabel = s.date === getBaghdadTomorrow() ? "\u063A\u062F\u0627\u064B" : s.date;
    return `\u0645\u0644\u062E\u0635 \u0627\u0644\u062D\u062C\u0632 \u0627\u0644\u0646\u0647\u0627\u0626\u064A \u0644\u0644\u0632\u0628\u0648\u0646:
- \u0627\u0644\u0641\u0631\u0639: ${branch?.name || s.branchName || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F"}
- \u0627\u0644\u0642\u0633\u0645: ${s.department || "\u0639\u0627\u0645"}
- \u0627\u0644\u062E\u062F\u0645\u0629: ${service?.name || s.serviceName || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F"}
- \u0627\u0644\u0637\u0628\u064A\u0628: ${doctor?.name || s.doctorName || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F"}
- \u0627\u0644\u0645\u0648\u0639\u062F: ${dateLabel || s.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${s.startTime || ""}
- \u0627\u0644\u0627\u0633\u0645: ${s.patientName || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F"}
\u0627\u0639\u0631\u0636\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u062E\u0635 \u0628\u0648\u0636\u0648\u062D \u0648\u0627\u0633\u0623\u0644\u064A \u0627\u0644\u0632\u0628\u0648\u0646: "\u0646\u062B\u0628\u062A \u0643\u0644\u0634\u064A \u062A\u0645\u0627\u0645\u061F" \u0648\u0644\u0627 \u062A\u0637\u0644\u0628\u064A \u0627\u0644\u062A\u062B\u0628\u064A\u062A \u0642\u0628\u0644 \u062A\u0623\u0643\u064A\u062F\u0647 \u0627\u0644\u0646\u0647\u0627\u0626\u064A.`;
  }
  // ------------------------------------------------------------------
  // Tool: live slot resolution (single or multiple doctors → earliest)
  // ------------------------------------------------------------------
  static resolveSlotsForProposal(session, tenant, activeBookings) {
    const s = session.slots || {};
    const service = tenant.services.find((sv) => sv.id === s.serviceId || sv.name === s.serviceName);
    const duration = service?.durationMinutes || 30;
    let doctors = [];
    if (s.doctorName) {
      const d = tenant.doctors.find((doc) => doc.id === s.doctorId || doc.name === s.doctorName);
      if (d) doctors = [d];
    }
    if (doctors.length === 0 && service?.doctorName) {
      const d = tenant.doctors.find((doc) => doc.name === service.doctorName || doc.name.includes(service.doctorName) || service.doctorName.includes(doc.name));
      if (d) doctors = [d];
    }
    if (doctors.length === 0) {
      doctors = tenant.doctors.filter(
        (d) => (!s.branchName || d.branchName === s.branchName || d.branchId === s.branchId) && (!s.department || d.specialty?.includes(s.department) || tenant.services.some((sv) => normalizeArabicText(sv.department || "") === normalizeArabicText(s.department || "") && (sv.doctorName === d.name || !sv.doctorName)))
      );
    }
    doctors = doctors.filter(Boolean);
    if (doctors.length === 0) {
      return { ok: false, text: "\u0645\u0627 \u0644\u0642\u064A\u0646\u0627 \u0637\u0628\u064A\u0628 \u0645\u0637\u0627\u0628\u0642 \u0644\u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u2014 \u0627\u0637\u0644\u0628\u064A \u0645\u0646 \u0627\u0644\u0632\u0628\u0648\u0646 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0637\u0628\u064A\u0628 \u0623\u0648 \u0627\u0644\u062E\u062F\u0645\u0629." };
    }
    const fromDate = s.date && s.date >= getBaghdadTomorrow() ? s.date : getBaghdadTomorrow();
    let best = null;
    const options = [];
    for (const doc of doctors) {
      let slots = this.earliestAvailableSlots(doc, fromDate, activeBookings, duration, 7, 3, session.preferredTimeRange);
      if (s.startTime) {
        const exact = slots.find((sl) => sl.startTime === s.startTime);
        if (exact) {
          slots = [exact];
        } else {
          const anyDay = this.earliestAvailableSlots(doc, fromDate, activeBookings, duration, 14, 1);
          const near = anyDay.find((sl) => sl.startTime === s.startTime);
          if (near) slots = [near];
        }
      }
      for (const sl of slots) {
        const label = `${sl.date === getBaghdadTomorrow() ? "\u063A\u062F\u0627\u064B" : sl.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${sl.startTime} \u0645\u0639 ${doc.name}`;
        options.push(label);
        if (!best || sl.date + sl.startTime < best.slot.date + best.slot.startTime) best = { doc, slot: sl };
      }
    }
    if (!best) {
      return { ok: false, text: "\u062D\u0627\u0644\u064A\u0627\u064B \u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0648\u0627\u0639\u064A\u062F \u0634\u0627\u063A\u0631\u0629 \u0642\u0631\u064A\u0628\u0629 \u2014 \u0627\u0639\u062A\u0630\u0631\u064A \u0644\u0644\u0632\u0628\u0648\u0646 \u0648\u0627\u0639\u0631\u0636\u064A \u0639\u0644\u064A\u0647 \u0627\u0644\u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0633\u0643\u0631\u062A\u064A\u0631." };
    }
    const uniqueOptions = Array.from(new Set(options)).slice(0, 3);
    return {
      ok: true,
      slot: { ...best.slot, doctorId: best.doc.id, doctorName: best.doc.name },
      text: `\u0623\u0642\u0631\u0628 \u0627\u0644\u0645\u0648\u0627\u0639\u064A\u062F \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u062D\u0627\u0644\u064A\u0627\u064B (\u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u0628\u062F\u0648\u0646 \u062A\u0639\u0627\u0631\u0636):
${uniqueOptions.join("\n")}
\u0627\u0639\u0631\u0636\u064A \u0627\u0644\u0623\u0642\u0631\u0628 \u0639\u0644\u0649 \u0627\u0644\u0632\u0628\u0648\u0646 \u0648\u0627\u0633\u0623\u0644\u064A\u0647 \u0625\u0630\u0627 \u064A\u0646\u0627\u0633\u0628\u0647 (\u0645\u0648\u0627\u0641\u0642\u061F).`
    };
  }
  static branchDepartments(tenant, branchName, branchId) {
    const branchDoctors = tenant.doctors.filter((d) => d.branchId === branchId || d.branchName === branchName);
    const branchServices = tenant.services.filter(
      (s) => branchDoctors.some((d) => d.name === s.doctorName || !s.doctorName)
    );
    const depts = Array.from(new Set(branchServices.map((s) => s.department).filter(Boolean)));
    return depts.length > 0 ? depts : tenant.departments || [];
  }
  static availableServicesFor(tenant, s) {
    const normDept = (d) => normalizeArabicText(d || "");
    let services = tenant.services;
    if (s.branchName || s.branchId) {
      const branchDocs = tenant.doctors.filter((d) => d.branchId === s.branchId || d.branchName === s.branchName);
      const branchServices = tenant.services.filter(
        (srv) => branchDocs.some((d) => d.name === srv.doctorName || !srv.doctorName)
      );
      if (branchServices.length > 0) services = branchServices;
    }
    if (s.department) {
      const deptServices = services.filter((srv) => normDept(srv.department) === normDept(s.department));
      if (deptServices.length > 0) services = deptServices;
    }
    return services;
  }
  // ------------------------------------------------------------------
  // Commit path with hard guards + fresh re-check + warm receipt
  // ------------------------------------------------------------------
  static async commitBooking(session, phone, tenant, activeBookings, depth) {
    const s = session.slots || {};
    const missing = [];
    if (!s.branchName) missing.push("\u0627\u0644\u0641\u0631\u0639");
    if (!s.serviceName) missing.push("\u0627\u0644\u062E\u062F\u0645\u0629");
    if (!s.doctorName) missing.push("\u0627\u0644\u0637\u0628\u064A\u0628");
    if (!s.patientName) missing.push("\u0627\u0644\u0627\u0633\u0645");
    if (!s.startTime && !session.proposedSlot) missing.push("\u0627\u0644\u0648\u0642\u062A");
    if (missing.length > 0) {
      const note = `\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u062B\u0628\u064A\u062A \u0628\u0639\u062F \u2014 \u0646\u0627\u0642\u0635 \u0645\u0646 \u0627\u0644\u0632\u0628\u0648\u0646: ${missing.join("\u060C ")}. \u0627\u0637\u0644\u0628\u064A \u0647\u0630\u0647 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0628\u0647\u062F\u0648\u0621 \u0642\u0628\u0644 \u0627\u0644\u062A\u062B\u0628\u064A\u062A.`;
      return this.runConductor(session, "", tenant, activeBookings, note, depth + 1);
    }
    const res = await this.finalizeBooking(session, phone, tenant);
    if (res.ok && res.booking) {
      session.awaitingFinalConfirm = false;
      return await this.receiptViaGemini(session, tenant, res.booking, res.receiptText || "");
    }
    if (res.message && CONFLICT_RE.test(res.message)) {
      const fresh = await GoogleSheetsService.fetchActiveBookings(getBaghdadToday());
      s.startTime = void 0;
      const alt = this.resolveSlotsForProposal(session, tenant, fresh);
      if (alt.ok && alt.slot) {
        session.proposedSlot = alt.slot;
        session.pendingProposal = true;
        session.awaitingFinalConfirm = false;
        s.doctorId = alt.slot.doctorId;
        s.doctorName = alt.slot.doctorName || s.doctorName;
        s.date = alt.slot.date;
        s.startTime = alt.slot.startTime;
      }
      const note = `\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0630\u064A \u0623\u0631\u062F\u062A\u0650 \u062A\u062B\u0628\u064A\u062A\u0647 \u0627\u0646\u062D\u062C\u0632 \u0642\u0628\u0644 \u0634\u0648\u064A \u0645\u0646 \u0645\u0631\u0627\u062C\u0639 \u0622\u062E\u0631.
${alt.ok ? "\u0627\u0644\u0628\u062F\u0627\u0626\u0644 \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u062D\u0627\u0644\u064A\u0627\u064B:\n" + alt.text : alt.text}
\u0627\u0639\u062A\u0630\u0631\u064A \u0644\u0644\u0632\u0628\u0648\u0646 \u0628\u0635\u062F\u0642 \u0648\u0627\u0639\u0631\u0636\u064A \u0639\u0644\u064A\u0647 \u0647\u0630\u0647 \u0627\u0644\u0628\u062F\u0627\u0626\u0644 (\u0623\u0648 \u0627\u0644\u0623\u0642\u0631\u0628 \u0625\u0630\u0627 \u0637\u0644\u0628 "\u062B\u0628\u062A \u0627\u0644\u0623\u0642\u0631\u0628").`;
      return await this.runConductor(session, "", tenant, fresh, note, depth + 1);
    }
    return res.message || `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0635\u0627\u0631 \u062E\u0644\u0644 \u062A\u0642\u0646\u064A \u0645\u0624\u0642\u062A \u0623\u062B\u0646\u0627\u0621 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062D\u062C\u0632. \u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629: ${tenant.secretaryPhone}`;
  }
  static async receiptViaGemini(session, tenant, booking, fallbackReceipt) {
    try {
      const receiptData = `\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062D\u062C\u0632 \u0631\u0633\u0645\u064A\u0627\u064B \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645 \u0642\u0628\u0644 \u0647\u0630\u0627 \u0627\u0644\u0631\u062F.
- \u0643\u0648\u062F \u0627\u0644\u062D\u062C\u0632: ${booking.bookingCode}
- \u0627\u0644\u0627\u0633\u0645: ${booking.patientName}
- \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641: ${booking.patientPhone}
- \u0627\u0644\u0641\u0631\u0639: ${booking.branchName}
- \u0627\u0644\u0642\u0633\u0645: ${booking.department || "\u0639\u0627\u0645"}
- \u0627\u0644\u062E\u062F\u0645\u0629: ${booking.serviceName}
- \u0627\u0644\u0637\u0628\u064A\u0628: ${booking.doctorName}
- \u0627\u0644\u0645\u0648\u0639\u062F: ${booking.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${booking.startTime}
- \u0627\u0644\u0645\u0648\u0642\u0639: ${tenant.branches.find((b) => b.name === booking.branchName)?.locationLink || "\u062F\u0627\u062E\u0644 \u0627\u0644\u0639\u064A\u0627\u062F\u0629"}
\u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0645\u0627 \u0642\u0628\u0644 \u0627\u0644\u062D\u0636\u0648\u0631: ${tenant.services.find((sv) => sv.name === booking.serviceName)?.preAppointmentInstructions || "\u064A\u0631\u062C\u0649 \u0627\u0644\u062D\u0636\u0648\u0631 \u0642\u0628\u0644 \u0627\u0644\u0645\u0648\u0639\u062F \u0628\u0640 15 \u062F\u0642\u064A\u0642\u0629 \u0645\u0635\u062D\u0648\u0628\u0627\u064B \u0628\u0627\u0644\u0647\u0648\u064A\u0629 \u0627\u0644\u0634\u062E\u0635\u064A\u0629."}`;
      const cr = await GeminiService.conductTurn({
        userMessage: "",
        tenant,
        slots: session.slots || {},
        patientName: booking.patientName,
        isReturning: !!session.isReturningPatient,
        recentMessages: session.recentMessages || [],
        pendingProposal: false,
        proposedSlot: null,
        awaitingFinalConfirm: false,
        toolResult: receiptData,
        bookingCommitted: true
      });
      return cr.reply && cr.reply.length > 10 ? cr.reply : fallbackReceipt;
    } catch {
      return fallbackReceipt;
    }
  }
  // ------------------------------------------------------------------
  // Cancel / modify protocol (extracted, used by regex fast-path + Gemini intent)
  // ------------------------------------------------------------------
  static async handleCancelModify(session, phone, tenant, text, isCancelReq, isModifyReq) {
    const activeBooking = await GoogleSheetsService.findActiveBookingByPhone(phone);
    if (!activeBooking) {
      return `\u0639\u064A\u0646\u064A \u0645\u0627 \u0644\u0642\u064A\u0646\u0627 \u062D\u062C\u0632 \u0646\u0634\u0637 \u0645\u0633\u062C\u0644 \u0628\u0647\u0627\u062F \u0627\u0644\u0631\u0642\u0645. \u0625\u0630\u0627 \u062A\u062D\u0628 \u062A\u062B\u0628\u062A \u062D\u062C\u0632 \u062C\u062F\u064A\u062F\u060C \u0643\u0644\u064A\u0644\u064A \u0634\u0646\u0648 \u0627\u0644\u0642\u0633\u0645 \u0623\u0648 \u0627\u0644\u062E\u062F\u0645\u0629 \u0627\u0644\u0645\u062D\u062A\u0627\u062C\u0647\u0627 \u0648\u062A\u062F\u0644\u0644!`;
    }
    const cancelResult = await GoogleSheetsService.cancelBookingInSheet(activeBooking.bookingCode);
    if (cancelResult) {
      if (cancelResult.calendarEventId && cancelResult.calendarId) {
        await GoogleCalendarService.cancelAppointment(cancelResult.calendarId, cancelResult.calendarEventId);
      }
      await GoogleSheetsService.logAnalytics("BOOKING_CANCELLED", `Cancelled by patient: ${activeBooking.bookingCode}`);
    }
    if (session.selectedSlot) SlotGenerator.unlockSlot(session.selectedSlot);
    session.proposedSlot = void 0;
    session.pendingProposal = false;
    session.awaitingFinalConfirm = false;
    if (isCancelReq) {
      if (cancelResult) {
        this.sessions.delete(phone);
        return `\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u062D\u062C\u0632\u0643 \u0627\u0644\u0633\u0627\u0628\u0642 (${activeBooking.bookingCode}) \u0628\u0646\u062C\u0627\u062D \u0639\u064A\u0646\u064A. \u0625\u0630\u0627 \u062D\u0628\u064A\u062A \u062A\u062D\u062C\u0632 \u0645\u0648\u0639\u062F \u062C\u062F\u064A\u062F \u0628\u0623\u064A \u0648\u0642\u062A\u060C \u0625\u062D\u0646\u0627 \u0628\u0627\u0646\u062A\u0638\u0627\u0631\u0643 \u0628\u0631\u062D\u0627\u0628\u0629 \u0635\u062F\u0631! \u{1F338}`;
      }
      return `\u0639\u064A\u0646\u064A \u062D\u0627\u0648\u0644\u0646\u0627 \u0646\u0644\u063A\u064A \u0627\u0644\u062D\u062C\u0632 \u0644\u0643\u0648\u062F ${activeBooking.bookingCode} \u0648\u0628\u0633 \u0635\u0627\u0631 \u062E\u0644\u0644 \u0628\u0627\u0644\u0634\u0628\u0643\u0629\u060C \u0631\u0627\u062D \u0646\u062D\u0648\u0644\u0643 \u0644\u0640 \u0627\u0644\u0633\u0643\u0631\u062A\u064A\u0631 \u0644\u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0645\u0628\u0627\u0634\u0631.`;
    } else {
      if (cancelResult) {
        session.status = "IN_PROGRESS";
        session.slots = { patientName: session.patientName };
        session.selectedSlot = void 0;
        session.lastPrompt = void 0;
        return `\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u062D\u062C\u0632\u0643 \u0627\u0644\u0633\u0627\u0628\u0642 (${activeBooking.bookingCode}) \u0644\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0648\u0639\u062F. \u062A\u0641\u0636\u0644 \u0623\u062E\u0628\u0631\u0646\u064A \u0634\u0646\u0648 \u0627\u0644\u062E\u062F\u0645\u0629 \u0623\u0648 \u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u0645\u0646\u0627\u0633\u0628 \u0625\u0644\u0643 \u0644\u062A\u062B\u0628\u064A\u062A \u0645\u0648\u0639\u062F\u0643 \u0627\u0644\u062C\u062F\u064A\u062F! \u2728`;
      }
      return `\u0639\u064A\u0646\u064A \u062D\u0627\u0648\u0644\u0646\u0627 \u0646\u0644\u063A\u064A \u0627\u0644\u062D\u062C\u0632 \u0644\u0643\u0648\u062F ${activeBooking.bookingCode} \u0648\u0628\u0633 \u0635\u0627\u0631 \u062E\u0644\u0644 \u0628\u0627\u0644\u0634\u0628\u0643\u0629\u060C \u0631\u0627\u062D \u0646\u062D\u0648\u0644\u0643 \u0644\u0640 \u0627\u0644\u0633\u0643\u0631\u062A\u064A\u0631 \u0644\u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0645\u0628\u0627\u0634\u0631.`;
    }
  }
  // ------------------------------------------------------------------
  // Finalize: fresh re-check → atomic lock → calendar-first → sheet+CRM → receipt
  // ------------------------------------------------------------------
  static async generateUniqueBookingCode(activeBookings) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `BK-${Math.floor(1e4 + Math.random() * 9e4)}`;
      if (!activeBookings.some((b) => b.bookingCode === code)) return code;
    }
    return `BK-${Date.now().toString().slice(-5)}`;
  }
  static async finalizeBooking(session, phone, tenant) {
    const s = session.slots || {};
    if (!s.patientName || ["undefined", "null", ""].includes(String(s.patientName))) {
      return { ok: false, message: `\u062A\u062F\u0644\u0644 \u0639\u064A\u0646\u064A! \u0628\u0642\u0649 \u0628\u0633 \u062A\u0632\u0648\u062F\u0646\u0627 \u0628\u0640 \u0627\u0633\u0645\u0643 \u0627\u0644\u0645\u062D\u062A\u0631\u0645 \u062D\u062A\u0649 \u0646\u062B\u0628\u062A \u0627\u0644\u062D\u062C\u0632 \u0648\u0646\u0635\u062F\u0631 \u0644\u0643 \u0643\u0627\u0631\u062A \u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0631\u0633\u0645\u064A! \u{1F338}` };
    }
    const branch = tenant.branches.find((b) => b.id === s.branchId || b.name === s.branchName);
    const doctor = tenant.doctors.find((d) => d.id === s.doctorId || d.name === s.doctorName);
    const service = tenant.services.find((srv) => srv.id === s.serviceId || srv.name === s.serviceName);
    if (!branch || !doctor || !service || !s.startTime) {
      const missing = [];
      if (!branch) missing.push("\u0627\u0644\u0641\u0631\u0639");
      if (!service) missing.push("\u0627\u0644\u062E\u062F\u0645\u0629");
      if (!doctor) missing.push("\u0627\u0644\u0637\u0628\u064A\u0628");
      if (!s.startTime) missing.push("\u0627\u0644\u0648\u0642\u062A");
      return { ok: false, message: `\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u062B\u0628\u064A\u062A \u0628\u0639\u062F \u2014 \u0646\u0627\u0642\u0635: ${missing.join("\u060C ")}. \u064A\u0631\u062C\u0649 \u062A\u062D\u062F\u064A\u062F \u0643\u0644 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0642\u0628\u0644 \u0627\u0644\u062A\u062B\u0628\u064A\u062A.` };
    }
    const freshBookings = await GoogleSheetsService.fetchActiveBookings(getBaghdadToday());
    let slot = session.proposedSlot || session.selectedSlot;
    const bookingDate = s.date || slot?.date || getBaghdadTomorrow();
    if (!slot) {
      const slots = SlotGenerator.generateAvailableSlots(doctor, bookingDate, freshBookings, service?.durationMinutes || 30);
      slot = slots.find((sl) => sl.startTime === s.startTime) || slots[0];
    }
    if (!slot) {
      return { ok: false, message: `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0647\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0646\u062D\u062C\u0632 \u0642\u0628\u0644 \u0642\u0644\u064A\u0644. \u0623\u0642\u0631\u0628 \u0645\u0648\u0639\u062F \u0645\u062A\u0627\u062D \u0625\u0644\u0643: ${this.slotListText(doctor, getBaghdadTomorrow(), freshBookings, service?.durationMinutes || 30)}` };
    }
    const startTime = s.startTime || slot.startTime;
    if (!SlotGenerator.lockSlotTemporarily(slot, void 0, phone)) {
      const next = this.earliestAvailableSlot(doctor, bookingDate, freshBookings, service?.durationMinutes || 30);
      if (next) {
        session.proposedSlot = next;
        session.pendingProposal = true;
        return { ok: false, message: `\u0639\u064A\u0646\u064A \u0647\u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0644\u064A \u0637\u0644\u0628\u062A\u0647 \u0627\u0646\u062D\u062C\u0632 \u0642\u0628\u0644 \u0634\u0648\u064A \u{1F605}. \u0623\u0642\u0631\u0628 \u0645\u0648\u0639\u062F \u0645\u062A\u0627\u062D \u0625\u0644\u0643: ${next.date === getBaghdadTomorrow() ? "\u063A\u062F\u0627\u064B" : next.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${next.startTime}. \u062A\u0631\u064A\u062F \u0623\u062D\u062C\u0632\u0647 \u0625\u0644\u0643\u061F` };
      }
      return { ok: false, message: `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0627\u0644\u0645\u0648\u0627\u0639\u064A\u062F \u0627\u0645\u062A\u0644\u0623\u062A \u0641\u062C\u0623\u0629. \u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0633\u0643\u0631\u062A\u064A\u0631 \u0644\u062A\u062B\u0628\u064A\u062A \u0645\u0648\u0639\u062F \u0628\u062F\u064A\u0644: ${tenant.secretaryPhone}` };
    }
    const stillFree = SlotGenerator.generateAvailableSlots(doctor, bookingDate, freshBookings, service?.durationMinutes || 30, slot.slotId).some((sl) => sl.startTime === startTime);
    if (!stillFree) {
      const next = this.earliestAvailableSlot(doctor, bookingDate, freshBookings, service?.durationMinutes || 30);
      if (next) {
        session.proposedSlot = next;
        session.pendingProposal = true;
        return { ok: false, message: `\u0639\u064A\u0646\u064A \u0647\u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0644\u064A \u0637\u0644\u0628\u062A\u0647 \u0627\u0646\u062D\u062C\u0632 \u0642\u0628\u0644 \u0634\u0648\u064A \u{1F605}. \u0623\u0642\u0631\u0628 \u0645\u0648\u0639\u062F \u0645\u062A\u0627\u062D \u0625\u0644\u0643: ${next.date === getBaghdadTomorrow() ? "\u063A\u062F\u0627\u064B" : next.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${next.startTime}. \u062A\u0631\u064A\u062F \u0623\u062D\u062C\u0632\u0647 \u0625\u0644\u0643\u061F` };
      }
      return { ok: false, message: `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0627\u0644\u0645\u0648\u0627\u0639\u064A\u062F \u0627\u0645\u062A\u0644\u0623\u062A \u0641\u062C\u0623\u0629. \u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0633\u0643\u0631\u062A\u064A\u0631 \u0644\u062A\u062B\u0628\u064A\u062A \u0645\u0648\u0639\u062F \u0628\u062F\u064A\u0644: ${tenant.secretaryPhone}` };
    }
    session.bookingCode = await this.generateUniqueBookingCode(freshBookings);
    const effectiveDuration = Math.ceil((service.durationMinutes || 30) * 1.2);
    const [startH, startMin] = startTime.split(":").map(Number);
    const totalEndMin = startH * 60 + (startMin || 0) + effectiveDuration;
    const computedEndH = Math.floor(totalEndMin / 60).toString().padStart(2, "0");
    const computedEndM = (totalEndMin % 60).toString().padStart(2, "0");
    const computedEndTime = `${computedEndH}:${computedEndM}`;
    const booking = {
      bookingCode: session.bookingCode,
      tenantId: tenant.tenantId,
      patientPhone: phone,
      patientName: s.patientName,
      patientTag: session.isReturningPatient ? "RETURNING" : "NEW",
      branchId: branch?.id || "b_1",
      branchName: branch?.name || "\u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u0631\u0626\u064A\u0633\u064A",
      doctorId: doctor.id,
      doctorName: doctor.name,
      serviceId: service?.id || "s_1",
      serviceName: service?.name || "\u0643\u0634\u0641\u064A\u0629 \u0639\u0627\u0645\u0629",
      department: s.department || "\u0639\u0627\u0645",
      date: bookingDate,
      startTime,
      endTime: computedEndTime,
      durationMinutes: effectiveDuration,
      status: "CONFIRMED",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      calendarId: doctor.calendarId || "primary"
    };
    let calendarEventId = null;
    try {
      calendarEventId = await GoogleCalendarService.syncAppointment(booking, doctor);
      booking.calendarEventId = calendarEventId || void 0;
      if (!calendarEventId) {
        await GoogleSheetsService.logSystemError(`Calendar event NOT created for booking ${booking.bookingCode} (${booking.patientName} @ ${bookingDate} ${startTime})`, phone, booking.patientName);
      }
    } catch (calErr) {
      await GoogleSheetsService.logSystemError(`Calendar sync error for ${booking.bookingCode}: ${calErr?.message || String(calErr)}`, phone, booking.patientName);
    }
    const saved = await GoogleSheetsService.saveBooking(booking);
    if (!saved) {
      if (calendarEventId && doctor?.calendarId) {
        await GoogleCalendarService.cancelAppointment(doctor.calendarId, calendarEventId);
      }
      return { ok: false, message: `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0635\u0627\u0631 \u062E\u0644\u0644 \u062A\u0642\u0646\u064A \u0645\u0624\u0642\u062A \u0623\u062B\u0646\u0627\u0621 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062D\u062C\u0632. \u062A\u0642\u062F\u0631 \u062A\u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0644\u0644\u062A\u062B\u0628\u064A\u062A \u0627\u0644\u0645\u0628\u0627\u0634\u0631: ${tenant.secretaryPhone}` };
    }
    await GoogleSheetsService.savePatientCRM({
      phoneNumber: phone,
      patientName: booking.patientName,
      platform: "WhatsApp",
      totalBookings: 1,
      lastVisitDate: booking.date
    });
    await GoogleSheetsService.logAnalytics("BOOKING_CONFIRMED", `Booking: ${booking.bookingCode}, Patient: ${booking.patientName}, Doctor: ${booking.doctorName}, Date: ${bookingDate} ${startTime}`);
    SlotGenerator.unlockSlot(slot);
    session.status = "COMPLETED_LOCKED";
    session.pendingProposal = false;
    session.proposedSlot = void 0;
    session.awaitingFinalConfirm = false;
    session.lastPrompt = void 0;
    const dateLabel = bookingDate === getBaghdadTomorrow() ? "\u063A\u062F\u0627\u064B" : bookingDate;
    const receiptText = `\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u062D\u062C\u0632\u0643 \u0628\u0646\u062C\u0627\u062D \u0648\u0628\u0634\u0643\u0644 \u0646\u0647\u0627\u0626\u064A \u0639\u064A\u0646\u064A! \u2705

\u{1F4CB} \u062A\u0641\u0627\u0635\u064A\u0644 \u0645\u0648\u0639\u062F\u0643 \u0627\u0644\u0631\u0633\u0645\u064A\u0629:
- \u0643\u0648\u062F \u0627\u0644\u062D\u062C\u0632: ${booking.bookingCode}
- \u0627\u0644\u0627\u0633\u0645: ${booking.patientName}
- \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641: ${phone}
- \u0627\u0644\u0641\u0631\u0639: ${booking.branchName}
- \u0627\u0644\u0637\u0628\u064A\u0628: ${booking.doctorName}
- \u0627\u0644\u062E\u062F\u0645\u0629: ${booking.serviceName}
- \u0627\u0644\u0645\u0648\u0639\u062F: ${dateLabel} ${bookingDate} \u0627\u0644\u0633\u0627\u0639\u0629 ${startTime}

\u{1F4CD} \u0645\u0648\u0642\u0639 \u0627\u0644\u0639\u064A\u0627\u062F\u0629 \u0627\u0644\u062C\u063A\u0631\u0627\u0641\u064A:
${branch?.locationLink || "\u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u0631\u0626\u064A\u0633\u064A"}

\u26A0\uFE0F \u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0648\u0642\u0627\u0626\u064A\u0629 \u0642\u0628\u0644 \u0627\u0644\u062D\u0636\u0648\u0631:
${service?.preAppointmentInstructions || "\u064A\u0631\u062C\u0649 \u0627\u0644\u062D\u0636\u0648\u0631 \u0642\u0628\u0644 \u0627\u0644\u0645\u0648\u0639\u062F \u0628\u0640 15 \u062F\u0642\u064A\u0642\u0629 \u0645\u0635\u062D\u0648\u0628\u0627\u064B \u0628\u0627\u0644\u0647\u0648\u064A\u0629 \u0627\u0644\u0634\u062E\u0635\u064A\u0629."}

\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0645\u0648\u0639\u062F\u0643 \u0628\u0627\u0644\u0634\u064A\u062A \u0648\u0627\u0644\u062A\u0642\u0648\u064A\u0645 \u0627\u0644\u0631\u0633\u0645\u064A \u0648\u0646\u0631\u0633\u0644 \u0644\u0643 \u062A\u0630\u0643\u064A\u0631 \u0642\u0628\u0644 \u0627\u0644\u0645\u0648\u0639\u062F. \u0646\u0646\u062A\u0638\u0631\u0643 \u062A\u0646\u0648\u0631\u0646\u0627 \u0628\u0640 \u0627\u0644\u0639\u064A\u0627\u062F\u0629! \u{1F338}`;
    return { ok: true, booking, receiptText };
  }
  static availableSlotsOn(doctor, date, activeBookings, duration) {
    return SlotGenerator.generateAvailableSlots(doctor, date, activeBookings, duration);
  }
  static slotListText(doctor, fromDate, activeBookings, duration, scanDays = 3) {
    const slots = this.earliestAvailableSlots(doctor, fromDate, activeBookings, duration, scanDays);
    if (slots.length === 0) return "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0648\u0627\u0639\u064A\u062F \u0634\u0627\u063A\u0631\u0629 \u0642\u0631\u064A\u0628\u0627\u064B";
    return slots.map((sl) => `${sl.date === getBaghdadTomorrow() ? "\u063A\u062F\u0627\u064B" : sl.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${sl.startTime}`).join(" \u060C ");
  }
  static earliestAvailableSlots(doctor, fromDate, activeBookings, duration, scanDays = 7, limit = 3, preferredRange) {
    const result = [];
    const today = getBaghdadToday();
    let cursor = fromDate < today ? today : fromDate;
    let guard = 0;
    while (result.length < limit && guard < scanDays) {
      const slots = this.availableSlotsOn(doctor, cursor, activeBookings, duration);
      for (const sl of slots) {
        result.push(sl);
        if (result.length >= limit) break;
      }
      cursor = formatDate(addDays(new Date(cursor), 1));
      guard++;
    }
    if (preferredRange) {
      const inRange = result.filter((sl) => {
        const [h, m] = sl.startTime.split(":").map(Number);
        const minute = h * 60 + (m || 0);
        return minute >= preferredRange.startMinute && minute + Math.ceil(duration * 1.2) <= preferredRange.endMinute;
      });
      const outRange = result.filter((sl) => !inRange.includes(sl));
      return [...inRange, ...outRange];
    }
    return result;
  }
  static earliestAvailableSlot(doctor, fromDate, activeBookings, duration, preferredRange, excludeSlotId) {
    return this.earliestAvailableSlots(doctor, fromDate, activeBookings, duration, 7, 3, preferredRange).find((sl) => !excludeSlotId || sl.slotId !== excludeSlotId);
  }
};

// src/routes/whatsapp.ts
var router = Router();
var processedMessageIds = /* @__PURE__ */ new Set();
setInterval(() => {
  if (processedMessageIds.size > 5e3) {
    const idsArray = Array.from(processedMessageIds);
    processedMessageIds.clear();
    idsArray.slice(-2500).forEach((id) => processedMessageIds.add(id));
  }
}, 15 * 60 * 1e3);
var userBuffers = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [phone, buf] of userBuffers) {
    if (now - buf.createdAt > 3e4) {
      clearTimeout(buf.timer);
      processAggregatedUserMessages(phone, [...buf.messages]).catch(() => {
      });
      userBuffers.delete(phone);
      console.warn(`[Debounce Buffer] Flushed stale buffer for ${phone} (${buf.messages.length} msgs)`);
    }
  }
}, 3e4);
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "clinic_webhook_verify_token_2026";
  if (mode && token === VERIFY_TOKEN) {
    console.log("[WhatsApp Webhook] Verified successfully!");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});
router.post("/webhook", (req, res) => {
  try {
    const body = req.body;
    if (body.object === "whatsapp_business_account") {
      res.status(200).json({ status: "success" });
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];
      if (message) {
        const messageId = message.id;
        const fromPhone = message.from;
        if (processedMessageIds.has(messageId)) {
          console.log(`[Webhook Deduplication] Ignored duplicate message ID: ${messageId}`);
          return;
        }
        processedMessageIds.add(messageId);
        if (message.type === "text") {
          const rawText = message.text?.body || "";
          const messageText = rawText.length > 1e3 ? rawText.substring(0, 1e3) : rawText;
          enqueueMessageForProcessing(fromPhone, messageText);
        } else if (message.type === "audio" && message.audio?.id) {
          fetchWhatsAppAudioBase64(message.audio.id).then((base64) => {
            if (base64) {
              enqueueMessageForProcessing(fromPhone, `AUDIO_BASE64:${base64}`);
            }
          });
        }
      }
      return;
    }
    return res.sendStatus(404);
  } catch (error) {
    console.error("[WhatsApp Webhook Error]:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
});
function enqueueMessageForProcessing(fromPhone, messageText) {
  const DEBOUNCE_TIME_MS = parseInt(process.env.MESSAGE_DEBOUNCE_MS || "4000", 10);
  const existingBuffer = userBuffers.get(fromPhone);
  if (existingBuffer) {
    clearTimeout(existingBuffer.timer);
    existingBuffer.messages.push(messageText);
    existingBuffer.timer = setTimeout(async () => {
      const messagesToProcess = [...existingBuffer.messages];
      userBuffers.delete(fromPhone);
      await processAggregatedUserMessages(fromPhone, messagesToProcess);
    }, DEBOUNCE_TIME_MS);
    console.log(`[Debounce Buffer] Appended message from ${fromPhone}. Buffer size: ${existingBuffer.messages.length}. Waiting ${DEBOUNCE_TIME_MS}ms...`);
  } else {
    const newBuffer = {
      messages: [messageText],
      createdAt: Date.now(),
      timer: setTimeout(async () => {
        const messagesToProcess = [...newBuffer.messages];
        userBuffers.delete(fromPhone);
        await processAggregatedUserMessages(fromPhone, messagesToProcess);
      }, DEBOUNCE_TIME_MS)
    };
    userBuffers.set(fromPhone, newBuffer);
    console.log(`[Debounce Buffer] Started ${DEBOUNCE_TIME_MS}ms timer for ${fromPhone}`);
  }
}
async function processAggregatedUserMessages(fromPhone, messages) {
  const combinedText = messages.join(" ");
  console.log(`[Processing Aggregated Messages for ${fromPhone}]: "${combinedText}"`);
  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    const replyText = await DynamicSlotEngine.processMessage(fromPhone, combinedText, tenant);
    console.log(`[WhatsApp Bot Reply to ${fromPhone}]: ${replyText}`);
    await sendWhatsAppCloudMessage(fromPhone, replyText);
  } catch (error) {
    console.error(`\u{1F6A8} [DEVELOPER ALERT - CRITICAL ERROR ON PHONE ${fromPhone}]:`, error?.stack || error);
    const patientHoldingMessage = "\u0627\u0644\u0639\u0641\u0648\u060C \u0645\u0645\u0643\u0646 \u062A\u0646\u062A\u0638\u0631\u0646\u064A \u062F\u0642\u0627\u0626\u0642 \u0648\u0627\u0631\u062C\u0639 \u0627\u0631\u062F \u0639\u0644\u064A\u0643\u061F";
    await sendWhatsAppCloudMessage(fromPhone, patientHoldingMessage);
  }
}
router.get("/api/tenant-debug", async (req, res) => {
  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    return res.json({ status: "ok", tenant });
  } catch (err) {
    return res.status(500).json({ error: err.message || err });
  }
});
router.post("/api/chat", async (req, res) => {
  try {
    const { phone = "07700000000", message = "\u0645\u0631\u062D\u0628\u0627" } = req.body;
    const rawText = String(message || "");
    const cleanText = rawText.length > 1e3 ? rawText.substring(0, 1e3) : rawText;
    const tenant = await GoogleSheetsService.getTenantConfig();
    const replyText = await DynamicSlotEngine.processMessage(phone, cleanText, tenant);
    return res.json({
      phone,
      userMessage: cleanText,
      botReply: replyText
    });
  } catch (error) {
    console.error("[Chat API Error]:", error);
    return res.status(500).json({ error: "Server Error" });
  }
});
async function sendWhatsAppCloudMessage(toPhone, text) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.warn("[WhatsApp Cloud API Warning] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN");
    return false;
  }
  try {
    const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "text",
        text: { preview_url: false, body: text }
      })
    });
    const resData = await response.json();
    if (response.ok) {
      console.log(`[WhatsApp Cloud API Success] Message sent to ${toPhone}`);
      return true;
    } else {
      console.error("[WhatsApp Cloud API Error]:", resData);
      return false;
    }
  } catch (err) {
    console.error("[WhatsApp Cloud API Exception]:", err);
    return false;
  }
}
async function fetchWhatsAppAudioBase64(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !mediaId) return null;
  try {
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!mediaRes.ok) return null;
    const mediaData = await mediaRes.json();
    const mediaUrl = mediaData.url;
    if (!mediaUrl) return null;
    const audioRes = await fetch(mediaUrl, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!audioRes.ok) return null;
    const arrayBuffer = await audioRes.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch (err) {
    console.error("[WhatsApp Audio Fetch Exception]:", err);
    return null;
  }
}
var whatsapp_default = router;

// src/services/watchdog.ts
var WatchdogService = class {
  static sessions = /* @__PURE__ */ new Map();
  static callbackSendWhatsApp = null;
  static registerSendCallback(cb) {
    this.callbackSendWhatsApp = cb;
  }
  /**
   * Monitor sessions and execute Revenue Recovery on abandoned interactions
   */
  static startMonitoring(sessionsStore, tenant) {
    this.sessions = sessionsStore;
    setInterval(async () => {
      const now = Date.now();
      const INACTIVITY_THRESHOLD_MS = 15 * 60 * 1e3;
      for (const [phone, session] of this.sessions.entries()) {
        if (session.currentState !== "CONFIRMED" && session.currentState !== "HUMAN_HANDOFF" && session.lastInteractionTime > 0 && now - session.lastInteractionTime > INACTIVITY_THRESHOLD_MS) {
          const recoveryMessage = `\u064A\u0627 \u0647\u0644\u0627 \u0628\u064A\u0643 \u0639\u064A\u0646\u064A \u0623\u0633\u062A\u0627\u0630\u064A\u060C \u0634\u0641\u062A \u062D\u062C\u0632\u0643 \u0628\u0645\u0631\u0643\u0632 ${tenant.clinicName} \u0628\u0639\u062F\u0647 \u0645\u0627 \u0645\u0643\u062A\u0645\u0644. \u062A\u062D\u0628 \u0646\u0643\u0645\u0644 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0645\u0646\u0627\u0633\u0628 \u0625\u0644\u0643\u061F \u0623\u0646\u0627 \u0628\u062E\u062F\u0645\u062A\u0643 \u0628\u0644\u064A \u062A\u062D\u062A\u0627\u062C\u0647.`;
          console.log(`[Watchdog & Revenue Recovery] Follow-up sent to inactive patient: ${phone}`);
          if (this.callbackSendWhatsApp) {
            await this.callbackSendWhatsApp(phone, recoveryMessage);
          }
          session.lastInteractionTime = 0;
        }
      }
    }, 12e4);
  }
};

// src/services/reminder-job.ts
var ReminderJob = class {
  static isRunning = false;
  static callbackSendWhatsApp = null;
  static registerSendCallback(cb) {
    this.callbackSendWhatsApp = cb;
  }
  /**
   * Main execution check for sending 4-hour pre-appointment reminders.
   * IMPORTANT: The reminder message is actually dispatched via the registered WhatsApp callback
   * BEFORE the row is marked SENT, so a failed send can be retried on the next scan.
   */
  static async checkAndSendReminders() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const tenant = await GoogleSheetsService.getTenantConfig();
      const rows = await GoogleSheetsService.fetchSheetValues("Bookings!A1:O500");
      if (!rows || rows.length < 2) {
        this.isRunning = false;
        return;
      }
      const todayStr = getBaghdadToday();
      const now = /* @__PURE__ */ new Date();
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const bookingCode = r[0] || "";
        const patientName = r[1] || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645";
        const phone = r[2] || "";
        const branchName = r[3] || tenant.branches[0]?.name || "";
        const dateTimeStr = r[5] || "";
        const status = (r[7] || "").toUpperCase();
        const reminderStatus = (r[10] || "").toUpperCase();
        if (status === "CONFIRMED" && reminderStatus !== "SENT" && dateTimeStr.includes(todayStr)) {
          const timePart = dateTimeStr.split(" ")[1] || "16:00";
          const [hours, minutes] = timePart.split(":").map(Number);
          const appointmentDate = /* @__PURE__ */ new Date();
          appointmentDate.setHours(hours || 16, minutes || 0, 0, 0);
          const diffMs = appointmentDate.getTime() - now.getTime();
          const diffHours = diffMs / (1e3 * 60 * 60);
          if (diffHours >= 3.5 && diffHours <= 4.5) {
            const reminderMessage = `\u0645\u0631\u062D\u0628\u0627\u064B \u0623\u0633\u062A\u0627\u0630/\u0633\u062A ${patientName} \u{1F338}
\u0646\u062D\u0628 \u0646\u0630\u0643\u0631\u0643 \u0628\u0645\u0648\u0639\u062F\u0643 \u0627\u0644\u064A\u0648\u0645 \u0627\u0644\u0633\u0627\u0639\u0629 ${timePart} \u0628\u0640 ${tenant.clinicName} (${branchName}).
\u0646\u0646\u062A\u0638\u0631\u0643 \u062A\u0646\u0648\u0631\u0646\u0627 \u0628\u0627\u0644\u0639\u064A\u0627\u062F\u0629!
\u0627\u0630\u0627 \u0639\u0646\u062F\u0643 \u0623\u064A \u0638\u0631\u0641 \u0648\u062D\u0628\u0651\u064A\u062A \u0646\u063A\u064A\u0631 \u0628\u0644\u062D\u062C\u0632 \u0627\u0648 \u0646\u0644\u063A\u064A \u062A\u062F\u0644\u0644 \u0648\u0645\u0627\u0643\u0648 \u0623\u064A \u0625\u0634\u0643\u0627\u0644,  \u0628\u0633 \u0628\u0644\u063A\u0646\u0627 \u0648\u0623\u0646\u0627 \u0628\u062E\u062F\u0645\u062A\u0643.`;
            console.log(`[Scheduled Reminder Job] Sending 4-hour pre-appointment reminder to ${patientName} (${phone}) for booking ${bookingCode}`);
            let sent = false;
            if (this.callbackSendWhatsApp) {
              try {
                await this.callbackSendWhatsApp(phone, reminderMessage);
                sent = true;
              } catch (err) {
                console.warn(`[Scheduled Reminder Job] WhatsApp send failed for ${phone}:`, err);
              }
            } else {
              console.warn("[Scheduled Reminder Job] No WhatsApp send callback registered - reminder NOT dispatched.");
            }
            if (sent) {
              await GoogleSheetsService.updateReminderStatus(bookingCode, "SENT");
            }
          }
        }
      }
    } catch (err) {
      console.warn("[Scheduled Reminder Job Warning]:", err);
    } finally {
      this.isRunning = false;
    }
  }
  /**
   * Start the background scheduler running every 15 minutes
   */
  static startScheduler(intervalMs = 15 * 60 * 1e3) {
    console.log(`[Scheduled Reminder Job] Initializing background reminder scheduler (every ${intervalMs / 6e4} minutes)...`);
    this.checkAndSendReminders();
    setInterval(() => {
      this.checkAndSendReminders();
    }, intervalMs);
  }
};

// src/app.ts
dotenv3.config();
var app = express();
var PORT = process.env.PORT || 3e3;
app.use(cors());
app.use(express.json());
app.use("/", whatsapp_default);
app.get("/health", (req, res) => {
  res.json({ status: "UP", service: "Sara Digital Clinic WhatsApp Engine", timestamp: /* @__PURE__ */ new Date() });
});
(async () => {
  try {
    const tenant = await GoogleSheetsService.getTenantConfig();
    console.log(`[Tenant Loaded Successfully]: Clinic = "${tenant.clinicName}", Branches = ${tenant.branches.map((b) => b.name).join(", ")}`);
    const sendWhatsAppText = async (phone, text) => {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      if (phoneId && token) {
        await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } })
        });
      }
    };
    WatchdogService.registerSendCallback(sendWhatsAppText);
    WatchdogService.startMonitoring(DynamicSlotEngine.getSessionsStore(), tenant);
    console.log("[Watchdog Service] Started session monitor worker with Live WhatsApp Dispatcher.");
    ReminderJob.registerSendCallback(sendWhatsAppText);
    ReminderJob.startScheduler();
    console.log("[Reminder Service] Started 4-hour pre-appointment background scheduler worker with Live WhatsApp Dispatcher.");
  } catch (err) {
    console.error("\u{1F6A8} [Startup Error Loading Tenant Config]:", err);
  }
})();
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Sara Digital Clinic WhatsApp Engine running on port ${PORT}`);
  console.log(`Google Sheet ID: ${process.env.GOOGLE_SHEET_ID}`);
  console.log(`====================================================`);
});
var app_default = app;
export {
  app_default as default
};
