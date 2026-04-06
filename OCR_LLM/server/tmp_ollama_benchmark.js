const { Ollama } = require("ollama");

async function benchmarkModel(model, prompt) {
  const client = new Ollama({
    host: process.env.OLLAMA_BASE_PATH || "http://127.0.0.1:11434",
  });
  const startedAt = Date.now();
  const stream = await client.chat({
    model,
    stream: true,
    messages: [{ role: "user", content: prompt }],
    options: { temperature: 0.2, num_predict: 128 },
  });

  let firstChunkAt = null;
  let firstVisibleTokenAt = null;
  let reasoningChars = 0;
  let answerChars = 0;

  for await (const chunk of stream) {
    if (!firstChunkAt) firstChunkAt = Date.now();
    const thinking = chunk?.message?.thinking || "";
    const content = chunk?.message?.content || "";
    if (thinking) reasoningChars += thinking.length;
    if (content) {
      answerChars += content.length;
      if (!firstVisibleTokenAt) firstVisibleTokenAt = Date.now();
    }
    if (chunk?.done) break;
  }

  const finishedAt = Date.now();
  return {
    model,
    ttfcMs: firstChunkAt ? firstChunkAt - startedAt : null,
    ttfAnswerMs: firstVisibleTokenAt ? firstVisibleTokenAt - startedAt : null,
    totalMs: finishedAt - startedAt,
    reasoningChars,
    answerChars,
  };
}

async function main() {
  const prompt = process.argv.slice(2).join(" ") || "xin chao";
  const models = ["qwen3:8b", "qwen3:4b"];
  const out = [];
  for (const model of models) {
    try {
      const row = await benchmarkModel(model, prompt);
      out.push({ ...row, error: null });
    } catch (error) {
      out.push({
        model,
        ttfcMs: null,
        ttfAnswerMs: null,
        totalMs: null,
        reasoningChars: null,
        answerChars: null,
        error: error.message,
      });
    }
  }
  console.log(JSON.stringify({ prompt, results: out }, null, 2));
}

main();
