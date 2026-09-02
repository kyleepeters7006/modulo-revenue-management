// Transcribes the narration track so the edit can be cut to the voice.
import fs from "node:fs";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

const input = process.argv[2];
const output = process.argv[3] || "/tmp/narration-words.json";

const attempts = [
  ["gpt-4o-transcribe", "verbose_json"],
  ["gpt-4o-transcribe", "json"],
  ["gpt-4o-mini-transcribe", "json"],
];

for (const [model, fmt] of attempts) {
  try {
    const opts = { file: fs.createReadStream(input), model, response_format: fmt };
    if (fmt === "verbose_json") opts.timestamp_granularities = ["word", "segment"];
    const res = await client.audio.transcriptions.create(opts);
    console.log("SUCCESS", model, fmt);
    console.log("TEXT:", res.text);
    if (res.words) {
      console.log("WORDS:");
      for (const w of res.words) console.log(w.start.toFixed(2), w.end.toFixed(2), w.word);
    }
    if (res.segments) {
      console.log("SEGMENTS:");
      for (const s of res.segments) console.log(s.start.toFixed(2), s.end.toFixed(2), s.text);
    }
    fs.writeFileSync(output, JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (e) {
    console.log("FAIL", model, fmt, String(e.message).slice(0, 140));
  }
}
process.exit(1);
