import { config } from 'dotenv';
import readline from 'readline/promises';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
config();
let tools = [];
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const mcpClient = new Client({
    name: "example-client",
    version: "1.0.0",
});
const chatHistory = [];
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
mcpClient.connect(new SSEClientTransport(new URL("http://localhost:3001/sse")))
    .then(async () => {
        console.log("Connected to mcp server");
        tools = (await mcpClient.listTools()).tools.map(tool => {
            return {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: tool.inputSchema.type,
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required
                }
            };
        });
        chatLoop();
    });
async function chatLoop(toolCall) {
    if (toolCall) {
        console.log("Calling tool:", toolCall.name);
        const toolResult = await mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.args
        });
        chatHistory.push({
            role: "function",
            parts: [{
                functionResponse: {
                    name: toolCall.name,
                    response: toolResult
                }
            }]
        });
    } else {
        const question = await rl.question('You: ');
        chatHistory.push({
            role: "user",
            parts: [{ text: question }]
        });
    }
    const model = ai.getGenerativeModel({
        model: "gemini-2.0-flash",
    });
    const result = await model.generateContent({
        contents: chatHistory,
        tools: [{ functionDeclarations: tools }],
    });
    const response = result.response;
    if (!response.candidates || !response.candidates[0].content || !response.candidates[0].content.parts[0]) {
        console.log("Agent: The response was blocked or empty.");
        return chatLoop();
    }
    const responsePart = response.candidates[0].content.parts[0];
    if (responsePart.functionCall) {
        chatHistory.push({
            role: "model",
            parts: [{
                functionCall: responsePart.functionCall
            }]
        });
        return chatLoop(responsePart.functionCall);
    }
    else if (responsePart.text) {
        console.log(`Agent: ${responsePart.text}`);
        chatHistory.push({
            role: "model",
            parts: [{ text: responsePart.text }]
        });
    }
    chatLoop();
}