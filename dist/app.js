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
    try {
      const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant),
        generationConfig: { responseMimeType: "application/json" }
      });
      const response = await model.generateContent(prompt);
      const text = response.response.text()?.trim() || "{}";
      const parsed = JSON.parse(text);
      return {
        intent: parsed.intent || "UNKNOWN",
        entities: parsed.entities || {},
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8
      };
    } catch (error) {
      console.error("Gemini NLU Error:", error);
      return {
        intent: "UNKNOWN",
        entities: {},
        confidence: 0
      };
    }
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
   * Generate Authentic Iraqi Dialect response ("سارة الرقمية") using real TenantConfig (Zero Dummy Data!)
   */
  static async generateIraqiResponse(slicedContext, tenant) {
    const prompt = `
\u0627\u0644\u0645\u0631\u0643\u0632 \u0627\u0644\u0637\u0628\u064A \u0627\u0644\u062D\u0642\u064A\u0642\u064A: ${slicedContext.clinicName}
\u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: ${slicedContext.step}
\u0627\u0644\u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0645\u0646\u0643\u0650 \u0627\u0644\u0622\u0646: ${slicedContext.stepInstruction}
\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: ${JSON.stringify(slicedContext.stepData)}
\u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u064A\u0636 \u0627\u0644\u0623\u062E\u064A\u0631\u0629: "${slicedContext.userMessage}"

\u0642\u0627\u0639\u062F\u0629 \u0635\u0627\u0631\u0645\u0629: \u0625\u0630\u0627 \u0643\u0627\u0646\u062A \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 "branchDepartmentsList"\u060C \u0627\u0646\u0633\u062E\u064A \u0646\u0635 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0645\u062A\u0631\u0642\u0645\u0629 \u0627\u0644\u0645\u0648\u062C\u0648\u062F \u062F\u0627\u062E\u0644 branchDepartmentsList \u0633\u0637\u0631 \u0628\u0633\u0637\u0631 \u0643\u0645\u0627 \u0647\u0648 \u0628\u0627\u0644\u0636\u0628\u0637 \u062F\u0648\u0646 \u062A\u063A\u064A\u064A\u0631\u0647 \u0623\u0648 \u0627\u0633\u062A\u0628\u062F\u0627\u0644\u0647 \u0628\u0627\u0644\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0639\u0627\u062F\u064A\u0629!
\u0635\u0648\u063A\u064A \u0631\u062F\u0643\u0650 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0628\u0644\u0647\u062C\u0629 \u0639\u0631\u0627\u0642\u064A\u0629 \u0645\u062D\u0628\u0648\u0628\u0629 \u0648\u0639\u0641\u0648\u064A\u0629 \u0644\u0640 "${slicedContext.clinicName}"\u060C \u0628\u062F\u0648\u0646 \u0623\u064A \u0646\u062C\u0648\u0645 \u0623\u0648 \u062E\u0637\u0648\u0637 \u0623\u0648 \u0631\u0645\u0648\u0632 \u062A\u0646\u0635\u064A\u0635 \u0623\u0648 Markdown.
\u0623\u062C\u064A\u0628\u064A \u0627\u0644\u0645\u0631\u064A\u0636 \u0645\u0628\u0627\u0634\u0631\u0629 \u0628\u062D\u0633\u0628 \u0627\u0644\u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0628\u062F\u0648\u0646 \u0625\u0636\u0627\u0641\u0629 \u0623\u064A \u0639\u0628\u0627\u0631\u0629 \u062A\u0631\u062D\u064A\u0628\u064A\u0629 \u0623\u0648 \u062E\u062A\u0627\u0645\u064A\u0629 \u0645\u0643\u0631\u0631\u0629 \u0641\u064A \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0631\u062F!
`;
    try {
      const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.getSystemInstruction(tenant)
      });
      const response = await model.generateContent(prompt);
      const reply = response.response.text()?.trim() || "";
      return this.cleanMarkdown(reply);
    } catch (error) {
      console.error("Gemini NLG Error:", error);
      return `\u062A\u0641\u0636\u0644 \u0639\u064A\u0646\u064A\u060C \u0623\u0646\u0627 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u062E\u062A\u064A\u0627\u0631\u0643 \u0644\u062A\u0643\u0645\u0644\u0629 \u0627\u0644\u062D\u062C\u0632.`;
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
   */
  static acquireLock(resourceKey, ttlMs = 6e5) {
    const now = Date.now();
    const existingLock = this.locks.get(resourceKey);
    if (existingLock && existingLock > now) {
      return false;
    }
    this.locks.set(resourceKey, now + ttlMs);
    return true;
  }
  /**
   * Release an acquired atomic lock
   */
  static releaseLock(resourceKey) {
    this.locks.delete(resourceKey);
  }
  /**
   * Check if resource is currently locked
   */
  static isLocked(resourceKey) {
    const lockTime = this.locks.get(resourceKey);
    if (!lockTime) return false;
    if (lockTime <= Date.now()) {
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
    for (const [key, expiresAt] of this.locks.entries()) {
      if (expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
};

// src/services/slot-generator.ts
var SlotGenerator = class {
  /**
   * Helper to get Tomorrow's Date (YYYY-MM-DD) for Tomorrow-First slot generation
   */
  static getTomorrowDate() {
    const tomorrow = /* @__PURE__ */ new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  }
  /**
   * Generate available time slots for a doctor starting from tomorrow or specific date (YYYY-MM-DD).
   * Applies 1.2x Human Buffer Multiplier for realistic operational margin.
   */
  static generateAvailableSlots(doctor, date, existingBookings, serviceDurationMinutes = 30) {
    const slots = [];
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();
    if (!doctor.workingHours.days.includes(dayOfWeek)) {
      return slots;
    }
    const { startHour, endHour, slotDurationMinutes } = doctor.workingHours;
    const effectiveDuration = Math.ceil((serviceDurationMinutes || slotDurationMinutes) * 1.2);
    let currentMinute = startHour * 60;
    const endMinute = endHour * 60;
    while (currentMinute + effectiveDuration <= endMinute) {
      const startH = Math.floor(currentMinute / 60).toString().padStart(2, "0");
      const startM = (currentMinute % 60).toString().padStart(2, "0");
      const endSlotMinute = currentMinute + effectiveDuration;
      const endH = Math.floor(endSlotMinute / 60).toString().padStart(2, "0");
      const endM = (endSlotMinute % 60).toString().padStart(2, "0");
      const startTime = `${startH}:${startM}`;
      const endTime = `${endH}:${endM}`;
      const slotKey = `${doctor.id}_${date}_${startTime}`;
      const isAlreadyBooked = existingBookings.some(
        (b) => b.doctorId === doctor.id && b.date === date && b.startTime === startTime
      );
      const isLocked = AtomicLockManager.isLocked(slotKey);
      if (!isAlreadyBooked && !isLocked) {
        slots.push({
          slotId: slotKey,
          doctorId: doctor.id,
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
   * Lock a temporary slot for 10 minutes during patient confirmation
   */
  static lockSlotTemporarily(slot, ttlMs = 6e5) {
    return AtomicLockManager.acquireLock(slot.slotId, ttlMs);
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
   * Fetch Access Token dynamically from Google OAuth2 Refresh Token
   */
  static async getAccessToken() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token"
        })
      });
      const data = await res.json();
      return data.access_token || null;
    } catch {
      return null;
    }
  }
  /**
   * Helper to fetch values from Google Sheets.
   * Strategy 1: Google Sheets API v4 with OAuth2 Access Token.
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
    const normalizeArabicText = (text) => {
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
              const norm = normalizeArabicText(trimmed);
              if (!metaDepartments.some((existing) => normalizeArabicText(existing) === norm)) {
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
    const docHeaders = (docRows[0] || []).map((h) => String(h).trim().toLowerCase());
    const docNameIdx = docHeaders.indexOf("doctorname");
    const docBranchIdx = docHeaders.indexOf("branch");
    const docPhoneIdx = docHeaders.indexOf("secretariatphone");
    const docSpecIdx = docHeaders.indexOf("specialization");
    const docCalIdx = docHeaders.indexOf("calendarid");
    const docTitleIdx = docHeaders.indexOf("doctortitleexperience");
    const docCapacityIdx = docHeaders.indexOf("dailypatientcapacity");
    const secretaryPhone = docPhoneIdx !== -1 && docRows[1]?.[docPhoneIdx]?.trim() ? docRows[1][docPhoneIdx].trim() : "07881015584";
    const docDataRows = docRows.slice(1);
    const doctors = docDataRows.map((d, idx) => {
      const docName = docNameIdx !== -1 && d[docNameIdx] ? d[docNameIdx].trim() : "";
      if (!docName) throw new Error(`[Google Sheets Error] Missing doctor name at row ${idx + 2} in 'Doctors_Config'.`);
      const docBranchName = docBranchIdx !== -1 && d[docBranchIdx] ? d[docBranchIdx].trim() : "";
      const docSpec = docSpecIdx !== -1 && d[docSpecIdx] ? d[docSpecIdx].trim() : "\u0637\u0628 \u0623\u0633\u0646\u0627\u0646 \u0639\u0627\u0645";
      const calId = docCalIdx !== -1 && d[docCalIdx] ? d[docCalIdx].trim() : "primary";
      const matchingBranch = branches.find((b) => b.name.trim() === docBranchName) || branches[0];
      const parsedHours = parseWorkingHoursRange(matchingBranch.workingHours);
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
        dailyPatientCapacity: docCapacityIdx !== -1 && d[docCapacityIdx] ? parseInt(d[docCapacityIdx]) || 20 : 20,
        workingDays: [0, 1, 2, 3, 4, 6],
        workingHours: {
          days: [0, 1, 2, 3, 4, 6],
          startHour: parsedHours.startHour,
          endHour: parsedHours.endHour,
          slotDurationMinutes: 30
        }
      };
    });
    const servHeaders = (servRows[0] || []).map((h) => String(h).trim().toLowerCase());
    const servNameIdx = servHeaders.indexOf("name");
    const servDeptIdx = servHeaders.indexOf("department");
    const servPriceIdx = servHeaders.indexOf("price");
    const servDoctorIdx = servHeaders.indexOf("doctor");
    const servDurationIdx = servHeaders.indexOf("duration");
    const servOfferIdx = servHeaders.indexOf("offer");
    const servPreIdx = servHeaders.indexOf("preappointmentinstructions");
    const servPostIdx = servHeaders.indexOf("postcareadvice");
    const servDataRows = servRows.slice(1);
    const services = servDataRows.map((s, idx) => {
      const sName = servNameIdx !== -1 && s[servNameIdx] ? s[servNameIdx].trim() : "";
      if (!sName) throw new Error(`[Google Sheets Error] Missing service name at row ${idx + 2} in 'Services_Config'.`);
      const sDept = servDeptIdx !== -1 && s[servDeptIdx] ? s[servDeptIdx].trim() : "";
      const rawPrice = servPriceIdx !== -1 && s[servPriceIdx] ? s[servPriceIdx].trim().replace(/[^0-9]/g, "") : "0";
      const sPrice = parseInt(rawPrice) || 0;
      const sDuration = servDurationIdx !== -1 && s[servDurationIdx] ? parseInt(s[servDurationIdx]) || 30 : 30;
      return {
        id: `s_${idx + 1}`,
        name: sName,
        department: sDept,
        price: sPrice,
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
   * Save or update Patient in Patients_CRM tab
   */
  static async savePatientCRM(patient) {
    try {
      const token = await this.getAccessToken();
      if (!token) return;
      const cleanName = patient.patientName.replace(/^=/, "'=");
      const values = [[
        patient.phoneNumber,
        cleanName,
        patient.platform || "WhatsApp",
        patient.totalBookings || 1,
        patient.lastVisitDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
        patient.noShowCount || 0,
        patient.notes || ""
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Patients_CRM!A:G:append?valueInputOption=USER_ENTERED`;
      await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
    } catch (err) {
      console.warn("[Google Sheets CRM Save Warning]:", err);
    }
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
   * Append a new booking to Google Sheets 'Bookings' tab
   */
  static async saveBooking(booking) {
    try {
      const token = await this.getAccessToken();
      if (!token) return;
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
        "PENDING",
        "WhatsApp",
        booking.department || "\u0639\u0627\u0645"
      ]];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Bookings!A:M:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      if (res.ok) {
        console.log(`[Google Sheets API] Saved booking '${booking.bookingCode}' for ${booking.patientName}`);
      }
    } catch (err) {
      console.error("[Google Sheets Save Booking Error]:", err);
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
          return {
            bookingCode: code,
            patientName: r[1] || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645",
            patientPhone: r[2] || phoneNumber,
            branchName: r[3] || "",
            serviceName: r[4] || "",
            date: (r[5] || "").split(" ")[0] || "",
            startTime: (r[5] || "").split(" ")[1] || "",
            durationMinutes: parseInt(r[6]) || 30,
            status,
            notes: r[8] || "",
            doctorName: r[9] || "",
            tenantId: "live_sheet",
            branchId: "",
            doctorId: "",
            serviceId: "",
            createdAt: ""
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Cancel Active Booking in Google Sheets Bookings tab
   */
  static async cancelBookingInSheet(bookingCode) {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const rows = await this.fetchSheetValues("Bookings!A1:Z500");
      if (!rows || rows.length < 2) return false;
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
          return res.ok;
        }
      }
      return false;
    } catch {
      return false;
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
   * Log Analytics row in Google Sheets Analytics tab
   */
  static async logAnalytics(event, details) {
    try {
      const token = await this.getAccessToken();
      if (!token) return false;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Analytics!A1:append?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          values: [[(/* @__PURE__ */ new Date()).toISOString(), event, details]]
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }
};

// src/services/google-calendar.ts
var GoogleCalendarService = class {
  /**
   * Fetch Access Token dynamically from Google OAuth2 Refresh Token
   */
  static async getAccessToken() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token"
        })
      });
      const data = await res.json();
      return data.access_token || null;
    } catch {
      return null;
    }
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
      const startDateTime = `${booking.date}T${booking.startTime}:00+03:00`;
      const endDateTime = `${booking.date}T${booking.endTime}:00+03:00`;
      const event = {
        summary: `\u062D\u062C\u0632 \u0637\u0628\u064A: ${booking.patientName} (${booking.bookingCode})`,
        description: `\u062E\u062F\u0645\u0629: ${booking.serviceName}
\u0645\u0631\u064A\u0636: ${booking.patientName}
\u0647\u0627\u062A\u0641: ${booking.patientPhone}
\u0641\u0631\u0639: ${booking.branchName}`,
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

// src/core/dynamic-slot-engine.ts
var DynamicSlotEngine = class {
  static sessions = /* @__PURE__ */ new Map();
  static getSessionsStore() {
    return this.sessions;
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
   * Helper to format dynamic branch departments list
   */
  static getBranchDepartmentsList(tenant) {
    return tenant.branches.map((b, i) => {
      const branchDoctors = tenant.doctors.filter((d) => d.branchId === b.id || d.branchName === b.name);
      const branchServices = tenant.services.filter(
        (s) => branchDoctors.some((d) => d.name === s.doctorName || !s.doctorName)
      );
      const branchDepts = Array.from(new Set(branchServices.map((s) => s.department).filter(Boolean)));
      const deptStr = branchDepts.length > 0 ? branchDepts.join(" \u060C ") : tenant.departments ? tenant.departments.join(" \u060C ") : "\u0639\u0627\u0645";
      return `${i + 1}. \u0641\u0631\u0639 ${b.name} \u0628\u064A\u0647 \u0642\u0633\u0645 (${deptStr})`;
    }).join("\n");
  }
  /**
   * Process incoming WhatsApp user message through Dynamic Slot Engine
   */
  static async processMessage(phone, messageText, tenant) {
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
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
        slots: {
          patientName: crmPatient?.patientName
        },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? "RETURNING" : "NEW",
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr
      };
      this.sessions.set(phone, newSession);
      const branchDeptStr = this.getBranchDepartmentsList(tenant);
      return `\u062A\u0645 \u062A\u0635\u0641\u064A\u0631 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0648\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0636\u0628\u0637 \u0628\u0646\u062C\u0627\u062D \u0639\u064A\u0646\u064A. \u{1F338}

\u0635\u0628\u0627\u062D \u0627\u0644\u0646\u0648\u0631 \u0648\u0627\u0644\u0633\u0631\u0648\u0631\u060C \u0646\u0648\u0631\u062A \u0639\u064A\u0627\u062F\u0629 ${tenant.clinicName}. \u062A\u062F\u0644\u0644\u060C \u0647\u0627\u064A \u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0623\u0642\u0633\u0627\u0645\u0647\u0627 \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0629 \u0639\u0646\u062F\u0646\u0627 \u0648\u0628\u0623\u064A \u0648\u0627\u062D\u062F \u062A\u062D\u0628 \u0646\u062D\u062C\u0632\u0644\u0643:

${branchDeptStr}

\u0634\u0648\u0641 \u0623\u0642\u0631\u0628 \u0641\u0631\u0639 \u0648\u064A\u0627 \u0642\u0633\u0645 \u062A\u062D\u062A\u0627\u062C \u0648\u062A\u062F\u0644\u0644 \u0639\u0644\u0645\u0648\u062F \u0623\u0646\u0637\u064A\u0643 \u0623\u0642\u0631\u0628 \u062D\u062C\u0632\u060C \u0634\u0646\u0648 \u0627\u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0644\u064A \u064A\u0646\u0627\u0633\u0628\u0643 \u062D\u062A\u0649 \u0646\u0643\u0645\u0644 \u0628\u0627\u0642\u064A \u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0648\u064A\u0627\u0643\u061F`;
    }
    let session = this.sessions.get(phone);
    if (!session) {
      const crmPatient = await GoogleSheetsService.lookupPatientCRM(phone);
      session = {
        phoneNumber: phone,
        tenantId: tenant.tenantId,
        currentState: "GREETING",
        status: "IN_PROGRESS",
        slots: {
          patientName: crmPatient?.patientName
        },
        patientName: crmPatient?.patientName,
        isReturningPatient: !!crmPatient,
        patientTag: crmPatient ? "RETURNING" : "NEW",
        failedNluAttempts: 0,
        lastInteractionTime: Date.now(),
        dailyMessageCount: 1,
        lastMessageDate: todayStr
      };
      this.sessions.set(phone, session);
    } else {
      if (session.lastMessageDate !== todayStr) {
        session.dailyMessageCount = 1;
        session.lastMessageDate = todayStr;
      } else {
        session.dailyMessageCount = (session.dailyMessageCount || 0) + 1;
      }
    }
    session.lastInteractionTime = Date.now();
    if ((session.dailyMessageCount || 0) > dailyLimit) {
      return `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u0648\u0635\u0644\u0646\u0627 \u0644\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0627\u0644\u0645\u0633\u0645\u0648\u062D \u0644\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u064A\u0648\u0645\u064A\u0629. \u062A\u0642\u062F\u0631 \u062A\u062A\u0648\u0627\u0635\u0644 \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u064A\u0629 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645: ${tenant.secretaryPhone} \u062E\u0644\u0627\u0644 \u0633\u0627\u0639\u0627\u062A \u0627\u0644\u062F\u0648\u0627\u0645 \u0627\u0644\u0631\u0633\u0645\u064A\u0629.`;
    }
    if (!session.slots) {
      session.slots = { patientName: session.patientName };
    }
    if (session.status === "COMPLETED_LOCKED") {
      const isNewBookingReq = /حجز جديد|موعد ثاني|تعديل|أغير/i.test(trimmedMsg);
      if (isNewBookingReq) {
        session.status = "IN_PROGRESS";
        session.slots = { patientName: session.patientName };
      } else {
        return await GeminiService.generatePoliteClosingResponse(trimmedMsg, tenant);
      }
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
      const isExplicitHuman = /أريد أحكي ويا سكرتير|حولني على إنسان|أريد سكرتير|سكرتير/i.test(processedText);
      if (isExplicitHuman) {
        await GoogleSheetsService.logComplaint({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          patientName: session.patientName || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645",
          phoneNumber: phone,
          complaintContent: processedText,
          status: "PENDING"
        });
        return HandoffManager.executeHandoff(session, tenant);
      }
      const nluResult = await GeminiService.analyzeAndExtractSlots(processedText, session.slots, tenant);
      const numMatch = processedText.match(/^(?:رقم\s*)?([1-9]\d*)$/);
      const inputIndex = numMatch ? parseInt(numMatch[1]) - 1 : -1;
      if (nluResult.extractedSlots) {
        if (nluResult.extractedSlots.branchName) session.slots.branchName = nluResult.extractedSlots.branchName;
        if (nluResult.extractedSlots.branchId) session.slots.branchId = nluResult.extractedSlots.branchId;
        if (nluResult.extractedSlots.department) session.slots.department = nluResult.extractedSlots.department;
        if (nluResult.extractedSlots.serviceName) session.slots.serviceName = nluResult.extractedSlots.serviceName;
        if (nluResult.extractedSlots.serviceId) session.slots.serviceId = nluResult.extractedSlots.serviceId;
        if (nluResult.extractedSlots.doctorName) session.slots.doctorName = nluResult.extractedSlots.doctorName;
        if (nluResult.extractedSlots.doctorId) session.slots.doctorId = nluResult.extractedSlots.doctorId;
        if (nluResult.extractedSlots.date) session.slots.date = nluResult.extractedSlots.date;
        if (nluResult.extractedSlots.startTime) session.slots.startTime = nluResult.extractedSlots.startTime;
        if (nluResult.extractedSlots.patientName && nluResult.extractedSlots.patientName.length > 2 && !/قسم|فرع|حجز|خدمة|موعد/i.test(nluResult.extractedSlots.patientName)) {
          session.slots.patientName = nluResult.extractedSlots.patientName;
          session.patientName = nluResult.extractedSlots.patientName;
        }
      }
      if (inputIndex >= 0) {
        if (!session.slots.branchName && inputIndex < tenant.branches.length) {
          session.slots.branchId = tenant.branches[inputIndex].id;
          session.slots.branchName = tenant.branches[inputIndex].name;
        } else if (!session.slots.serviceName) {
          const deptServices = session.slots.department ? tenant.services.filter((s) => s.department === session.slots.department) : tenant.services;
          const availServices = deptServices.length > 0 ? deptServices : tenant.services;
          if (inputIndex < availServices.length) {
            session.slots.serviceId = availServices[inputIndex].id;
            session.slots.serviceName = availServices[inputIndex].name;
          }
        }
      }
      if (nluResult.intent === "ASK_FAQ") {
        const faqAnswer = await GeminiService.answerFaq(processedText, tenant);
        const missingPrompt = this.getMissingSlotPrompt(session, tenant);
        return `${faqAnswer}

${missingPrompt}`;
      }
      if (!session.slots.branchName && session.slots.department) {
        const matchingBranches = tenant.branches.filter((b) => {
          const deptServices = tenant.services.filter((s) => s.department === session.slots.department);
          const deptDoctors = tenant.doctors.filter((d) => deptServices.some((s) => s.doctorName === d.name || !s.doctorName));
          return deptDoctors.some((d) => d.branchName === b.name || d.branchId === b.id);
        });
        if (matchingBranches.length === 1) {
          session.slots.branchId = matchingBranches[0].id;
          session.slots.branchName = matchingBranches[0].name;
        }
      }
      if (!session.slots.serviceName && session.slots.department) {
        const deptServices = tenant.services.filter((s) => s.department === session.slots.department);
        if (deptServices.length === 1) {
          session.slots.serviceId = deptServices[0].id;
          session.slots.serviceName = deptServices[0].name;
        }
      }
      if (!session.slots.doctorName) {
        const branchDocs = tenant.doctors.filter(
          (d) => (!session.slots?.branchId || d.branchId === session.slots.branchId || d.branchName === session.slots.branchName) && (!session.slots?.department || d.specialty?.includes(session.slots.department) || tenant.services.some((s) => s.department === session.slots.department && (s.doctorName === d.name || !s.doctorName)))
        );
        if (branchDocs.length === 1) {
          session.slots.doctorId = branchDocs[0].id;
          session.slots.doctorName = branchDocs[0].name;
        }
      }
      if (!session.slots.startTime && session.slots.doctorName) {
        const doctor = tenant.doctors.find((d) => d.id === session.slots?.doctorId || d.name === session.slots?.doctorName) || tenant.doctors[0];
        const service = tenant.services.find((s) => s.id === session.slots?.serviceId || s.name === session.slots?.serviceName);
        const tomorrowDate = SlotGenerator.getTomorrowDate();
        const slots = SlotGenerator.generateAvailableSlots(doctor, tomorrowDate, [], service?.durationMinutes || 30);
        if (slots.length > 0) {
          session.slots.date = slots[0].date;
          session.slots.startTime = slots[0].startTime;
          session.selectedSlot = slots[0];
        }
      }
      if (this.isAllSlotsFilled(session.slots)) {
        return await this.finalizeBooking(session, phone, tenant);
      }
      return this.getMissingSlotPrompt(session, tenant);
    } catch (error) {
      console.error("[DynamicSlotEngine Error]:", error);
      await GoogleSheetsService.logSystemError(`[DynamicEngine Error]: ${error.message || String(error)}`, phone, session?.patientName);
      return `\u0639\u0630\u0631\u0627\u064B \u0639\u064A\u0646\u064A\u060C \u062D\u0635\u0644 \u0627\u0646\u0642\u0637\u0627\u0639 \u0645\u0624\u0642\u062A \u0628\u0627\u0644\u062E\u062F\u0645\u0629. \u062A\u0642\u062F\u0631 \u062A\u062A\u0648\u0627\u0635\u0644 \u0648\u062A\u0643\u0645\u0644 \u062D\u062C\u0632\u0643 \u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u064A\u0629 \u0627\u0644\u0633\u0643\u0631\u062A\u0627\u0631\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0645\u0628\u0627\u0634\u0631: ${tenant.secretaryPhone || "07881015584"} \u062E\u0644\u0627\u0644 \u0633\u0627\u0639\u0627\u062A \u0627\u0644\u062F\u0648\u0627\u0645 \u0627\u0644\u0631\u0633\u0645\u064A\u0629.`;
    }
  }
  /**
   * Check if all mandatory booking slots are filled
   */
  static isAllSlotsFilled(slots) {
    return !!((slots.branchName || slots.branchId) && (slots.serviceName || slots.serviceId) && (slots.doctorName || slots.doctorId) && slots.startTime && slots.patientName);
  }
  /**
   * Prompt for the single next missing slot cleanly
   */
  static getMissingSlotPrompt(session, tenant) {
    const s = session.slots || {};
    if (!s.branchName && !s.department) {
      const branchDeptStr = this.getBranchDepartmentsList(tenant);
      return `\u0635\u0628\u0627\u062D \u0627\u0644\u0646\u0648\u0631 \u0648\u0627\u0644\u0633\u0631\u0648\u0631\u060C \u0646\u0648\u0631\u062A \u0639\u064A\u0627\u062F\u0629 ${tenant.clinicName}. \u062A\u062F\u0644\u0644\u060C \u0647\u0627\u064A \u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0623\u0642\u0633\u0627\u0645\u0647\u0627 \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0629 \u0639\u0646\u062F\u0646\u0627 \u0648\u0628\u0623\u064A \u0648\u0627\u062D\u062F \u062A\u062D\u0628 \u0646\u062D\u062C\u0632\u0644\u0643:

${branchDeptStr}

\u0634\u0648\u0641 \u0623\u0642\u0631\u0628 \u0641\u0631\u0639 \u0648\u064A\u0627 \u0642\u0633\u0645 \u062A\u062D\u062A\u0627\u062C \u0648\u062A\u062F\u0644\u0644 \u0639\u0644\u0645\u0648\u062F \u0623\u0646\u0637\u064A\u0643 \u0623\u0642\u0631\u0628 \u062D\u062C\u0632\u060C \u0634\u0646\u0648 \u0627\u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0644\u064A \u064A\u0646\u0627\u0633\u0628\u0643 \u062D\u062A\u0649 \u0646\u0643\u0645\u0644 \u0628\u0627\u0642\u064A \u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0648\u064A\u0627\u0643\u061F`;
    }
    if (!s.serviceName) {
      const deptServices = s.department ? tenant.services.filter((srv) => srv.department === s.department) : tenant.services;
      const availServices = deptServices.length > 0 ? deptServices : tenant.services;
      const servicesList = availServices.map((srv, i) => `${i + 1}. ${srv.name}${srv.price > 0 ? ` - ${srv.price} \u062F\u064A\u0646\u0627\u0631` : ""}`).join("\n\n");
      return `\u062A\u0641\u0636\u0644 \u0639\u064A\u0646\u064A\u060C \u0647\u0627\u064A \u062E\u064A\u0627\u0631\u0627\u062A \u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0639\u0646\u062F\u0646\u0627:

${servicesList}

(\u0648\u0646\u0631\u062C\u062D \u0644\u0643 \u0643\u0634\u0641\u064A\u0629 \u0648\u0627\u0633\u062A\u0634\u0627\u0631\u0629 \u0639\u0627\u0645\u0629 \u0643\u062E\u064A\u0627\u0631 \u0623\u0648\u0644 \u0644\u062A\u0634\u062E\u064A\u0635 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u062C \u0627\u0644\u062F\u0642\u064A\u0642). \u0634\u0646\u0648 \u0627\u0644\u062E\u062F\u0645\u0629 \u0627\u0644\u0644\u064A \u062A\u062D\u0628 \u062A\u062E\u062A\u0627\u0631\u0647\u0627\u061F`;
    }
    if (!s.doctorName) {
      const branchDocs = tenant.doctors.filter(
        (d) => !s.branchId || d.branchId === s.branchId || d.branchName === s.branchName
      );
      const targetDocs = branchDocs.length > 0 ? branchDocs : tenant.doctors;
      const docsList = targetDocs.map((d, i) => `${i + 1}. \u062F\u0643\u062A\u0648\u0631/\u062F\u0643\u062A\u0648\u0631\u0629 ${d.name} (${d.specialty})`).join("\n");
      return `\u062A\u0641\u0636\u0644 \u0639\u064A\u0646\u064A\u060C \u0627\u0644\u0623\u0637\u0628\u0627\u0621 \u0627\u0644\u0645\u062A\u0627\u062D\u0648\u0646 \u0641\u064A ${s.branchName || "\u0627\u0644\u0641\u0631\u0639"}:

${docsList}

\u0623\u064A\u0647\u0645 \u062A\u0641\u0636\u0644 \u062A\u062D\u062C\u0632 \u0639\u0646\u062F\u0647\u061F`;
    }
    if (!s.startTime) {
      const doctor = tenant.doctors.find((d) => d.id === s.doctorId || d.name === s.doctorName) || tenant.doctors[0];
      const hoursStr = this.formatWorkingHours(doctor.workingHours.startHour, doctor.workingHours.endHour);
      return `\u0639\u064A\u0646\u064A \u062F\u0643\u062A\u0648\u0631/\u062F\u0643\u062A\u0648\u0631\u0629 ${doctor.name} \u0645\u062A\u0648\u0641\u0631 \u0641\u064A ${doctor.branchName} \u062E\u0644\u0627\u0644 \u0623\u0648\u0642\u0627\u062A \u0627\u0644\u062F\u0648\u0627\u0645 \u0627\u0644\u0631\u0633\u0645\u064A\u0629 (${hoursStr}). 

\u0634\u0646\u0648 \u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0645\u0646\u0627\u0633\u0628 \u0644\u0643 \u063A\u062F\u0627\u064B \u062D\u062A\u0649 \u0623\u062B\u0628\u062A\u0647 \u0644\u0643\u061F`;
    }
    if (!s.patientName) {
      return `\u062A\u062F\u0644\u0644 \u0639\u064A\u0646\u064A! \u0628\u0642\u0649 \u0628\u0633 \u062A\u0632\u0648\u062F\u0646\u0627 \u0628\u0640 \u0627\u0633\u0645\u0643 \u0627\u0644\u0645\u062D\u062A\u0631\u0645 \u062D\u062A\u0649 \u0646\u062B\u0628\u062A \u0627\u0644\u062D\u062C\u0632 \u0648\u0646\u0635\u062F\u0631 \u0644\u0643 \u0643\u0627\u0631\u062A \u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0631\u0633\u0645\u064A! \u{1F338}`;
    }
    return `\u062A\u0641\u0636\u0644 \u0639\u064A\u0646\u064A\u060C \u0643\u0644\u064A\u0644\u064A \u0634\u0646\u0648 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0644\u064A \u062A\u062D\u0628 \u0646\u0648\u0636\u062D\u0647\u0627 \u0644\u0643\u061F`;
  }
  /**
   * Finalize Booking: Create Record, Sync Calendar, Save Sheet CRM, Issue Digital Receipt Card & Lock Session
   */
  static async finalizeBooking(session, phone, tenant) {
    session.bookingCode = `BK-${Math.floor(1e3 + Math.random() * 9e3)}`;
    const s = session.slots || {};
    const branch = tenant.branches.find((b) => b.id === s.branchId || b.name === s.branchName) || tenant.branches[0];
    const doctor = tenant.doctors.find((d) => d.id === s.doctorId || d.name === s.doctorName) || tenant.doctors[0];
    const service = tenant.services.find((srv) => srv.id === s.serviceId || srv.name === s.serviceName) || tenant.services[0];
    const defaultStartH = doctor.workingHours?.startHour || 9;
    const defaultStartTime = s.startTime || `${defaultStartH.toString().padStart(2, "0")}:00`;
    const effectiveDuration = Math.ceil((service.durationMinutes || 30) * 1.2);
    const [startH, startMin] = defaultStartTime.split(":").map(Number);
    const totalEndMin = startH * 60 + (startMin || 0) + effectiveDuration;
    const computedEndH = Math.floor(totalEndMin / 60).toString().padStart(2, "0");
    const computedEndM = (totalEndMin % 60).toString().padStart(2, "0");
    const computedEndTime = `${computedEndH}:${computedEndM}`;
    const bookingDate = s.date || SlotGenerator.getTomorrowDate();
    const booking = {
      bookingCode: session.bookingCode,
      tenantId: tenant.tenantId,
      patientPhone: phone,
      patientName: s.patientName || session.patientName || "\u0645\u0631\u0627\u062C\u0639 \u0643\u0631\u064A\u0645",
      patientTag: session.isReturningPatient ? "RETURNING" : "NEW",
      branchId: branch.id,
      branchName: branch.name,
      doctorId: doctor.id,
      doctorName: doctor.name,
      serviceId: service.id,
      serviceName: service.name,
      department: s.department || "\u0639\u0627\u0645",
      date: bookingDate,
      startTime: defaultStartTime,
      endTime: computedEndTime,
      durationMinutes: effectiveDuration,
      status: "CONFIRMED",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await GoogleCalendarService.syncAppointment(booking, doctor);
    await GoogleSheetsService.saveBooking(booking);
    await GoogleSheetsService.savePatientCRM({
      phoneNumber: phone,
      patientName: booking.patientName,
      platform: "WhatsApp",
      totalBookings: 1,
      lastVisitDate: booking.date
    });
    await GoogleSheetsService.logAnalytics("BOOKING_CONFIRMED", `Booking: ${booking.bookingCode}, Patient: ${booking.patientName}, Doctor: ${booking.doctorName}`);
    session.status = "COMPLETED_LOCKED";
    return `\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u062D\u062C\u0632\u0643 \u0628\u0646\u062C\u0627\u062D \u0648\u0628\u0634\u0643\u0644 \u0646\u0647\u0627\u0626\u064A \u0639\u064A\u0646\u064A! \u2705

\u{1F4CB} \u062A\u0641\u0627\u0635\u064A\u0644 \u0645\u0648\u0639\u062F\u0643:
- \u0627\u0644\u0627\u0633\u0645: ${booking.patientName}
- \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641: ${phone}
- \u0627\u0644\u0641\u0631\u0639: ${branch.name}
- \u0627\u0644\u0637\u0628\u064A\u0628: ${doctor.name}
- \u0627\u0644\u062E\u062F\u0645\u0629: ${service.name}
- \u0627\u0644\u0645\u0648\u0639\u062F: \u063A\u062F\u0627\u064B ${booking.date} \u0627\u0644\u0633\u0627\u0639\u0629 ${defaultStartTime}
- \u0643\u0648\u062F \u0627\u0644\u062D\u062C\u0632: ${booking.bookingCode}

\u{1F4CD} \u0631\u0627\u0628\u0637 \u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0639\u064A\u0627\u062F\u0629 \u0627\u0644\u062C\u063A\u0631\u0627\u0641\u064A:
${branch.locationLink || "\u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u0631\u0626\u064A\u0633\u064A"}

\u26A0\uFE0F \u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0647\u0627\u0645\u0629 \u0642\u0628\u0644 \u0627\u0644\u062D\u0636\u0648\u0631: ${service.preAppointmentInstructions || "\u064A\u0631\u062C\u0649 \u0627\u0644\u062D\u0636\u0648\u0631 \u0642\u0628\u0644 \u0627\u0644\u0645\u0648\u0639\u062F \u0628\u0640 15 \u062F\u0642\u064A\u0642\u0629 \u0645\u0635\u062D\u0648\u0628\u0627\u064B \u0628\u0627\u0644\u0647\u0648\u064A\u0629 \u0627\u0644\u0634\u062E\u0635\u064A\u0629."}

\u0646\u0646\u062A\u0638\u0631\u0643 \u062A\u0646\u0648\u0631\u0646\u0627 \u0628\u0640 \u0627\u0644\u0639\u064A\u0627\u062F\u0629! \u{1F338}`;
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
      if (message && message.type === "text") {
        const messageId = message.id;
        const fromPhone = message.from;
        const rawText = message.text.body || "";
        const messageText = rawText.length > 1e3 ? rawText.substring(0, 1e3) : rawText;
        if (processedMessageIds.has(messageId)) {
          console.log(`[Webhook Deduplication] Ignored duplicate message ID: ${messageId}`);
          return;
        }
        processedMessageIds.add(messageId);
        enqueueMessageForProcessing(fromPhone, messageText);
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
  const DEBOUNCE_TIME_MS = 5e3;
  const existingBuffer = userBuffers.get(fromPhone);
  if (existingBuffer) {
    clearTimeout(existingBuffer.timer);
    existingBuffer.messages.push(messageText);
    existingBuffer.timer = setTimeout(async () => {
      const messagesToProcess = [...existingBuffer.messages];
      userBuffers.delete(fromPhone);
      await processAggregatedUserMessages(fromPhone, messagesToProcess);
    }, DEBOUNCE_TIME_MS);
    console.log(`[Debounce Buffer] Appended message from ${fromPhone}. Buffer size: ${existingBuffer.messages.length}`);
  } else {
    const newBuffer = {
      messages: [messageText],
      timer: setTimeout(async () => {
        const messagesToProcess = [...newBuffer.messages];
        userBuffers.delete(fromPhone);
        await processAggregatedUserMessages(fromPhone, messagesToProcess);
      }, DEBOUNCE_TIME_MS)
    };
    userBuffers.set(fromPhone, newBuffer);
    console.log(`[Debounce Buffer] Started 2.5s timer for ${fromPhone}`);
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
  /**
   * Main execution check for sending 4-hour pre-appointment reminders
   */
  static async checkAndSendReminders() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const tenant = await GoogleSheetsService.getTenantConfig();
      const rows = await GoogleSheetsService.fetchSheetValues("Bookings!A1:Z500");
      if (!rows || rows.length < 2) {
        this.isRunning = false;
        return;
      }
      const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
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
            await GoogleSheetsService.updateReminderStatus(bookingCode, "SENT");
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
    WatchdogService.registerSendCallback(async (phone, text) => {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      if (phoneId && token) {
        await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } })
        });
      }
    });
    WatchdogService.startMonitoring(DynamicSlotEngine.getSessionsStore(), tenant);
    console.log("[Watchdog Service] Started session monitor worker with Live WhatsApp Dispatcher.");
    ReminderJob.startScheduler();
    console.log("[Reminder Service] Started 4-hour pre-appointment background scheduler worker.");
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
