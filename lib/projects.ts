import { rm } from "node:fs/promises";
import path from "node:path";
import { DeckSchema, emptyDeck, type Deck, type Operation } from "./document";
import { db, LOCAL_USER_ID, LOCAL_WORKSPACE_ID, transaction } from "./db";
import { readTemplateTheme } from "./templates";
import { applyOperations, DocumentError, summarizeOperations } from "./operations";
import { assertImagesForProject, DATA_DIR } from "./assets";

export type ProjectRecord = {
  id: string;
  title: string;
  version: number;
  deck: Deck;
  plan: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id), title: String(row.title), version: Number(row.version),
    deck: DeckSchema.parse(row.document),
    plan: row.plan == null ? null : String(row.plan),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const result = await db().query(
    "SELECT * FROM projects WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 100",
    [LOCAL_WORKSPACE_ID],
  );
  return result.rows.map(mapProject);
}

export async function createProject(title?: string, templateId?: string): Promise<ProjectRecord> {
  const id = crypto.randomUUID();
  const theme = templateId ? await readTemplateTheme(templateId) : undefined;
  const deck = emptyDeck(title?.trim() || undefined, theme);
  const conversationId = crypto.randomUUID();
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO projects(id, workspace_id, created_by_user_id, title, version, document) VALUES($1,$2,$3,$4,0,$5)",
      [id, LOCAL_WORKSPACE_ID, LOCAL_USER_ID, deck.title, JSON.stringify(deck)],
    );
    await client.query(
      "INSERT INTO document_versions(project_id, version, document, actor_user_id, source) VALUES($1,0,$2,$3,'create')",
      [id, JSON.stringify(deck), LOCAL_USER_ID],
    );
    await client.query("INSERT INTO conversations(id, project_id) VALUES($1,$2)", [conversationId, id]);
  });
  const project = await getProject(id);
  if (!project) throw new Error("資料を作成できませんでした。");
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) throw new DocumentError("資料が見つかりません。", 404);
  const paths = await db().query(
    `SELECT storage_path FROM assets WHERE project_id=$1
     UNION ALL SELECT storage_path FROM exports WHERE project_id=$1`,
    [id],
  );
  await db().query("DELETE FROM projects WHERE id = $1 AND workspace_id = $2", [id, LOCAL_WORKSPACE_ID]);
  await rm(path.join(DATA_DIR, "assets", id), { recursive: true, force: true });
  await rm(path.join(DATA_DIR, "renders", id), { recursive: true, force: true });
  for (const row of paths.rows) await rm(String(row.storage_path), { force: true });
}

export async function setProjectPlan(projectId: string, plan: string | null, baseVersion: number): Promise<ProjectRecord> {
  const result = await db().query(
    "UPDATE projects SET plan = $2 WHERE id = $1 AND workspace_id = $3 AND version = $4 RETURNING *",
    [projectId, plan, LOCAL_WORKSPACE_ID, baseVersion],
  );
  if (result.rows[0]) return mapProject(result.rows[0]);
  const current = await getProject(projectId);
  if (!current) throw new DocumentError("資料が見つかりません。", 404);
  throw new DocumentError("別の変更が先に保存されました。画面を更新してください。", 409);
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const result = await db().query(
    "SELECT * FROM projects WHERE id = $1 AND workspace_id = $2",
    [id, LOCAL_WORKSPACE_ID],
  );
  return result.rows[0] ? mapProject(result.rows[0]) : null;
}

