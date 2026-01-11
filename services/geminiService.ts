
import { GoogleGenAI, Type } from "@google/genai";
import { DashboardData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const analyzeData = async (jsonSnippet: string, fileName: string): Promise<DashboardData> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      Analyze the following industrial operational data from "${fileName}" and generate a professional dashboard JSON.
      The data includes fields like Plant Name, Chronic Issue, Failures Description, Action Plan, Class, Duration Loss, Frequency, Category, Progress, Completion, Start Time, and End Time.
      
      Data snippet:
      ${jsonSnippet}
      
      Instructions:
      1. Provide a high-level industrial executive summary focusing on key bottlenecks, major downtime causes (Duration Loss), and resolution progress.
      2. Identify 4 KPIs: Total Duration Loss (sum), Mean Time Between Failures (if possible), Average Progress, and Most Frequent Failure Category.
      3. Propose 4 visualization charts:
         - A chart for Duration Loss per Plant or Category.
         - A chart for Failure Frequency.
         - A progress or completion status breakdown.
         - A distribution of failures by Class or Category.
      4. Ensure all chart configurations (xAxis, yAxis) use the standardized keys provided.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          metrics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                value: { type: Type.STRING },
                change: { type: Type.STRING },
                isPositive: { type: Type.BOOLEAN }
              },
              required: ["label", "value"]
            }
          },
          charts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING, description: "One of: bar, line, pie, area" },
                title: { type: Type.STRING },
                xAxis: { type: Type.STRING },
                yAxis: { type: Type.STRING }
              },
              required: ["id", "type", "title", "xAxis", "yAxis"]
            }
          }
        },
        required: ["summary", "metrics", "charts"]
      }
    }
  });

  const parsedResponse = JSON.parse(response.text || '{}');
  return parsedResponse;
};

export const auditActionPlan = async (plant: string, issue: string, actions: any[]) => {
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      As a member of the corporate CTO team, perform a granular audit of the operational performance for "${plant}".
      
      STRICT RULES:
      1. DO NOT include any conversational text, introductory remarks, or concluding remarks in the JSON fields.
      2. EACH field must contain ONLY its specific data point. 
      3. DO NOT concatenate status descriptions with the verdict in the "recommendation" or "ctoChallengeQuery" fields.
      4. You must analyze EVERY individual action plan entry provided below.
      
      Audit Mapping requirements:
      - "actionTitle": Must be the Chronic Issue.
      - "ctoChallengeQuery": Must be ONLY the pointed question for the manager.
      - "strategicAnchor": Must be ONLY the name of the technical artifact/proof.
      - "worthTracking": Must be ONLY "High Priority" or "Routine".
      
      Actions Data:
      ${JSON.stringify(actions, null, 2)}
      
      Current Reference Date: ${currentDate}
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallScore: { type: Type.NUMBER },
          executiveVerdict: { type: Type.STRING },
          ceoBrief: { type: Type.STRING },
          audits: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                actionTitle: { type: Type.STRING },
                sourceActionPlan: { type: Type.STRING },
                qualityRating: { type: Type.STRING },
                trackability: { type: Type.STRING },
                impactCategory: { type: Type.STRING },
                ytdStatus: { type: Type.STRING },
                recommendation: { type: Type.STRING },
                justification: { type: Type.STRING },
                ceoTalkingPoint: { type: Type.STRING },
                riskLevel: { type: Type.STRING },
                ctoChallengeQuery: { type: Type.STRING, description: "ONLY the question, no prefixes." },
                strategicAnchor: { type: Type.STRING, description: "ONLY the artifact name." },
                worthTracking: { type: Type.STRING, description: "High Priority / Routine only." }
              }
            }
          }
        },
        required: ["overallScore", "executiveVerdict", "ceoBrief", "audits"]
      }
    }
  });
  
  // Robust parsing to handle potential markdown code blocks in raw response
  const rawText = response.text || '{}';
  const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleanJson);
};
