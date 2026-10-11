// Mock OpenAI-compatible + Anthropic streaming server for local testing.
// Usage: npm run mock  (or node mock/mock-server.mjs [port])  ->  在设置中把 Base URL 设为 http://127.0.0.1:8787/v1
import http from 'node:http';

const port = Number(process.argv[2] || process.env.PORT || 8787);
const requests = [];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

function answerFor(messages) {
  const last = messages[messages.length - 1]?.content ?? '';
  const quote = /> (.+)/.exec(last)?.[1];
  if (quote) {
    return `## 关于「${quote}」\n\n这是针对**${quote}**的分支解释（模拟回答）。上下文中共有 ${messages.length} 条消息。\n\n- 要点一：${quote} 的定义\n- 要点二：${quote} 的应用\n\n\`\`\`python\nprint("${quote}")\n\`\`\``;
  }
  return `# 注意力机制简介\n\n**注意力机制**（Attention）让模型在处理序列时动态关注最相关的部分。核心公式是缩放点积注意力：\n\n\`\`\`python\ndef attention(Q, K, V):\n    return softmax(Q @ K.T / sqrt(d)) @ V\n\`\`\`\n\n关键概念包括 **查询向量**、**键向量** 和 **值向量**，以及 *多头注意力*。你的问题是：「${last.slice(0, 40)}」。`;
}

function chunks(text) {
  return text.match(/[\s\S]{1,4}/g) ?? [];
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (req.method === 'GET' && req.url === '/requests') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify(requests));
  }
  let body = '';
  for await (const c of req) body += c;
  let json = {};
  try { json = JSON.parse(body || '{}'); } catch {}
  requests.push({ url: req.url, headers: req.headers, body: json });

  const isAnthropic = req.url.endsWith('/messages');
  if (!req.url.endsWith('/chat/completions') && !isAnthropic) return res.writeHead(404, cors).end('not found');
  const msgs = (json.messages || []).filter((m) => m.role !== 'system');
  const text = answerFor(msgs);
  res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  if (isAnthropic) res.write(`event: message_start\ndata: {"type":"message_start"}\n\n`);
  for (const c of chunks(text)) {
    if (isAnthropic) {
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`);
    }
    await new Promise((r) => setTimeout(r, 8));
  }
  if (isAnthropic) res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
  else res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(port, '0.0.0.0', () => console.log(`Mock LLM server: http://127.0.0.1:${port}/v1`));
