# dsh-memory-spaces

[English](README.md) | 中文

[![CI](https://github.com/icearia0219/dsh-memory-spaces/actions/workflows/ci.yml/badge.svg)](https://github.com/icearia0219/dsh-memory-spaces/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-memory-spaces)](https://www.npmjs.com/package/dsh-memory-spaces) ![DSH 兼容性：rc.6–rc.7 已验证](https://img.shields.io/badge/DSH-rc.6--rc.7%20verified-brightgreen) [![许可证：MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`dsh-memory-spaces` 是一个独立的社区 DeepSeek Harness 插件，让用户治理所选会话之间共享的本地记忆。会话默认私有。Web UI 负责创建空间、管理来源与使用关系、选择使用方式、清除来源、设置版本状态、选择导入历史和执行破坏性删除。插件不会向模型暴露这些治理工具，持久命令必须来自当前的人类直接事件。但这项应用层检查不能阻止拥有无限制文件系统权限的模型或进程修改本地数据库。

插件不包含团队、组织角色或远程邀请模型。用户直接连接所选本地会话。Bearer 链接仅提供只读会话快照，不会把会话连接到记忆。除非将 Harness Web 服务部署到可访问地址，否则 `127.0.0.1` 链接只能在本机使用。

在现有 Web Profile 中三步安装已发布的包：

```powershell
dsh plugin --profile web add dsh-memory-spaces@0.1.0
dsh --profile web --dump-config
dsh web
```

然后打开一个会话，选择 **记忆空间**，创建空间，明确保存所选消息，再把另一个本地会话连接为使用者。发送前可在输入框中检查或关闭候选记忆。安装前请查看 [DSH 兼容性](docs/DSH_COMPATIBILITY.md)：官方 DSH rc.6 与 rc.7 已通过 Windows 本地验证，也已通过托管的全新 Profile tarball 安装、Web 挂载、浏览器核心流程、源码链接和卸载矩阵。npm 上已发布 0.1.0 版本。

## 运行行为

Host 插件依赖 `ctx.agents`、`ctx.commands` 和 `ctx.llm`。它打开带版本号的 SQLite 数据库，维护只包含有效记忆版本的 FTS5 trigram 索引，注册面向用户的 `/memory` 操作、浏览器私有治理与快照传输，并在 `agent/pre-step` 条件式提供上下文。客户端只使用官方 DSH 的会话标题栏和输入框扩展位；当 DSH 声明了工作区会话行的附加扩展位时，侧边栏还会显示会话复选框和批量新建空间操作条，标题栏窗口始终作为兼容入口。插件自己的窗口提供跨工作区会话多选、逐消息选择、所选内容保存和发送前注入预览，无需修改 DSH 源码。

每个记忆版本都会记录空间、生命周期状态、版本链、来源会话 id 与标题、来源事件范围、创建时间、人工或模型提炼方式、保留的来源消息摘录，以及最近哪些回答接收了它。创建新版本会把同一版本链中原有有效版本标记为 `superseded`。回溯与注入只使用 `active` 版本；其他状态保留用于审计。

历史导入是可选操作。它会投影当前有效会话、排除推理内容和追加的插件上下文，使用配置的模型路由总结有界 transcript，并把结果保存为 `model_extracted`。再次导入会在该来源会话的生成摘要版本链中创建下一版本。人工记忆和其他来源会话不受影响。

## 来源与使用模型

产品不再使用一个读写权限，而是使用两种相互独立的关系：

| 关系 | 含义 | 不代表 |
| --- | --- | --- |
| 记忆来源 | 该会话中经明确保存、导入或同步的内容可以进入空间。 | 自动复制该会话的历史或未来消息。 |
| 记忆使用者 | 该会话回答时可以使用空间中的有效记忆。 | 该会话可以贡献内容。 |

一个会话可以是来源、使用者、两者都是，或两者都不是。创建空间后，所有者默认以 `automatic` 方式使用它；只有在第一次明确保存、导入或连接来源后，所有者才成为来源。插件内的每次持久贡献都必须由用户直接操作；插件不会自动写入会话内容。这不防护无限制 Shell 或其他插件对同一文件的修改。

使用者可以选择一种回答时使用方式：

| 使用方式 | 行为 |
| --- | --- |
| `automatic` | 自动准备匹配的有效记忆，用户仍可在输入框预览中关闭单条记忆。 |
| `confirm` | 发送前显示匹配记忆，只有用户勾选的记忆才会进入提示词。 |
| `paused` | 保留可见关系，但不检索或注入该空间。 |

所有者可以独立批量添加或移除来源与使用者。使用者可以暂停、恢复、改为发送前确认，或停止使用空间，这些操作不影响已贡献的记忆。来源可以停止贡献，并在保留、逻辑删除或清除插件应用层来源字段三种方式中处理以前的贡献。

## 体验受治理共享

1. 打开会话 A，并在会话标题栏选择 **记忆空间**。
2. 创建 `Sellora`。会话 A 成为所有者，并默认使用该空间。在提供工作区会话行扩展位的 DSH 中，也可以从侧边栏至少勾选两个会话并选择 **新建记忆空间**；第一个勾选的会话成为所有者。
3. 在管理器中选择 **选择历史对话…**，勾选已加载的用户或模型消息，再保存一条 `constraint`，例如“所有 UI 改造不得修改业务 API、路由、权限或数据结构”。先检查敏感内容提示。
4. 让会话 B 使用该记忆：打开 `Sellora`，选择 **连接其他会话…**，在跨工作区列表中找到 B，再选择 **使用空间记忆** 和自动、发送前确认或暂停方式。
5. 让会话 B 贡献内容：在同一窗口中选择 **作为记忆来源**。可选择总结并导入它的现有历史。不勾选时，既有历史和后续对话都不会被复制。
6. 在会话 B 中输入相关问题。发送前检查注入预览；自动记忆可以关闭，确认候选项必须主动勾选。
7. 在会话 A 中打开 `Sellora`。**来源**、**使用者** 和 **记忆** 三个页签会分别显示来源活动、回答时使用和版本记录。批量移除不会删除原始 DSH 会话。

只读会话分享仍是独立操作：打开 **选择历史对话…**，勾选消息、选择 **只读会话链接**，再复制生成的 URL。该 URL 只显示文本快照，不能把另一个会话连接到 `Sellora`。

## 生命周期与移除

| 记忆状态 | 回溯行为 | 含义 |
| --- | --- | --- |
| `active` | 可以使用 | 当前有效版本。 |
| `superseded` | 排除 | 已被版本链中的另一版本替代。 |
| `disputed` | 排除 | 存在冲突，需要用户解决。 |
| `expired` | 排除 | 有效期结束后保留用于审计。 |
| `deleted` | 排除 | 已逻辑删除并保留用于审计。 |

| 来源移除选择 | 已存内容 | 来源追溯 |
| --- | --- | --- |
| 保留贡献 | 按当前生命周期状态保留 | 保留 |
| 删除贡献 | 标记为 `deleted` | 保留用于审计 |
| 清除来源 | 保留内容与生命周期 | 从插件当前表中移除会话、标题、事件范围和来源摘录 |

停止使用只会移除回答时访问。移除来源只会停止未来的明确贡献，并按所选方式处理以前的贡献。删除完整空间是独立的所有者操作。SQLite 空闲页、WAL/SHM、备份、DSH 会话日志和提供方记录仍可能保留相关数据；这些操作不是安全物理擦除。

## 命令

创建空间、改变关系、选择使用方式、清除来源和删除完整空间只能在 UI 中完成。`/memory create`、`join`、`leave`、`purge` 和 `drop` 会返回错误，因此模型生成或粘贴的命令文本无法改变治理状态。

| 命令 | 效果 |
| --- | --- |
| `/memory import-history <space>` | 总结当前来源会话，并创建下一个生成摘要版本。 |
| `/memory remember <space> <type> <content>` | 明确保存一条带命令事件来源的记忆；所有者首次贡献时会被记录为来源。 |
| `/memory forget <memory-id>` | 把当前会话可以管理的记忆版本标记为 `deleted`。 |
| `/memory list` | 列出因所有权、来源贡献或使用关系而可见的空间，并显示各自关系。 |
| `/memory show <space>` | 显示可见的记忆版本及生命周期状态。 |
| `/memory preview <query>` | 为诊断渲染有界自动上下文；输入框提供可交互预览。 |

记忆类型为 `fact`、`decision`、`constraint`、`preference`、`task`、`artifact`、`issue`、`solution` 和 `temporary`。

## 配置

| 字段 | 默认值 | 含义 |
| --- | ---: | --- |
| `databasePath` | 必填；bundle 使用 `profile:memory-spaces-v4.sqlite` | 安装包会把文件解析到所属 DSH Profile 下。测试可使用 `:memory:`。 |
| `journalMode` | `wal` | SQLite 日志模式：`wal`、`delete`、`truncate` 或 `persist`。 |
| `busyTimeoutMs` | `5000` | 数据库被锁定时等待多久再让操作失败。 |
| `maxMemoryBytes` | `8192` | 单个记忆版本的最大 UTF-8 字节数。 |
| `maxQueryBytes` | `4096` | 从人类直接输入中保留用于检索的最大 UTF-8 字节数。 |
| `maxRecallItems` | `8` | 预览与注入考虑的最大排序候选数。 |
| `maxRecallBytes` | `16384` | 完整警告、JSON 来源与记忆正文的字节上限。 |
| `historySummaryProvider` | 空 | 固定摘要提供方；空值使用会话最近路由，并且必须与模型字段配对。 |
| `historySummaryModel` | 空 | 固定摘要模型；空值使用会话最近路由，并且必须与提供方字段配对。 |
| `historySummaryMaxTokens` | `1200` | 摘要输出 token 上限；因 token 上限截断的输出不会保存。 |
| `maxHistoryImportBytes` | `65536` | 发送给摘要模型的有界 transcript 最大字节数。 |

Schema 版本 4 使用独立的来源表和使用者表。放在配置目标路径上的版本 3 数据库会先备份，再按以下规则迁移：`read` 变为自动使用；`write` 变为来源；`read_write` 变为两者；`manual_only` 变为来源加发送前确认。新默认值不会静默复用旧的全局 `$DSH_HOME/memory-spaces-v3.sqlite`；需要迁移时请按[备份与恢复](docs/BACKUP_AND_RECOVERY.md)明确移动。其他未知 schema 版本会快速失败且不改变日志模式。

## 兼容性与安装

本包适配 `>=0.1.0-rc.6 <0.2.0` 范围内的官方原版 DeepSeek Harness 包，并以 rc.7 作为当前开发版本。它只注册已发布的客户端扩展位，不要求 fork 或修改官方仓库。只有安装的 DSH 声明了公开的工作区会话行 leading 与 overlay 扩展位时，侧边栏批量选择器才会显示；没有这些扩展位时仍可使用标题栏的记忆空间流程。

已发布的 npm 包包含预构建产物，是推荐的安装来源。安装明确版本，以便由用户决定何时升级：

```powershell
dsh plugin --profile web add dsh-memory-spaces@0.1.0
dsh --profile web --dump-config
dsh web
```

只在准备本地构建所选提交时，才直接安装当前 GitHub 源码：

```powershell
dsh plugin --profile web add github:icearia0219/dsh-memory-spaces
dsh --profile web --dump-config
dsh web
```

Git 依赖会执行包内自包含的 `prepare` 构建。如果 pnpm 阻止构建，只在 pnpm 的 `allowBuilds` 配置中批准准确的插件包，重新安装，并在启动前检查生成的 Profile。安装后需重启 Web 进程，使启动 manifest 发布客户端入口。

### 升级、移除与回滚

更改已安装的包之前，先停止 Web 进程并备份数据库。再次添加预期的明确版本即可升级；随后运行 `dsh --profile web --dump-config`，重启 Web，并用合成数据完成一次保存与回溯。本插件没有独立的运行时禁用开关：`dsh plugin --profile web remove dsh-memory-spaces` 会禁用插件，但会保留 Profile 内的 SQLite 数据库和备份。

因此，包移除可以撤销：重新安装同一版本即可重新连接已保留的数据库。回滚版本时，安装较早的明确包版本；如果新版本更改了 schema，还要恢复由旧版本创建的数据库备份。旧版本插件遇到未知 schema 会快速失败；只回滚包不等于数据库迁移。完全删除数据是单独的破坏性操作；只能在核对实际 Profile 路径后，才删除 SQLite 数据库、同名 `-wal` 与 `-shm` 文件和所有备份。请查看[备份与恢复](docs/BACKUP_AND_RECOVERY.md)。

独立 checkout 的本地开发方式：

```powershell
git clone https://github.com/icearia0219/dsh-memory-spaces.git
cd dsh-memory-spaces
pnpm install
pnpm test
dsh plugin --profile web add .
dsh --profile web --dump-config
$env:DSH_MEMORY_SPACES_DATABASE_PATH = "C:\absolute\path\to\the\web-profile\memory-spaces-v4.sqlite"
dsh web
```

源码链接位于所属 Profile 外部，无法安全推断数据应归属哪个 Profile，因此源码链接安装需要明确设置数据库绝对路径；tarball 安装会自动解析 Profile 内路径。构建会生成 Host 使用的 `lib/index.js`、DSH 浏览器模块加载器使用的 `lib/client.cjs` 和 `lib/types` 中的类型声明。破坏性操作前请备份 SQLite 文件。

## 安全与隐私

- 关系变更只能通过定址到具体会话的浏览器私有 UI 命令完成；公开 `/memory` 命令和模型工具无法执行。
- 已存记忆仍是不可信数据。标签安全 JSON 会转义字面量 `<`，注入警告会把记忆中的指令、权限声明和工具请求标记为不可信背景；这些措施不能保证抵抗 Prompt Injection。
- 保存所选对话、导入历史和创建快照前，界面会显示 API Key、密码、私钥、token、身份证件和其他敏感内容的警告。凭据格式检测只报告类别，不回显匹配值。
- 快照访问 token 与编辑 token 相互独立。SQLite 只保存 hash；链接具有有效期、次数上限、计数和撤销状态。快照不授予任何记忆关系。客户端移除查询参数之前，URL 仍可能通过浏览器或剪贴板历史、日志、截图、Referrer 或代理泄漏。
- SQLite 数据库保存在本地且没有加密。部署者负责 TLS、服务认证、文件保护和备份策略。
- 历史导入会为每个所选会话执行一次模型调用。提供方可能根据自身策略计费或保留提交的 transcript。

## 模型体验

当人类直接输入匹配 `automatic` 使用者空间中的有效记忆时，模型会在直接提示词之前收到一条带来源的额外用户消息。它包含固定的不可信背景警告，以及带生命周期和来源字段的标签安全 JSON。`confirm` 使用者只会收到在匹配输入框预览中明确勾选的候选记忆。目标会话日志会记录实际注入消息，记忆数据库会记录目标会话、可用时的回答事件序号和使用时间。

没有固定提示词或工具 schema 成本。匹配步骤在提供方分词前最多增加 `maxRecallBytes` UTF-8 字节。取消、提供方失败、空摘要输出、工具调用、token 截断和超限历史摘要输出都不会写入数据。

## 限制

- 会话 id 不是账号身份。此版本没有团队、组织目录、远程邀请或跨实例同步。
- 消息选择只包含浏览器当前已加载的会话历史。需要更早内容时，请先在会话中加载历史，再重新打开选择窗口。
- 快照链接只包含文本，并且只属于创建它的 DSH 实例。除非公开部署改变基础 URL，否则 `127.0.0.1` 只能在同一台机器访问。
- 冲突状态由用户治理。更新现有记忆会创建版本链，但插件不会从语义上检测两条独立保存的记忆是否矛盾。
- 检索使用字面 FTS5 trigram 排序，而不是 embedding 相似度。
- 没有外部数据库备份时，插件不能撤销清除来源和删除完整空间，但这不代表物理残留或其他系统副本已经安全擦除。

## 文档

- [架构](docs/ARCHITECTURE.md)与[数据模型](docs/DATA_MODEL.md)
- [威胁模型](docs/THREAT_MODEL.md)、[安全策略](SECURITY.md)与[备份/恢复](docs/BACKUP_AND_RECOVERY.md)
- [DSH 兼容性](docs/DSH_COMPATIBILITY.md)、[声明核验](docs/CLAIM_VERIFICATION.md)与[质量审计](docs/QUALITY_AUDIT.md)
- [故障排查](docs/TROUBLESHOOTING.md)、[性能边界](docs/PERFORMANCE.md)与[发布清单](docs/RELEASE_CHECKLIST.md)

## 所有者与许可

由[付雨嫣](https://github.com/icearia0219)维护，使用 [MIT License](LICENSE) 发布。
