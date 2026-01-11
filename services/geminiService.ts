
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
      As a member of the corporate CTO team, audit the following action plans for the plant "${plant}" regarding the chronic issue "${issue}".
      Today's reference date is ${currentDate}.
      
      Actions Data:
      ${JSON.stringify(actions, null, 2)}
      
      Analyze based on:
      1. Quality: Concrete Action vs Bullshit.
      2. Remote Trackability: Can CTO team monitor from HQ?
      3. Strategic Category: Capex/Opex/Maintenance ROI.
      4. YTD Review: Overdue vs On-Track.
      5. CEO Alignment: Provide a "CEO Talking Point" for each action—how the plant CEO should view this item.
      6. Red Flag: Identify if this issue represents a systemic risk that needs upper management visibility.
      
      Return a JSON audit with:
      - overallScore (0-100)
      - executiveVerdict (CTO tone)
      - ceoBrief (A 3-sentence summary for the local Plant CEO)
      - redFlags (Array of strings identifying systemic risks)
      - audits (Array of individual action audits)
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallScore: { type: Type.NUMBER },
          executiveVerdict: { type: Type.STRING },
          ceoBrief: { type: Type.STRING },
          redFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
          audits: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                actionTitle: { type: Type.STRING },
                qualityRating: { type: Type.STRING },
                trackability: { type: Type.STRING },
                impactCategory: { type: Type.STRING },
                ytdStatus: { type: Type.STRING },
                recommendation: { type: Type.STRING },
                justification: { type: Type.STRING },
                ceoTalkingPoint: { type: Type.STRING },
                riskLevel: { type: Type.STRING, description: "Low, Medium, High" }
              }
            }
          }
        },
        required: ["overallScore", "executiveVerdict", "ceoBrief", "redFlags", "audits"]
      }
    }
  });
  return JSON.parse(response.text || '{}');
};
