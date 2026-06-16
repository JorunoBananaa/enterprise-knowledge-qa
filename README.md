# Enterprise Knowledge QA · 企业知识问答系统

基于 **RAG (Retrieval-Augmented Generation)** 的企业级知识库智能问答平台。支持多格式文档上传、自动向量化索引、多 LLM 提供商接入，提供带引用来源的流式问答体验。

---

## 技术栈

| 层级         | 技术                                                       | 说明                           |
| ------------ | ---------------------------------------------------------- | ------------------------------ |
| **前端**     | Next.js 14 (App Router) + React 18 + TypeScript            | 页面路由、SSR                  |
| **UI**       | Ant Design 5 + Tailwind CSS + Ant Design X                 | 企业级组件库、AI 对话组件      |
| **后端**     | Python 3.11+ / FastAPI + Uvicorn                           | 异步 REST API                  |
| **ORM**      | SQLAlchemy 2.0                                             | 声明式模型 + Session 管理      |
| **数据库**   | PostgreSQL 16 + pgvector                                   | 关系存储 + 向量相似度检索      |
| **AI / LLM** | LangChain                                                  | 统一 LLM & Embedding 调用抽象  |
| **向量化**   | HuggingFace (默认) / OpenAI / DeepSeek / 智谱 / 通义千问   | 多提供商 Embedding             |
| **大模型**   | DeepSeek / OpenAI / Anthropic / 智谱 / 通义千问 / Moonshot | 多提供商 LLM                   |
| **文档解析** | PyPDF / python-docx / python-pptx / openpyxl               | PDF、Word、PPT、Excel          |
| **认证**     | JWT (python-jose) + bcrypt + HttpOnly Cookie               | 无状态鉴权                     |
| **部署**     | Docker Compose                                             | 一键启动 PostgreSQL + pgvector |

---

## 目录结构

```
enterprise-knowledge-qa/
├── README.md                           # 项目说明文档
├── package.json                        # 根 npm scripts（dev 启动入口）
│
├── infra/
│   └── docker-compose.yml              # PostgreSQL + pgvector 容器编排
│
├── scripts/
│   └── dev-services.mjs                # 后端开发服务启动脚本（Conda 环境 + Uvicorn）
│
├── services/
│   └── api/                            # ██ 后端 API 服务（Python / FastAPI）
│       ├── pyproject.toml              # 项目元数据 & 依赖声明
│       ├── storage/
│       │   └── uploads/                # 文档上传存储目录
│       └── app/
│           ├── main.py                 # FastAPI 应用入口、路由注册、启动初始化
│           │
│           ├── api/                    # 接口层（Controller）
│           │   ├── deps.py             # 依赖注入（获取当前用户、数据库会话）
│           │   └── routes/
│           │       ├── auth.py         # 登录 / 登出 / 获取当前用户
│           │       ├── documents.py    # 文档上传 / 列表 / 删除 / 审核
│           │       ├── llm_config.py   # LLM 配置 CRUD
│           │       ├── prompts.py      # 提示词模板 CRUD
│           │       ├── qa.py           # 问答接口（支持流式 SSE）
│           │       ├── review.py       # 文档审核工作流
│           │       └── users.py        # 用户管理 CRUD
│           │
│           ├── core/                   # 核心配置与安全
│           │   ├── config.py           # Pydantic Settings（环境变量 / 默认值）
│           │   └── security.py         # JWT 生成 & 验证、密码哈希
│           │
│           ├── db/                     # 数据访问层
│           │   ├── base.py             # SQLAlchemy DeclarativeBase
│           │   └── session.py          # 数据库引擎 & 会话工厂
│           │
│           ├── models/                 # ORM 模型（Entity）
│           │   ├── user.py             # 用户 + 角色 / 状态枚举
│           │   ├── document.py         # 知识文档 + 审核 / 索引状态
│           │   ├── document_chunk.py   # 文档分块 + 向量存储
│           │   ├── category.py         # 知识分类
│           │   ├── chat.py             # 问答会话 & 消息记录
│           │   ├── llm_config.py       # LLM 配置（提供商 / 模型 / Key）
│           │   └── prompt.py           # 提示词模板（系统 / 用户）
│           │
│           ├── repositories/          # 仓库模式（数据查询封装）
│           │   ├── documents.py
│           │   ├── llm_config.py
│           │   ├── prompts.py
│           │   └── users.py
│           │
│           ├── schemas/               # Pydantic 请求 / 响应 Schema
│           │   ├── auth.py
│           │   ├── chat.py
│           │   ├── document.py
│           │   ├── llm_config.py
│           │   ├── prompt.py
│           │   └── user.py
│           │
│           └── services/              # 业务服务层
│               ├── rag.py             # RAG 问答核心（检索增强生成 + 流式）
│               ├── ingestion.py       # 文档解析 & 文本分块（PDF/Word/PPT/Excel）
│               ├── indexing.py        # 文档向量化 & pgvector 入索引
│               ├── embedding_factory.py # Embedding 模型工厂（多提供商）
│               ├── llm_factory.py     # LLM 模型工厂（多提供商）
│               ├── prompt_composer.py # 提示词组装（系统提示词 + 上下文 + 问题）
│               └── storage.py         # 文件存储（本地磁盘）
│
└── web-app/                            # ██ 前端 Web 应用（Next.js / React）
    ├── package.json                    # 前端依赖
    ├── next.config.mjs                 # Next.js 配置
    ├── tailwind.config.js              # Tailwind CSS 配置
    ├── tsconfig.json                   # TypeScript 配置
    └── src/
        ├── app/                        # App Router 页面
        │   ├── globals.css             # 全局样式
        │   ├── layout.tsx              # 根布局（Antd + i18n + AppShell）
        │   ├── login/
        │   │   └── page.tsx            # 登录页
        │   ├── library/                # 知识库（文档列表）
        │   │   ├── page.tsx
        │   │   ├── [id]/page.tsx       # 文档详情
        │   │   └── upload/page.tsx     # 文档上传
        │   ├── qa/
        │   │   └── page.tsx            # 问答页（流式对话）
        │   ├── review/
        │   │   └── page.tsx            # 审核页
        │   ├── llm-configs/
        │   │   └── page.tsx            # LLM 配置管理
        │   ├── prompts/
        │   │   └── page.tsx            # 提示词模板管理
        │   └── users/
        │       └── page.tsx            # 用户管理（管理员）
        │
        ├── components/                 # 通用组件
        │   ├── AppShell.tsx            # 应用外壳（侧边栏 + 用户状态 + 路由）
        │   ├── DocumentStatusBadge.tsx  # 文档状态标签
        │   ├── LoadingSpinner.tsx      # 加载动画
        │   ├── PageHeader.tsx          # 页面标题栏
        │   └── PromptPanel.tsx         # 提示词面板
        │
        └── lib/                        # 工具库
            ├── api.ts                  # API 封装（fetch + SSE 流 + 401 自动跳转登录）
            ├── auth-client.ts          # 认证客户端（登录 / 登出 / 获取用户）
            ├── auth.ts                 # Next.js 服务端认证（middleware 保护路由）
            ├── use-api.ts              # 通用 API Hook（基于 ahooks useRequest）
            └── utils.ts               # 通用工具函数
```

