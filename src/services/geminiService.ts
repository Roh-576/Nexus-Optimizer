import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface NodeMetrics {
  id: string;
  cpu: number;
  latency: number;
  load: number;
  energy: number;
  status: string;
}

export interface OptimizationPlan {
  recommendation: string;
  actions: { nodeId: string; action: string; reason: string }[];
  efficiencyGain: number;
  explanation: string;
}

export async function getOptimizationPlan(nodes: NodeMetrics[], globalWorkload: number): Promise<OptimizationPlan> {
  const prompt = `
    Analyze the following system metrics for a distributed network and provide an optimization plan.
    Current Global Workload Multiplier: ${globalWorkload}%
    
    Nodes:
    ${nodes.map(n => `- ${n.id}: CPU ${n.cpu}%, Load ${n.load}%, Latency ${n.latency}ms, Energy ${n.energy}W, Status: ${n.status}`).join("\n")}
    
    Goal: Reduce energy consumption and latency while keeping CPU usage below 80% on all active nodes.
    Suggest which nodes to scale up, scale down, or shift load from.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendation: { type: Type.STRING },
            actions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  nodeId: { type: Type.STRING },
                  action: { type: Type.STRING },
                  reason: { type: Type.STRING }
                },
                required: ["nodeId", "action", "reason"]
              }
            },
            efficiencyGain: { type: Type.NUMBER, description: "Estimated percentage improvement" },
            explanation: { type: Type.STRING }
          },
          required: ["recommendation", "actions", "efficiencyGain", "explanation"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Optimization Error:", error);
    return {
      recommendation: "Maintain current state.",
      actions: [],
      efficiencyGain: 0,
      explanation: "Unable to generate plan at this time."
    };
  }
}
