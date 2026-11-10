# 答题间

个人笔面试题库。用公司、知识点、笔试／面试和校招／社招筛选题目。新增题目时可以输入主题，也可以沿用已有主题并带入公司和招聘信息。主题、公司、类别、招聘类型相同的题目合成一组。主题内提供学习、逐题练习和整组考试。考试交卷后显示参考答案，本次作答仅保留在当前页面。逐题练习保存每道题最近一次掌握状态。

## 本地开发

使用 Node.js 22 或更新的 LTS 版本。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

在 `.env.local` 填写 Supabase 项目 URL 和以 `sb_publishable_` 开头的公开客户端 key。完成云端配置前可以预览登录页。运行 `npm test` 验证导入和数据库逻辑，运行 `npm run build` 生成 `dist`。

## 首次发布

1. 在 Supabase 创建一个 Free 项目。到 **Authentication → Users** 预建你的邮箱密码账号并确认邮箱，记录该用户的 UUID。到 Auth 配置关闭新用户注册和匿名登录。发布后用同一个账号在手机和电脑登录。
2. 安装并登录 Supabase CLI。在这个目录关联项目并应用数据库迁移。

   ```powershell
   supabase login
   supabase link --project-ref <项目引用>
   supabase db push
   ```

3. 在 Supabase 的 Edge Function Secrets 设置 `QUESTION_BANK_OWNER_ID` 为上一步的用户 UUID。另生成至少 32 字节的随机值，将其设置为 `QUESTION_BANK_MCP_TOKEN`。例如用密码管理器生成 64 字符的随机字符串。将令牌保存在密码管理器。Edge Function 读取 Supabase 自动注入的服务器密钥，网页只使用公开客户端 key。

   ```powershell
   supabase functions deploy mcp
   ```

4. 在自己的 GitHub 账号下创建独立的空公开仓库 `interview-question-bank`，将此目录的源码推送到 `main`。仓库 **Settings → Pages** 选择 **GitHub Actions**，在 **Settings → Secrets and variables → Actions → Variables** 设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`，然后在 **Actions → Deploy to GitHub Pages** 手动运行首次部署。以后推送到 `main` 时会自动发布。发布成功后，打开部署步骤给出的网址，通常为 `https://<账号>.github.io/interview-question-bank/`。

   ```powershell
   git remote add origin https://github.com/<账号>/interview-question-bank.git
   git push -u origin main
   ```
5. 用无痕窗口检查匿名访问只显示登录页。登录后录入一题，验证手机同步。若免费项目因低活跃度暂停，可在 Supabase 控制台恢复后刷新网页。

## 在 Codex 里使用

在本机配置同一个 MCP 专用令牌，通过环境变量传给 Codex。以下 PowerShell 示例隐藏输入。在同一个终端启动 Codex，或者在 Windows 用户环境变量里设置令牌后重启 Codex 桌面应用。

```powershell
$env:QUESTION_BANK_MCP_TOKEN = Read-Host '输入题库 MCP 令牌' -MaskInput
codex mcp add interview_bank --url https://<项目引用>.supabase.co/functions/v1/mcp --bearer-token-env-var QUESTION_BANK_MCP_TOKEN
codex mcp list
```

可以让 Codex「找出大疆校招里知识点为 RTOS、掌握状态为模糊的题，读出参考答案并总结」或「把这道题整理成 2026 年大疆固件开发主题下的新题草稿」。修改正式题目前，Codex 先用 `get_question` 取得完整内容和版本，再提交修改草稿。草稿经网页确认后入库。发生版本冲突时，先检查当前题目，再基于最新版本提交新的修改草稿。

## JSON 交换

题库页的「导出 JSON」包含正式题目的内容、主题和招聘类型。草稿页可以导入 [示例文件](examples/questions.v1.json) 同格式的数据，导入的记录作为待审核新题出现。类别用 `written` 或 `interview`，招聘类型用 `campus`、`experienced` 或 `unspecified`。主题留空时，题目按单题展示。文件有格式错误时，导入会在写入前指出具体题号。