---

## 核心业务架构

```mermaid
flowchart LR
    subgraph 前端
        A[Next.js Web App]
    end

    subgraph 后端
        B[FastAPI REST API]
        C[(PostgreSQL + pgvector)]
    end

    subgraph AI
        D[LLM Provider<br/>DeepSeek / OpenAI / ...]
        E[Embedding Provider<br/>HuggingFace / OpenAI / ...]
    end

    A -->|HTTP + SSE| B
    B -->|SQLAlchemy| C
    B -->|LangChain| D
    B -->|LangChain| E

    B -->|文档上传| F[文件存储]
    B -->|解析分块| G[ingestion.py]
    G -->|向量化| E
    E -->|存入向量| C
```

---

## 功能模块

| 模块           | 功能说明                                                                |
| -------------- | ----------------------------------------------------------------------- |
| **用户认证**   | 登录 / 登出 / JWT HttpOnly Cookie / 角色（admin / standard）            |
| **知识库管理** | 文档上传（PDF / Word / PPT / Excel）、列表查看、删除                    |
| **文档审核**   | 上传 → 待审核 → 通过 / 驳回 → 通过后自动索引                            |
| **文档索引**   | 文本分块（1000 字 / 200 字重叠）→ Embedding 向量化 → pgvector 存储      |
| **提示词管理** | 系统提示词 & 用户提示词模板 CRUD，支持变量 `{{question}}` `{{context}}` |
| **LLM 配置**   | 多提供商、多模型、API Key 管理                                          |
| **知识问答**   | 向量检索 Top-K → 提示词组装 → LLM 生成 → 流式 SSE 输出（含引用来源）    |
| **用户管理**   | 管理员：新建 / 启用 / 禁用用户                                          |

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8
- **Python** >= 3.11（推荐 [Conda](https://docs.conda.io/) 环境 `3.14.4`）
- **Docker** + Docker Compose

### 1. 启动数据库

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2. 安装前端依赖

```bash
pnpm init
```

### 3. 启动开发服务

```bash
# 终端 1：启动后端 API（localhost:8000）
pnpm dev:services

# 终端 2：启动前端（localhost:3000）
pnpm dev:web-app
```

### 4. 访问

打开浏览器访问 `http://localhost:3000`

**默认账号：**
|用户名|密码|角色|
|---|---|---|
|`admin`|`a`|管理员|
|`user`|`a`|普通用户|

---

## API 路由概览

| 前缀           | 模块     | 说明                                |
| -------------- | -------- | ----------------------------------- |
| `/auth`        | 认证     | 登录、登出、当前用户                |
| `/documents`   | 文档管理 | 上传、列表、删除、审核              |
| `/llm-configs` | LLM 配置 | CRUD                                |
| `/prompts`     | 提示词   | CRUD                                |
| `/qa`          | 问答     | 创建会话、发送消息（支持 SSE 流式） |
| `/review`      | 审核     | 文档审核工作流                      |
| `/users`       | 用户管理 | CRUD（管理员权限）                  |

---

## 环境变量

后端配置通过 `app/core/config.py`（Pydantic Settings）管理，支持环境变量覆盖：

| 变量                          | 默认值                                                       | 说明                                 |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| `DATABASE_URL`                | `postgresql://postgres:postgres@localhost:5432/knowledge_qa` | 数据库连接串                         |
| `JWT_SECRET`                  | `local-dev-secret`                                           | JWT 签名密钥                         |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480`                                                        | Token 有效期（分钟）                 |
| `EMBEDDING_PROVIDER`          | `huggingface`                                                | Embedding 提供商                     |
| `EMBEDDING_MODEL_NAME`        | `sentence-transformers/all-MiniLM-L6-v2`                     | Embedding 模型名称                   |
| `EMBEDDING_DIMENSION`         | `384`                                                        | 向量维度                             |
| `UPLOAD_DIR`                  | `storage/uploads`                                            | 文件上传目录                         |
| `API_PORT`                    | `8000`                                                       | 后端端口（`dev-services.mjs`）       |
| `CONDA_ENV_NAME`              | `3.14.4`                                                     | Conda 环境名称（`dev-services.mjs`） |
