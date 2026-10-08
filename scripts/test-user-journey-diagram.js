const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DOCS_DIR = path.resolve(__dirname, '../docs');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>High-Level User Journey Diagram</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: #050813;
      color: #f1f5f9;
      font-family: 'Plus Jakarta Sans', sans-serif;
      -webkit-font-smoothing: antialiased;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 48px 64px;
      background: radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.14) 0%, transparent 40%),
                  radial-gradient(circle at 85% 85%, rgba(14, 165, 233, 0.12) 0%, transparent 40%),
                  #070a14;
    }

    body::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image: linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 1;
    }

    .header {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 20px;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
      color: #a5b4fc;
      margin-bottom: 8px;
    }

    .title {
      font-size: 38px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.02em;
    }

    .subtitle {
      font-size: 16px;
      color: #94a3b8;
      font-weight: 500;
      margin-top: 4px;
    }

    .diagram-container {
      position: relative;
      z-index: 2;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
    }

    .footer {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      color: #64748b;
      font-size: 13px;
    }

    /* Mermaid SVG overrides */
    svg {
      max-width: 100% !important;
      max-height: 100% !important;
      height: auto !important;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="tag">AI WORKSPACE • PRESENTATION SLIDE</div>
      <div class="title">High-Level User Journey</div>
      <div class="subtitle">Complete user workflow: from authentication and workspace isolation to grounded AI and transactional confirmation</div>
    </div>
    <div style="text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #64748b;">
      <span style="display: inline-block; padding: 6px 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; color: #34d399; font-weight: 600;">
        ZERO-TRUST ARCHITECTURE
      </span>
    </div>
  </div>

  <div class="diagram-container">
    <pre class="mermaid">
flowchart LR
    %% Styles
    classDef startNode fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#e0e7ff,font-weight:bold;
    classDef authNode fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef hubNode fill:#1e293b,stroke:#6366f1,stroke-width:2px,color:#ffffff,font-weight:bold;
    classDef coreNode fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#ecfdf5;
    classDef aiNode fill:#4c1d95,stroke:#c084fc,stroke-width:2px,color:#faf5ff;
    classDef mcpNode fill:#1e1b4b,stroke:#a855f7,stroke-width:2px,color:#f3e8ff;
    classDef reviewNode fill:#78350f,stroke:#fbbf24,stroke-width:2px,color:#fffbeb,font-weight:bold;
    classDef persistNode fill:#065f46,stroke:#10b981,stroke-width:3px,color:#ffffff,font-weight:bold;

    Start(["👤 User Lands<br/>on Platform"]):::startNode --> AuthCheck{"Active<br/>Session?"}

    AuthCheck -- No --> Login["🔑 Login Page (/login)<br/>• Argon2id Password<br/>• Session Cookie Issued"]:::authNode
    Login --> ProjSelect

    AuthCheck -- Yes --> ProjSelect["📁 Select / Create Project<br/>• Project ID Isolation<br/>• Verify Role (Owner/Contrib)"]:::hubNode

    ProjSelect --> Dashboard["📊 Project Overview Hub<br/>• Task Metrics & Overdue<br/>• Activity Stream Audit"]:::hubNode

    Dashboard --> Intent{"User Action<br/>Track"}

    Intent --> FlowCore["📋 Core Workspace<br/>• Requirements & AC<br/>• Architecture ADRs<br/>• Tasks & Assignments<br/>• Meetings & Documents"]:::coreNode

    Intent --> FlowCopilot["🤖 Grounded Copilot<br/>• 6 Specialized Modes<br/>• Hybrid RAG Retrieval<br/>• Cited Answers with Sources"]:::aiNode

    Intent --> FlowMCP["🔌 External MCP Agent<br/>• Cursor / Claude / Antigravity<br/>• Authenticate via PAT<br/>• Query Context & Execute Tools"]:::mcpNode

    FlowCopilot --> AIProposal["📝 AI Proposal Draft<br/>• Structured JSON (Zod)<br/>• Status: PROPOSED (24h TTL)<br/>• Zero direct DB writes"]:::reviewNode
    FlowCore -.-> AIProposal

    AIProposal --> HumanReview["🔍 Human Review & Edit<br/>• Checkbox Selection<br/>• Title & Estimate Tuning<br/>• Reject or Confirm"]:::reviewNode

    HumanReview -- "Confirm (Idempotency Key)" --> Commit["💾 Transactional Commit<br/>• Atomic PostgreSQL Insert<br/>• Status: CONFIRMED<br/>• Append Activity Audit"]:::persistNode

    Commit --> SyncKnowledge["🔄 Auto-sync Knowledge<br/>(tsvector & pgvector)"]:::coreNode
    SyncKnowledge --> Dashboard
    </pre>
  </div>

  <div class="footer">
    <span>AI Workspace Architecture • High-Level User Journey</span>
    <span>PostgreSQL • DeepSeek V4 Pro • Model Context Protocol • Next.js</span>
  </div>

  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'base',
      themeVariables: {
        darkMode: true,
        background: 'transparent',
        primaryColor: '#1e293b',
        primaryTextColor: '#f8fafc',
        primaryBorderColor: '#6366f1',
        lineColor: '#94a3b8',
        secondaryColor: '#334155',
        tertiaryColor: '#0f172a',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: '15px'
      },
      flowchart: {
        curve: 'basis',
        htmlLabels: true,
        nodeSpacing: 40,
        rankSpacing: 50
      }
    });
  </script>
</body>
</html>
`;

async function test() {
  const htmlPath = path.join(DOCS_DIR, 'test_user_journey.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  });

  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), {
    waitUntil: 'networkidle',
  });

  await page.waitForTimeout(1500);

  const outImage = path.join(DOCS_DIR, 'test_user_journey.png');
  await page.screenshot({ path: outImage });
  console.log('Saved test image to:', outImage);

  await browser.close();
}

test().catch(console.error);
