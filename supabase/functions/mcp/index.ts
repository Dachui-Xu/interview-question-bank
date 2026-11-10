import { McpServer } from "npm:@modelcontextprotocol/sdk@1.26.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.26.0/server/webStandardStreamableHttp.js";
import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { z } from "npm:zod@3.25.76";
import { normalizeQuestion } from "../_shared/question.mjs";

const encoder = new TextEncoder();
const category = z.enum(["written", "interview"]);
const recruitment = z.enum(["campus", "experienced", "unspecified"]);
const question = z.object({
  category,
  recruitment: recruitment.optional(),
  topic: z.string().max(160).optional(),
  prompt: z.string().max(12000),
  answer: z.string().max(24000).optional(),
  company: z.string().max(120).optional(),
  source: z.string().max(2048).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(12000).optional(),
});

async function tokensMatch(sent: string, expected: string) {
  const digests = await Promise.all([sent, expected].map(
    value => crypto.subtle.digest("SHA-256", encoder.encode(value)),
  ));
  const [left, right] = digests.map(digest => new Uint8Array(digest));
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function reply(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function failure(message: string) {
  return { ...reply({ error: message }), isError: true };
}

Deno.serve(async (request: Request) => {
  if (request.headers.has("origin")) return new Response("Forbidden", { status: 403 });

  const token = Deno.env.get("QUESTION_BANK_MCP_TOKEN");
  const owner = Deno.env.get("QUESTION_BANK_OWNER_ID");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || token.length < 32 || !owner || !url || !serviceKey) {
    return new Response("MCP is not configured", { status: 503 });
  }
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!supplied || supplied.length > 512 || !await tokensMatch(supplied, token)) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const server = new McpServer({ name: "interview-question-bank", version: "1.0.0" });
  const questions = () => db.from("questions").select("id, content, mastery, version").eq("owner_id", owner);

  server.registerTool("list_questions", {
    description: "查询正式题库。可以按公司、知识点、类别、主题、招聘类型和掌握状态筛选。返回题目摘要和分页位置，读取完整答案请使用 get_question。",
    inputSchema: {
      company: z.string().max(120).optional(),
      tag: z.string().max(40).optional(),
      topic: z.string().max(160).optional(),
      category: category.optional(),
      recruitment: recruitment.optional(),
      mastery: z.enum(["known", "unsure", "unknown", "unrated"]).optional(),
      offset: z.number().int().nonnegative().max(1000000).default(0),
    },
    annotations: { readOnlyHint: true },
  }, async ({ company, tag, topic, category, recruitment, mastery, offset }) => {
    let query = questions();
    if (company) query = query.eq("content->>company", company);
    if (topic) query = query.eq("content->>topic", topic);
    if (tag) query = query.contains("content", { tags: [tag] });
    if (category) query = query.eq("content->>category", category);
    if (recruitment) query = query.eq("content->>recruitment", recruitment);
    if (mastery) query = mastery === "unrated" ? query.is("mastery", null) : query.eq("mastery", mastery);

    const limit = 25;
    const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(offset, offset + limit);
    if (error) return failure("暂时无法查询题库");
    return reply({
      questions: data.slice(0, limit).map(({ id, content, mastery, version }) => ({
        id, mastery, version, category: content.category, recruitment: content.recruitment,
        company: content.company, topic: content.topic, tags: content.tags, prompt: content.prompt.slice(0, 600),
      })),
      nextOffset: data.length > limit ? offset + limit : null,
    });
  });

  server.registerTool("get_question", {
    description: "按 ID 读取一道正式题目、参考答案和当前版本。",
    inputSchema: { questionId: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, async ({ questionId }) => {
    const { data, error } = await questions().eq("id", questionId).maybeSingle();
    if (error || !data) return failure("找不到这道题或暂时无法读取");
    return reply(data);
  });

  server.registerTool("submit_question_draft", {
    description: "提交一道新题草稿或对现有题目的完整修改建议。修改时传入 get_question 返回的 ID 和版本，并保留未修改字段。草稿须由用户在网页审核。",
    inputSchema: {
      question,
      questionId: z.string().uuid().optional(),
      baseVersion: z.number().int().positive().optional(),
    },
    annotations: { destructiveHint: false },
  }, async ({ question, questionId, baseVersion }) => {
    if (Boolean(questionId) !== Boolean(baseVersion)) return failure("修改草稿需要同时提供 questionId 和 baseVersion");
    let content;
    try {
      content = normalizeQuestion(question);
    } catch (error) {
      return failure(error instanceof Error ? error.message : "题目格式有误");
    }

    let baseContent = null;
    if (questionId) {
      const { data, error } = await questions().eq("id", questionId).eq("version", baseVersion!).maybeSingle();
      if (error || !data) return failure("原题已修改或不存在，请重新读取");
      baseContent = data.content;
    }

    const { data, error } = await db.from("question_drafts").insert({
      owner_id: owner, content, question_id: questionId ?? null,
      base_version: baseVersion ?? null, base_content: baseContent,
    }).select("id").single();
    if (error) return failure("暂时无法保存草稿");
    return reply({ draftId: data.id, status: "pending_review" });
  });

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
});