export async function commitOperations(projectId: string, baseVersion: number, operations: Operation[], source: "manual" | "ai", reviewedDeckOverride?: Deck): Promise<ProjectRecord> {
  await assertImagesForProject(projectId, operations);
  // Vision レビュー済み Deck の即適用用。スキーマ検証を通った Deck だけをトランザクションへ持ち込む。
  const reviewedDeck = reviewedDeckOverride ? DeckSchema.parse(reviewedDeckOverride) : null;
  await transaction(async (client) => {
    const result = await client.query("SELECT * FROM projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [projectId, LOCAL_WORKSPACE_ID]);
    if (!result.rows[0]) throw new DocumentError("資料が見つかりません。", 404);
    const current = mapProject(result.rows[0]);
    if (current.version !== baseVersion) throw new DocumentError("別の変更が先に保存されました。画面を更新してください。", 409);
    const deck = reviewedDeck ?? applyOperations(current.deck, operations);
    const nextVersion = current.version + 1;
    await client.query(
      "UPDATE projects SET title = $2, version = $3, document = $4, updated_at = now() WHERE id = $1",
      [projectId, deck.title, nextVersion, JSON.stringify(deck)],
    );
    await client.query(
      "INSERT INTO document_versions(project_id, version, document, actor_user_id, source) VALUES($1,$2,$3,$4,$5)",
      [projectId, nextVersion, JSON.stringify(deck), LOCAL_USER_ID, source],
    );
    await client.query(
      "INSERT INTO operations(id, project_id, version, actor_user_id, source, summary, body) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [crypto.randomUUID(), projectId, nextVersion, LOCAL_USER_ID, source, summarizeOperations(operations), JSON.stringify(operations)],
    );
  });
  const project = await getProject(projectId);
  if (!project) throw new Error("更新済みの資料を取得できませんでした。");
  return project;
}

export async function listHistory(projectId: string): Promise<{ version: number; source: string; summary: string; createdAt: string }[]> {
  const result = await db().query(
    `SELECT v.version, v.source, v.created_at, COALESCE(o.summary, '資料を作成') AS summary
     FROM document_versions v LEFT JOIN operations o ON o.project_id = v.project_id AND o.version = v.version
     WHERE v.project_id = $1 ORDER BY v.version DESC LIMIT 50`,
    [projectId],
  );
  return result.rows.map((row) => ({ version: Number(row.version), source: String(row.source), summary: String(row.summary), createdAt: new Date(row.created_at).toISOString() }));
}

export async function restoreVersion(projectId: string, baseVersion: number, restoreVersionNumber: number): Promise<ProjectRecord> {
  await transaction(async (client) => {
    const currentResult = await client.query("SELECT * FROM projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [projectId, LOCAL_WORKSPACE_ID]);
    if (!currentResult.rows[0]) throw new DocumentError("資料が見つかりません。", 404);
    const current = mapProject(currentResult.rows[0]);
    if (current.version !== baseVersion) throw new DocumentError("別の変更が先に保存されました。画面を更新してください。", 409);
    const oldResult = await client.query("SELECT document FROM document_versions WHERE project_id = $1 AND version = $2", [projectId, restoreVersionNumber]);
    if (!oldResult.rows[0]) throw new DocumentError("復元する版が見つかりません。", 404);
    const deck = DeckSchema.parse(oldResult.rows[0].document);
    const version = current.version + 1;
    await client.query("UPDATE projects SET title=$2, version=$3, document=$4, updated_at=now() WHERE id=$1", [projectId, deck.title, version, JSON.stringify(deck)]);
    await client.query("INSERT INTO document_versions(project_id,version,document,actor_user_id,source) VALUES($1,$2,$3,$4,'restore')", [projectId, version, JSON.stringify(deck), LOCAL_USER_ID]);
    await client.query("INSERT INTO operations(id,project_id,version,actor_user_id,source,summary,body) VALUES($1,$2,$3,$4,'restore',$5,$6)",
      [crypto.randomUUID(), projectId, version, LOCAL_USER_ID, `版 ${restoreVersionNumber} に復元`, JSON.stringify({ restoreVersion: restoreVersionNumber })]);
  });
  const project = await getProject(projectId);
  if (!project) throw new Error("復元済みの資料を取得できませんでした。");
  return project;
}

export type ChatMessage = { id: string; role: "user" | "assistant" | "system"; content: string; metadata: Record<string, unknown>; createdAt: string };
export async function listMessages(projectId: string): Promise<ChatMessage[]> {
  const result = await db().query(
    `SELECT * FROM (
       SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.project_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 200
     ) recent ORDER BY created_at, id`, [projectId],
  );
  return result.rows.map((row) => ({ id: String(row.id), role: row.role, content: String(row.content), metadata: row.metadata ?? {}, createdAt: new Date(row.created_at).toISOString() }));
}
export async function addMessage(projectId: string, role: ChatMessage["role"], content: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await db().query(
    `INSERT INTO messages(id,conversation_id,user_id,role,content,metadata)
     SELECT $1,id,$3,$4,$5,$6 FROM conversations WHERE project_id=$2`,
    [crypto.randomUUID(), projectId, role === "user" ? LOCAL_USER_ID : null, role, content, JSON.stringify(metadata)],
  );
}
export async function clearMessages(projectId: string): Promise<void> {
  await db().query(
    `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=$1)`,
    [projectId],
  );
}

export type Proposal = { id: string; baseVersion: number; summary: string; operations: Operation[]; proposedDeck: Deck; status: string };
function mapProposal(row: Record<string, unknown>): Proposal {
  return { id: String(row.id), baseVersion: Number(row.base_version), summary: String(row.summary),
    operations: row.operations as Operation[], proposedDeck: DeckSchema.parse(row.proposed_document), status: String(row.status) };
}
export async function getPendingProposal(projectId: string): Promise<Proposal | null> {
  const result = await db().query("SELECT * FROM proposals WHERE project_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [projectId]);
  return result.rows[0] ? mapProposal(result.rows[0]) : null;
}
export async function getProposal(projectId: string, proposalId: string): Promise<Proposal | null> {
  const result = await db().query("SELECT * FROM proposals WHERE id=$1 AND project_id=$2", [proposalId, projectId]);
  return result.rows[0] ? mapProposal(result.rows[0]) : null;
}
export async function createProposal(projectId: string, baseVersion: number, operations: Operation[], proposedDeckOverride?: Deck): Promise<Proposal> {
  await assertImagesForProject(projectId, operations);
  return transaction(async (client) => {
    const result = await client.query("SELECT * FROM projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [projectId, LOCAL_WORKSPACE_ID]);
    if (!result.rows[0]) throw new DocumentError("資料が見つかりません。", 404);
    const project = mapProject(result.rows[0]);
    if (project.version !== baseVersion) throw new DocumentError("別の変更が先に保存されました。画面を更新してください。", 409);
    const pending = await client.query("SELECT id FROM proposals WHERE project_id=$1 AND status='pending' LIMIT 1", [projectId]);
    if (pending.rows[0]) throw new DocumentError("確認待ちの変更案を先に適用または破棄してください。", 409);
    const proposedDeck = proposedDeckOverride ? DeckSchema.parse(proposedDeckOverride) : applyOperations(project.deck, operations);
    const summary = summarizeOperations(operations);
    const id = crypto.randomUUID();
    await client.query("INSERT INTO proposals(id,project_id,base_version,operations,proposed_document,summary,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",
      [id, projectId, baseVersion, JSON.stringify(operations), JSON.stringify(proposedDeck), summary]);
    return { id, baseVersion, summary, operations, proposedDeck, status: "pending" };
  });
}
export async function decideProposal(projectId: string, proposalId: string, accept: boolean): Promise<ProjectRecord | null> {
  await transaction(async (client) => {
    const proposalResult = await client.query("SELECT * FROM proposals WHERE id=$1 AND project_id=$2 FOR UPDATE", [proposalId, projectId]);
    if (!proposalResult.rows[0] || proposalResult.rows[0].status !== "pending") throw new DocumentError("確認待ちの変更案が見つかりません。", 404);
    if (!accept) {
      await client.query("UPDATE proposals SET status='rejected', decided_at=now() WHERE id=$1", [proposalId]);
      return;
    }
    const currentResult = await client.query("SELECT * FROM projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [projectId, LOCAL_WORKSPACE_ID]);
    if (!currentResult.rows[0]) throw new DocumentError("資料が見つかりません。", 404);
    const current = mapProject(currentResult.rows[0]);
    if (current.version !== Number(proposalResult.rows[0].base_version)) throw new DocumentError("資料が変更されたため、この変更案を適用できません。", 409);
    // addImage 資産は createProposal 作成時に検証済みで、資産削除 API は存在しないためトランザクション内では再検証しない。
    const deck = DeckSchema.parse(proposalResult.rows[0].proposed_document);
    const version = current.version + 1;
    await client.query("UPDATE projects SET title=$2, version=$3, document=$4, updated_at=now() WHERE id=$1", [projectId, deck.title, version, JSON.stringify(deck)]);
    await client.query("INSERT INTO document_versions(project_id,version,document,actor_user_id,source) VALUES($1,$2,$3,$4,'ai')", [projectId, version, JSON.stringify(deck), LOCAL_USER_ID]);
    await client.query("INSERT INTO operations(id,project_id,version,actor_user_id,source,summary,body) VALUES($1,$2,$3,$4,'ai',$5,$6)",
      [crypto.randomUUID(), projectId, version, LOCAL_USER_ID, proposalResult.rows[0].summary, JSON.stringify(proposalResult.rows[0].operations)]);
    await client.query("UPDATE proposals SET status='accepted', decided_at=now() WHERE id=$1", [proposalId]);
  });
  return accept ? getProject(projectId) : null;
}
