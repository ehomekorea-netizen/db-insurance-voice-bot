const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Load environment variables manually from .env and .env.local files if present
const loadEnv = (fileName) => {
  const envPath = path.join(__dirname, '..', fileName);
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = val;
      }
    });
  }
};
loadEnv('.env');
loadEnv('.env.local');

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: OPENAI_API_KEY is not defined. Skipping audio generation.");
  process.exit(0); // Exit cleanly to prevent local builds without keys from failing
}

const openai = new OpenAI({ apiKey });

const prompts = [
  { file: 'welcome.mp3', text: "PA님 무엇을 도와드릴까요?" },
  { file: 'searching.mp3', text: "잠시만 기다려주시면 곧 안내드리겠습니다." },
  { file: 'after_response.mp3', text: "화면내용을 참고해주시고, 도움이 필요하시면 또 말씀해주세요." }
];

async function generate() {
  const publicAudioDir = path.join(__dirname, '../public/audio');
  if (!fs.existsSync(publicAudioDir)) {
    fs.mkdirSync(publicAudioDir, { recursive: true });
    console.log(`Created directory: ${publicAudioDir}`);
  }

  for (const item of prompts) {
    const targetPath = path.join(publicAudioDir, item.file);
    
    // Always force regenerate on clean build or if file missing
    if (fs.existsSync(targetPath)) {
      console.log(`File already exists: ${item.file}. Skipping generation.`);
      continue;
    }

    console.log(`Generating: "${item.text}" -> ${item.file}`);
    try {
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: item.text,
        response_format: "mp3",
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      fs.writeFileSync(targetPath, buffer);
      console.log(`Saved: ${targetPath}`);
    } catch (err) {
      console.error(`Failed to generate ${item.file}:`, err);
    }
  }
  console.log("Audio generation process completed.");
}

generate();
