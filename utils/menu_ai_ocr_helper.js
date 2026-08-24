const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const AiConfigRepository = require('../repositories/ai_config_repository');

/**
 * Determine supported MIME type for Gemini Multimodal input
 */
function getSupportedMimeType(filePath, originalMime = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || originalMime.includes('jpeg')) return 'image/jpeg';
  if (ext === '.png' || originalMime.includes('png')) return 'image/png';
  if (ext === '.webp' || originalMime.includes('webp')) return 'image/webp';
  if (ext === '.pdf' || originalMime.includes('pdf')) return 'application/pdf';
  return originalMime || 'image/jpeg';
}

/**
 * Clean & parse JSON output from Gemini AI response
 */
function cleanAndParseJSON(rawText) {
  if (!rawText) return [];
  try {
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }
    return JSON.parse(cleanText);
  } catch (err) {
    console.warn('[Gemini AI] Initial JSON parse failed, attempting regex extraction:', err.message);
    const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (rErr) {
        console.error('[Gemini AI] Regex JSON parse failed:', rErr.message);
      }
    }
    return [];
  }
}

/**
 * Main Gemini 2.5 Flash Multimodal Menu Import Function
 * Uses Google AI Studio Gemini 2.5 Flash API to analyze image/PDF menu files
 */
async function processMenuFileForAIImport(filePath, mimeType = '') {
  const aiConfig = await AiConfigRepository.getConfig();

  if (!aiConfig.is_enabled) {
    throw new Error('AI Menu Import service is currently disabled by Super Admin.');
  }

  const apiKey = aiConfig.api_key;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Google AI Studio Gemini API key is not configured. Please configure Gemini API Key in Super Admin Panel.');
  }

  const modelName = aiConfig.model_name || 'gemini-flash-latest';
  const genAI = new GoogleGenerativeAI(apiKey);
  const fileBuffer = fs.readFileSync(filePath);
  const resolvedMime = getSupportedMimeType(filePath, mimeType);

  const filePart = {
    inlineData: {
      data: fileBuffer.toString('base64'),
      mimeType: resolvedMime
    }
  };

  const systemInstruction = `
    You are an expert AI restaurant menu parsing engine.
    Analyze the provided restaurant menu image or PDF document and extract all categories and menu items.
    Return ONLY a valid JSON array of objects. Do not include markdown headers or commentary outside the JSON.
    Each object in the array MUST have the following keys:
    - "category": String (The section or category heading, e.g. "Starters", "Main Course", "Beverages", "Desserts", "Breads", "Biryani"). If unclear, default to "General".
    - "name": String (The exact dish or item name).
    - "price": Number (Numeric price in Rs., e.g. 250, 45, 180. Strip currency symbols like ₹, Rs, /-).
    - "description": String (Ingredients or description if listed on the menu, otherwise "").
    - "is_veg": Number (1 for Vegetarian, 0 for Non-Vegetarian. Detect based on green/red dot, symbols, or keywords like Chicken, Mutton, Fish, Egg, Paneer, Mushroom, etc.).
    - "spicy_level": Number (0 for Mild/Normal, 1 for Medium, 2 for Spicy, 3 for Extra Spicy).
    - "gst_rate": Number (Default 5).
    - "is_available": Number (Default 1).

    Return JSON matching this format:
    [
      {
        "category": "Starters",
        "name": "Paneer Tikka",
        "price": 240,
        "description": "Grilled cottage cheese with spices",
        "is_veg": 1,
        "spicy_level": 1,
        "gst_rate": 5,
        "is_available": 1
      }
    ]
  `;

  const candidateModels = [
    modelName,
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite'
  ].filter((v, i, a) => a.indexOf(v) === i && v);

  let responseText = null;
  let lastError = null;

  for (const modelToTry of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelToTry,
        systemInstruction: systemInstruction
      });

      const response = await model.generateContent([
        filePart,
        'Extract all categories and menu items from this menu card and return JSON array.'
      ]);

      responseText = response.response.text();
      if (responseText) {
        console.log(`[Gemini AI] ✅ Parsed menu using model "${modelToTry}"`);
        break;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini AI] Model "${modelToTry}" failed, trying fallback model:`, err.message);
    }
  }

  if (!responseText) {
    throw new Error(`Gemini AI Menu Extraction Failed: ${lastError ? lastError.message : 'No response'}`);
  }

  const items = cleanAndParseJSON(responseText);

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Gemini AI could not detect menu items in the uploaded file.');
  }

  return items.map(item => ({
    category: String(item.category || 'General').trim().slice(0, 250),
    name: String(item.name || '').trim().slice(0, 250),
    price: isNaN(parseFloat(item.price)) ? 0 : parseFloat(item.price),
    description: String(item.description || '').trim().slice(0, 2000),
    is_veg: parseInt(item.is_veg !== undefined ? item.is_veg : 1),
    spicy_level: parseInt(item.spicy_level || 0),
    gst_rate: parseFloat(item.gst_rate || 5),
    is_available: parseInt(item.is_available !== undefined ? item.is_available : 1)
  })).filter(item => item.name.length > 0 && item.price >= 0);
}

/**
 * Test Gemini API Key Connection (Super Admin Connection Test)
 */
async function testGeminiApiKeyConnection(testApiKey) {
  let keyToUse = testApiKey;
  if (!keyToUse || keyToUse.trim() === '' || keyToUse.includes('••••')) {
    const activeConfig = await AiConfigRepository.getConfig();
    keyToUse = activeConfig.api_key;
  }

  if (!keyToUse || keyToUse.trim() === '') {
    throw new Error('Please enter a valid Gemini API Key to test.');
  }

  const genAI = new GoogleGenerativeAI(keyToUse.trim());
  const activeConfig = await AiConfigRepository.getConfig();

  const candidateModels = [
    activeConfig.model_name,
    'gemini-flash-latest',
    'gemini-2.0-flash',
    'gemini-flash-lite-latest',
    'gemini-pro-latest'
  ].filter((v, i, a) => a.indexOf(v) === i && v);

  let lastError = null;
  for (const modelToTry of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelToTry });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Ping. Respond with OK.' }] }],
        generationConfig: { maxOutputTokens: 10 }
      });
      const text = result.response.text();
      return { success: true, message: `Connected successfully to Google AI Studio (${modelToTry})! Response: ${text.trim()}` };
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini Connection Test] Model "${modelToTry}" failed:`, err.message);
    }
  }

  throw new Error(`Connection Test Failed: ${lastError ? lastError.message : 'Unable to connect to Google AI Studio.'}`);
}

module.exports = {
  processMenuFileForAIImport,
  testGeminiApiKeyConnection
};
